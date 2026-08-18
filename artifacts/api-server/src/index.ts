import { writeSync } from "node:fs";
import { runMigrations } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";
import { requisicoesEmVoo, rotasEmVoo } from "./lib/em-voo";
import { deveMigrarNaPartida, lembrarRelatorio, migrationsFolder } from "./lib/migrations";

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
 *
 * **A política vem antes da conexão, e a ordem é a correção.** Aqui se lia
 * `DATABASE_URL` primeiro e migrava se ela existisse — o que fazia da presença
 * de um banco a classificação do ambiente, e em desenvolvimento sempre há um.
 * Agora `deveMigrarNaPartida()` decide antes, sem olhar a URL; a URL volta a ser
 * o que é, uma pré-condição de execução, e não um sinal de quem somos.
 *
 * Desligado, nada se perde de visibilidade: `observarBanco()` pergunta ao banco
 * a cada chamada de `/api/healthz` e continua listando o que falta. O que muda é
 * quem aplica — em Development, uma pessoa, por
 * `pnpm --filter @workspace/db run migrate`.
 */
async function applyMigrationsInBackground(): Promise<void> {
  const decisao = deveMigrarNaPartida();

  if (!decisao.migrar) {
    logger.info(
      { motivo: decisao.motivo },
      "Migrations não são aplicadas na partida neste ambiente. A fila avança por " +
        "`pnpm --filter @workspace/db run migrate`; /api/healthz continua dizendo o que falta.",
    );
    return;
  }

  const url = process.env["DATABASE_URL"];
  if (!url) {
    logger.warn(
      { motivo: decisao.motivo },
      "DATABASE_URL ausente; pulando migrations.",
    );
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

/**
 * A última linha do processo, quando alguém o manda embora.
 *
 * É a metade que faltava para fechar um diagnóstico que este projeto não
 * conseguiu fechar. Uma chamada que morre no meio aparece na tela como
 * `SEM_RESPOSTA`, e isso tem duas causas de conserto oposto: **reinício** (o
 * supervisor de `scripts/dev.mjs` manda `SIGTERM` a cada mudança de arquivo) ou
 * **corte no caminho** (tempo). O log não separava as duas porque em nenhuma
 * delas havia linha nenhuma.
 *
 * Com esta linha, separam-se por uma comparação de relógio: se houve `SIGTERM`
 * no mesmo instante do `requisicao encerrada sem resposta` de `lib/em-voo.ts`,
 * foi reinício — e `emVoo` diz quantas chamadas ficaram sem resposta junto. Se
 * não houve, o processo estava vivo e quem cortou foi outra camada.
 *
 * **Escrita direta em `stderr`, e não pelo `pino`.** O logger deste servidor
 * usa transport, que roda numa worker thread e escreve de forma assíncrona: o
 * processo morre antes de a linha sair, e a última mensagem — justamente esta —
 * é a que mais se perde. `writeSync` no descritor 2 chega sempre.
 *
 * **O sinal é reemitido, não trocado por `process.exit`.** Sem `listener`, o
 * Node encerra por sinal, e é assim que o supervisor lê a saída (`code` nulo,
 * `signal` preenchido). Sair com `exit(0)` faria o processo *parecer* ter
 * terminado sozinho e mudaria a mensagem que o supervisor imprime. Instrumento
 * que altera o que observa não serve: aqui se registra e devolve-se o sinal ao
 * comportamento padrão.
 */
function registrarDespedida(sinal: "SIGTERM" | "SIGINT"): void {
  process.on(sinal, () => {
    const emVoo = requisicoesEmVoo();
    const linha = JSON.stringify({
      evento: "sinal-de-encerramento",
      sinal,
      em: new Date().toISOString(),
      revision: process.env["BUILD_REVISION"] ?? "desconhecida",
      builtAt: process.env["BUILD_TIME"] ?? "desconhecido",
      pid: process.pid,
      dePeSegundos: Math.round(process.uptime()),
      emVoo,
      rotasEmVoo: rotasEmVoo(),
    });
    writeSync(
      2,
      `[api-server] ${linha}\n` +
        (emVoo > 0
          ? `[api-server] ${emVoo} requisicao(oes) ficaram sem resposta neste encerramento.\n`
          : ""),
    );

    process.removeAllListeners(sinal);
    process.kill(process.pid, sinal);
  });
}

registrarDespedida("SIGTERM");
registrarDespedida("SIGINT");

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
