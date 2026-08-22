import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Quem converge o schema de Development, e por qual camada.
 *
 * Este arquivo já provou o contrário do que prova hoje, e a mudança de sinal é
 * deliberada. A regra "Development só avança à mão" existiu para a era do
 * bridge, quando Production estava atrás da fila e qualquer avanço automático
 * de Development fabricava diff no Publishing. Production alcançou a cabeça da
 * fila, e a mesma regra passou a produzir o estado inverso — Development
 * atrás —, que é o que faz o Provision propor **remover** de Production o que
 * as migrations criaram. Foi o diff destrutivo de 17 e 18/08/2026, e ele
 * apagou decisão humana que nenhuma reconvergência devolve.
 *
 * Os dois sentidos não se equivalem: Development à frente produz proposta
 * aditiva (pior caso: deploy recusado, zero perda); Development atrás produz
 * proposta destrutiva (pior caso: perda de dado). O que estas provas prendem:
 *
 * 1. **A camada continua certa.** `dev.mjs` (supervisor) não migra — quem abre
 *    conexão é o servidor, e é o servidor que decide e loga. Foi a lição do
 *    defeito antigo, e ela não mudou.
 * 2. **O sentido é o seguro.** A política do servidor converge Development
 *    (`NODE_ENV=development` migra), e o `post-merge` aplica a fila logo no
 *    merge — a janela "Development atrás" dura os segundos entre o pull e a
 *    fila, não até alguém lembrar de um comando.
 * 3. **Testes continuam fora.** `NODE_ENV=test` e ambiente sem `NODE_ENV` não
 *    migram: a suíte cria banco descartável por arquivo.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");

const EXECUCAO = /(runCaptured|spawnChild|spawn)\s*\([^)]*migrate/s;

describe("a camada: o supervisor não migra — o servidor decide e loga", () => {
  it("scripts/dev.mjs não aplica migrations por conta própria", () => {
    const fonte = ler("scripts/dev.mjs");
    expect(fonte).toMatch(/runMigrations:\s*null/);

    const executavel = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(executavel).not.toMatch(EXECUCAO);
  });

  it("dev.mjs identifica o ambiente do servidor por escrito", () => {
    expect(ler("scripts/dev.mjs")).toMatch(/NODE_ENV:\s*"development"/);
  });

  it("o api-server consulta a política antes de olhar o banco", () => {
    const index = ler("artifacts/api-server/src/index.ts");
    const executavel = index
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

    expect(executavel).toMatch(/deveMigrarNaPartida\(\)/);
    expect(executavel.indexOf("deveMigrarNaPartida()")).toBeLessThan(
      executavel.indexOf('process.env["DATABASE_URL"]'),
    );
  });
});

describe("o sentido: Development converge, e converge cedo", () => {
  /*
    O prazo é do `import`, e não da prova.

    `deveMigrarNaPartida` é função pura e decide em 1 ms; o que leva segundos é
    trazer o módulo, porque ele arrasta `@workspace/db` e o vitest transpila o
    diretório de schema inteiro na hora. No CI este pacote é o último do shard
    `unit` e roda com a máquina ocupada pelas suítes de banco dos outros — o
    mesmo import que custa ~1 s numa máquina ociosa estourou os 5 s padrão ali,
    e reprovou uma afirmação sobre política de migration por causa do tempo de
    carregar um arquivo.

    O prazo explícito é o conserto certo porque a prova continua inteira: a
    asserção é a mesma, e o que deixou de ser medido contra ela é o custo de
    compilar o módulo que ela examina.
  */
  it("a política dá `true` para o ambiente que o dev.mjs monta", async () => {
    const { deveMigrarNaPartida } = await import(
      "../../artifacts/api-server/src/lib/migrations.ts"
    );

    const decisao = deveMigrarNaPartida({
      NODE_ENV: "development",
      PORT: "8080",
      DATABASE_URL: "postgres://user:senha@localhost:5432/freightcheck",
    });

    expect(decisao.migrar).toBe(true);
  }, 60_000);

  it("scripts/post-merge.sh aplica a fila quando há banco", () => {
    const fonte = ler("scripts/post-merge.sh");
    const executavel = fonte
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");

    expect(executavel).toMatch(/pnpm --filter @workspace\/db run migrate/);
    // E diz o que fazer quando não há banco, em vez de falhar mudo.
    expect(fonte).toMatch(/DATABASE_URL/);
  });
});

describe("testes continuam fora da convergência automática", () => {
  it("NODE_ENV=test e ambiente sem NODE_ENV não migram", async () => {
    const { deveMigrarNaPartida } = await import(
      "../../artifacts/api-server/src/lib/migrations.ts"
    );
    expect(deveMigrarNaPartida({ NODE_ENV: "test" }).migrar).toBe(false);
    expect(deveMigrarNaPartida({}).migrar).toBe(false);
  });
});
