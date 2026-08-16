import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeDatabase } from "../routes/health";
import type { EstadoObservado } from "@workspace/db/diagnostico";

/**
 * Production continua migrando na partida — e é isso que a mudança de
 * Development **não** pode ter enfraquecido.
 *
 * `scripts/dev.mjs` deixou de aplicar a fila, e o motivo é o Publishing: ele
 * compara Development com Production, então um `Run` que migrasse sozinho
 * colocaria Development à frente e fabricaria o diff que trava a publicação.
 * Isso vale para o fluxo de desenvolvimento, e **só** para ele.
 *
 * O servidor publicado é o outro lado do mesmo arranjo: ele é quem aplica a
 * fila versionada, e sem ele Production não sai do lugar. Se alguém um dia
 * remover essa chamada por simetria com o `dev.mjs`, o bridge deploy inteiro
 * deixa de fazer sentido — a Fase B depende dela. Estas provas existem para que
 * essa remoção não passe.
 *
 * **O que este arquivo prova, e o que ele não prova.** Ele prova que a *chamada*
 * existe no servidor e que o `dev.mjs` não a duplica. Por muito tempo isso foi
 * lido como "logo, Development não migra" — e era falso: o `dev.mjs` sobe o
 * servidor, e o servidor migrava sempre que houvesse `DATABASE_URL`. A ausência
 * de um comando de migração aqui nunca disse nada sobre o processo seguinte.
 *
 * Quem prova a política por ambiente é `politica-de-migracao.test.ts`. Os dois
 * arquivos se completam: lá se decide **se** migra, aqui se garante que, quando
 * a resposta for sim, a chamada e o relatório continuam existindo.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

/** O estado que `/api/healthz` observa, com o caso feliz como base. */
const observando = (estado: Partial<EstadoObservado>) => async (): Promise<EstadoObservado> => ({
  configurada: true,
  alcancavel: true,
  pendentes: [],
  aplicadas: 20,
  ...estado,
});

describe("o servidor publicado aplica a fila", () => {
  it("index.ts chama runMigrations na partida", () => {
    const fonte = ler("src/index.ts");
    expect(fonte).toMatch(/import \{ runMigrations \} from "@workspace\/db\/migrate"/);

    const executavel = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

    // A chamada de verdade, com a pasta de migrations do bundle.
    expect(executavel).toMatch(/runMigrations\(\s*url\s*,\s*migrationsFolder\(\)\s*\)/);
    // E o relatório é guardado, que é o que faz a falha chegar ao healthz.
    expect(executavel).toMatch(/lembrarRelatorio\(\s*report\s*\)/);
  });

  it("o dev não duplica a chamada — quem migra, quando migra, é o servidor", () => {
    const dev = readFileSync(path.join(RAIZ, "../..", "scripts/dev.mjs"), "utf8");
    const executavelDev = dev
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

    expect(executavelDev).toMatch(/runMigrations:\s*null/);
    expect(executavelDev).not.toMatch(/(runCaptured|spawnChild|spawn)\s*\([^)]*migrate/s);
    expect(ler("src/index.ts")).toMatch(/runMigrations\(/);
  });
});

describe("falha de migration em Production não passa por banco saudável", () => {
  it("migration que falha deixa upToDate false e nomeia onde parou", async () => {
    const saude = await describeDatabase(
      observando({
        aplicadas: 12,
        pendentes: ["0013_chamados_por_parametro", "0014_chamados_formato_real"],
        falha: { tag: "0013_chamados_por_parametro", code: "42703" },
      }),
    );

    expect(saude.reachable).toBe(true);
    expect(saude.upToDate).toBe(false);
    expect(saude.migrations?.failure).toEqual({
      tag: "0013_chamados_por_parametro",
      code: "42703",
    });
    expect(saude.migrations?.pending).toContain("0013_chamados_por_parametro");
    expect(saude.diagnostico.estado).not.toBe("SAUDAVEL");
    // O SQLSTATE atravessa em `migrations.failure.code`, acima. A mensagem do
    // driver não atravessa em canto nenhum, porque carrega host e usuário — e o
    // texto corrido nomeia a migration, que é o que quem opera precisa.
    expect(saude.detail).toMatch(/0013_chamados_por_parametro/);
    expect(JSON.stringify(saude)).not.toMatch(/postgres:\/\/|@|senha|password/i);
  });

  it("banco conectado com migrations faltando não se declara em dia", async () => {
    const saude = await describeDatabase(
      observando({ aplicadas: 18, pendentes: ["0018_identidade_forte", "0019_assistant_feedback"] }),
    );

    expect(saude.reachable).toBe(true);
    expect(saude.upToDate).toBe(false);
    expect(saude.migrations?.pending).toHaveLength(2);
    expect(saude.diagnostico.estado).not.toBe("SAUDAVEL");
  });

  it("o registro perdido de Production é reconhecido pelo nome", async () => {
    // O estado real medido em 15/08/2026: schema de pé, registro vazio, fila
    // morrendo na primeira migration por duplicata.
    const saude = await describeDatabase(
      observando({
        aplicadas: 0,
        pendentes: ["0000_freightcheck_foundation"],
        falha: { tag: "0000_freightcheck_foundation", code: "42710" },
      }),
    );

    expect(saude.upToDate).toBe(false);
    expect(saude.diagnostico.estado).toBe("REGISTRO_PERDIDO");
  });

  it("em dia é o único estado que se declara saudável", async () => {
    const saude = await describeDatabase(observando({}));
    expect(saude.upToDate).toBe(true);
    expect(saude.migrations?.pending).toEqual([]);
    expect(saude.migrations?.failure).toBeUndefined();
    expect(saude.diagnostico.estado).toBe("SAUDAVEL");
  });

  it("banco fora não vira 'em dia' por falta de informação", async () => {
    const saude = await describeDatabase(
      observando({ alcancavel: false, codigoDeConexao: "ECONNREFUSED", aplicadas: 0 }),
    );

    expect(saude.reachable).toBe(false);
    expect(saude.upToDate).toBe(false);
    expect(saude.migrations).toBeUndefined();
    expect(saude.diagnostico.estado).toBe("INDISPONIVEL");
  });
});
