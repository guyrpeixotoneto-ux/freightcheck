import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * O schema antes de atender.
 *
 * Fora do desenvolvimento nada aplicava as migrations: o `scripts/dev.mjs` faz
 * isso, mas um ambiente publicado só recebe o bundle e sobe. O servidor
 * respondia normalmente e todas as rotas que tocam o banco falhavam, um erro
 * que aparece longe da causa. Migrar aqui é a única forma de o serviço
 * garantir aquilo de que depende.
 *
 * A pasta é a que o build copiou para junto do bundle; fora do bundle, cai na
 * do repositório.
 */
async function ensureSchema(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    logger.warn("DATABASE_URL ausente; subindo sem aplicar migrations.");
    return;
  }
  const bundled = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );
  await runMigrations(url, existsSync(bundled) ? bundled : undefined);
  logger.info("Migrations aplicadas.");
}

try {
  await ensureSchema();
} catch (err) {
  // Atender com o schema errado é pior do que não atender: as respostas
  // sairiam, e erradas. Num produto de auditoria isso é o pior desfecho.
  logger.error({ err }, "Falha ao aplicar migrations; o servidor não vai subir");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    {
      port,
      revision: process.env["BUILD_REVISION"] ?? "desconhecida",
      builtAt: process.env["BUILD_TIME"] ?? "desconhecido",
    },
    "Server listening",
  );
});
