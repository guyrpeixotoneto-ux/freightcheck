import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  MIGRATIONS_FOLDER,
  appliedMigrations,
  readMigrations,
  type MigrationReport,
} from "@workspace/db/migrate";
import type { EstadoObservado } from "@workspace/db/diagnostico";
import { bridgePendente } from "@workspace/db/bridge-marcador";

/**
 * O que este processo sabe sobre as migrations: quais ele carrega e o que
 * aconteceu quando tentou aplicá-las.
 *
 * Existia um buraco entre as duas coisas. As migrations rodam em segundo plano
 * depois que a porta abre (ver `index.ts`), e uma falha ali só aparecia no log
 * do processo — que ninguém lê de fora. Enquanto isso `/api/healthz` respondia
 * `migrated: true` porque perguntava por *uma* tabela antiga, e a tela que
 * dependia de uma tabela nova recebia 500 sem nenhuma pista de que faltava uma
 * migration. Foi exatamente o que aconteceu com o Book do Operador.
 *
 * Aqui o processo guarda o relatório da partida, e `health.ts` o publica ao
 * lado do que o banco responde agora.
 */

/**
 * A pasta de migrations que este processo enxerga.
 *
 * No repositório é `lib/db/migrations`; no bundle é a cópia que o `build.mjs`
 * deixa ao lado do `dist/index.mjs`. A escolha é feita uma vez, aqui, para que
 * o servidor e o diagnóstico nunca respondam sobre pastas diferentes.
 */
export function migrationsFolder(): string {
  const bundled = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );
  return existsSync(bundled) ? bundled : MIGRATIONS_FOLDER;
}

/** As tags que este build carrega, na ordem, com o carimbo de cada uma. */
export function expectedMigrations(): { tag: string; when: number }[] {
  return readMigrations(migrationsFolder()).map(({ tag, when }) => ({
    tag,
    when,
  }));
}

/** O que o servidor decidiu sobre migrar na partida, e por quê. */
export interface DecisaoDeMigracao {
  migrar: boolean;
  /** A frase que vai para o log. Ela nomeia o sinal que decidiu, não o efeito. */
  motivo: string;
}

/** A chave que decide, quando alguém quer decidir explicitamente. */
const CHAVE = "DB_MIGRATE_ON_BOOT";

const SIM = new Set(["1", "true", "yes", "on"]);
const NAO = new Set(["0", "false", "no", "off"]);

/**
 * Este ambiente aplica a fila versionada ao subir?
 *
 * **O defeito que esta função existe para fechar.** A regra — *Development não
 * avança sozinho* — estava escrita em `scripts/dev.mjs`, na forma de um
 * `runMigrations: null` que desliga o passo de migração **do supervisor**. Só
 * que o supervisor não migra o banco: quem migra é o servidor que ele sobe, e o
 * servidor decidia por conta própria, olhando apenas se `DATABASE_URL` existia.
 * Em desenvolvimento ela sempre existe. O resultado era um `Run` que avançava o
 * banco de desenvolvimento enquanto o console imprimia, na mesma partida, que
 * não avançaria — Development chegou à `0021` por esse caminho.
 *
 * A regra estava na camada errada: quem precisa conhecê-la é o processo que
 * abre conexão, não o que o inicia. Aqui ela está no processo certo, isolada do
 * efeito, e por isso pode ser provada sem banco.
 *
 * **`DATABASE_URL` não classifica ambiente, e nunca foi capaz disso.** Ela diz
 * que existe um banco alcançável — desenvolvimento, teste e produção têm um. O
 * que ela não diz é de quem ele é. Esta função não a lê; o chamador é que trata
 * a ausência dela, e depois de já ter decidido a política.
 *
 * **A ordem dos sinais.** `DB_MIGRATE_ON_BOOT` vence quando dita, porque é a
 * única forma de fixar a resposta para um ambiente que ainda não existe — um
 * Preview, um job, uma réplica de leitura que não pode escrever schema. Sem ela,
 * decide `NODE_ENV`, que os dois lados já configuram por escrito: `dev.mjs`
 * passa `development` ao subir o servidor, e o `[services.production.run.env]`
 * do artifact passa `production`.
 *
 * **Valor não reconhecido não desliga nada.** Um `DB_MIGRATE_ON_BOOT=sim` — ou
 * um espaço a mais — cai de volta no `NODE_ENV` em vez de virar "não migre", e
 * o motivo carrega o valor recusado. Um erro de digitação numa variável de
 * deploy não pode ser o que trava a fila de Production; ele tem que aparecer no
 * log e deixar o comportamento correto de pé.
 */
