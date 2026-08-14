import { runMigrations } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";
import { lembrarRelatorio, migrationsFolder } from "./lib/migrations";

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
 * with the pendência visível em /api/healthz is the honest, recoverable
 * state — an operator can read it and act.
 *
 * **O relatório é guardado, não só logado.** Log de deployment é o lugar onde
 * uma falha de migration ia morrer: quem abre a tela e recebe 500 não tem como
 * lê-lo. Guardado aqui, ele sai por `/api/healthz`, que é onde a interface já
 * vai perguntar o motivo quando uma chamada falha.
 */
async function applyMigrationsInBackground(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    logger.warn("DATABASE_URL ausente; pulando migrations.");
    return;
  }

  try {
    const report = await runMigrations(url, migrationsFolder());
    lembrarRelatorio(report);

    if (report.failure) {
      logger.error(
        {
          tag: report.failure.tag,
          code: report.failure.code,
          err: report.failure.message,
          applied: report.applied,
          pending: report.pending,
        },
        "Uma migration falhou — as anteriores ficaram aplicadas, as seguintes não foram tentadas. /api/healthz mostra quais faltam.",
      );
      return;
    }

    logger.info(
      { applied: report.applied, total: report.alreadyApplied.length + report.applied.length },
      report.applied.length > 0
        ? "Migrations aplicadas."
        : "Nenhuma migration pendente.",
    );
  } catch (err) {
    logger.error(
      { err },
      "Não foi possível sequer tentar as migrations — o servidor continua no ar, mas /api/healthz vai reportar o schema desatualizado.",
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
