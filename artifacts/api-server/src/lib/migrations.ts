import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MIGRATIONS_FOLDER,
  readMigrations,
  type MigrationReport,
} from "@workspace/db/migrate";

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
