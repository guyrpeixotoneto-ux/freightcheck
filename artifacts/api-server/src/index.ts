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
 * Apply migrations after the server is already listening.
 *
 * Previous approach: await ensureSchema(), then app.listen().
 * Problem: the production DB connection (SSL negotiation + potential timeout)
 * blocks app.listen() for up to 60 s, which is longer than the autoscale
 * startup probe timeout. The probe gives up, the build fails — even though
 * the server code is perfectly fine.
 *
 * Correct approach: bind the port first so the startup probe can land on
 * /api/healthz, then run migrations in the background. The health route
 * always returns HTTP 200 and already exposes `migrated: true/false`, so the
 * probe passes immediately and the operator knows the DB state from the
 * response body.
 *
 * Migration failure is logged but does NOT crash the process: crashing would
 * make the deployment look like a success (the previous version keeps
 * serving) but then the next restart would hit the same wall. Staying up
 * with `migrated: false` visible on /api/healthz is the honest, recoverable
 * state — an operator can read it and act.
 */
async function applyMigrationsInBackground(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    logger.warn("DATABASE_URL ausente; pulando migrations.");
    return;
  }

  const bundled = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );

  try {
    await runMigrations(url, existsSync(bundled) ? bundled : undefined);
    logger.info("Migrations aplicadas.");
  } catch (err) {
    logger.error(
      { err },
      "Falha ao aplicar migrations — o servidor continua no ar, mas /api/healthz vai reportar migrated:false.",
    );
  }
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

  // Migrations run after binding — keeps the startup probe window clean.
  void applyMigrationsInBackground();
});
