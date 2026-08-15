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

    return {
      configurada: true,
      alcancavel: true,
      pendentes,
      aplicadas: esperadas.length - pendentes.length,
      temSchema,
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