export function deveMigrarNaPartida(
  env: Partial<Record<string, string | undefined>> = process.env,
): DecisaoDeMigracao {
  const bruto = env[CHAVE];
  const explicito = bruto?.trim().toLowerCase();

  if (explicito !== undefined && explicito !== "") {
    if (SIM.has(explicito)) {
      return { migrar: true, motivo: `${CHAVE}=${bruto}` };
    }
    if (NAO.has(explicito)) {
      return { migrar: false, motivo: `${CHAVE}=${bruto}` };
    }
  }

  const naoReconhecido =
    explicito !== undefined && explicito !== "" && !SIM.has(explicito) && !NAO.has(explicito)
      ? ` (${CHAVE}=${bruto} não é um valor reconhecido e foi ignorado)`
      : "";

  const ambiente = env["NODE_ENV"];
  if (ambiente === "production") {
    return { migrar: true, motivo: `NODE_ENV=production${naoReconhecido}` };
  }

  return {
    migrar: false,
    motivo: `NODE_ENV=${ambiente ?? "não definido"}${naoReconhecido}`,
  };
}

let ultimoRelatorio: MigrationReport | undefined;

export function lembrarRelatorio(report: MigrationReport): void {
  ultimoRelatorio = report;
}

/** O relatório da última tentativa deste processo, se houve alguma. */
export function relatorioDaPartida(): MigrationReport | undefined {
  return ultimoRelatorio;
}

/**
 * O estado do banco **agora**, perguntando a ele.
 *
 * A lista de aplicadas vem do banco a cada chamada, e não do que este processo
 * fez na partida: quem migrou pode ter sido outra instância, ou uma pessoa pela
 * linha de comando, e a resposta precisa valer para agora. O relatório da
 * partida entra só para dizer *onde parou* — informação que o banco não guarda,
 * e sem a qual não dá para distinguir "ninguém rodou ainda" de "rodou e falhou".
 *
 * Esta é a única leitura do estado no servidor. O `/api/healthz` e as rotas que
 * esbarram num schema ausente chamam a mesma função, e por isso não têm como
 * chegar a conclusões diferentes sobre o mesmo banco no mesmo instante.
 */
export async function observarBanco(
  databaseUrl: string | undefined = process.env["DATABASE_URL"],
): Promise<EstadoObservado> {
  if (!databaseUrl) {
    return { configurada: false, alcancavel: false, pendentes: [], aplicadas: 0 };
  }

  const esperadas = expectedMigrations();
  try {
    // Num banco vazio a tabela de registro também não existe, e perguntar por
    // ela devolveria um erro que se leria como "o banco caiu".
    const resultado = await db.execute<{ migrated: boolean }>(
      sql`select to_regclass('public.import_run') is not null as migrated`,
    );
    const temSchema = Boolean(resultado.rows[0]?.migrated);
    const aplicadas = temSchema
      ? new Set<number>(await appliedMigrations(db))
      : new Set<number>();
    const pendentes = esperadas
      .filter((migration) => !aplicadas.has(migration.when))
      .map((migration) => migration.tag);
    const falha = relatorioDaPartida()?.failure;

    /*
      O bridge é perguntado aqui, e não numa rota, porque é a mesma leitura que
      o `/healthz` e as rotas de schema ausente compartilham — e é o que permite
      um bridge pela metade aparecer **antes** de alguma tela quebrar. Até aqui
      esse estado só se manifestava quando uma consulta morria, o que podia
      levar semanas: em 16/08/2026 levou até alguém abrir a única tela que lia a
      coluna que o bridge tinha removido.
    */
    const bridge = await bridgePendente(async (texto) => {
      const r = await db.execute<Record<string, unknown>>(sql.raw(texto));
      return { rows: r.rows };
    });

    return {
      configurada: true,
      alcancavel: true,
      pendentes,
      aplicadas: esperadas.length - pendentes.length,
      temSchema,
      ...(bridge.pendente
        ? {
            bridgePendente: bridge.desde ? { desde: bridge.desde } : {},
          }
        : {}),
      ...(falha
        ? { falha: { tag: falha.tag, ...(falha.code ? { code: falha.code } : {}) } }
        : {}),
    };
  } catch (err) {
    const codigo =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    // `pendentes` fica vazio de propósito: com o banco fora não se sabe o que
    // ele tem, e `diagnosticar` decide por `alcancavel` antes de olhar a lista.
    return {
      configurada: true,
      alcancavel: false,
      ...(codigo ? { codigoDeConexao: codigo } : {}),
      pendentes: [],
      aplicadas: 0,
    };
  }
}
