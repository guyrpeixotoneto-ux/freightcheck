import { db } from "@workspace/db";
import { migrarComReparo } from "@workspace/db/fila";
import { varrerLeiturasOrfas } from "@workspace/ingest";
import { recensearPendentes } from "@workspace/balance";
import { preencherPresencasPendentes } from "@workspace/ingest";
import app from "./app";
import { alertar } from "./lib/alerta";
import { agendarBackups } from "./lib/backup-agendado";
import { logger } from "./lib/logger";
import {
  deveMigrarNaPartida,
  lembrarRelatorio,
  migrationsFolder,
  reconvergirNaPartida,
} from "./lib/migrations";
import { estadoDaProntidao } from "./lib/prontidao";
import { tentativaComecou, tentativaTerminou } from "./lib/partida";

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
 * O que "o processo reiniciou" precisa deixar de ser inferência.
 *
 * Até aqui, provar um restart do lado da API dependia de comparar `startedAt`
 * entre duas leituras de `/api/build` — funciona, mas só depois do fato, e só
 * se alguém pensar em olhar. O que faltava era o processo **dizer** quando
 * nasce e quando morre, com o mesmo `pid` e `revision` que `/api/build`
 * expõe — para que "reiniciou às 14h03" vire uma linha de log, e não uma
 * dedução a partir de dois carimbos.
 *
 * As quatro saídas continuam sendo as mesmas de sempre: `SIGTERM` (o
 * orquestrador pedindo para parar), `SIGINT` (Ctrl+C em desenvolvimento),
 * `uncaughtException` e `unhandledRejection` (o processo caindo sozinho).
 * Registrar um handler para `SIGTERM`/`SIGINT` desarma o comportamento padrão
 * do Node de encerrar sem avisar — por isso os dois chamam `process.exit`
 * explicitamente, depois de logar; sem isso o processo ignoraria o sinal e o
 * orquestrador precisaria de um `SIGKILL` para terminar, que é estritamente
 * pior. `uncaughtException` e `unhandledRejection` preservam o comportamento
 * anterior (processo termina) — a mudança é só que agora fica registrado
 * **com que `pid` e depois de quanto tempo de vida**, em vez de só no stderr
 * cru do runtime.
 */
const revisaoDoBuild = process.env["BUILD_REVISION"] ?? "desconhecida";
const partidaDoProcesso = process.hrtime.bigint();
const iniciadoEm = new Date().toISOString();

function uptimeMs(): number {
  return Number(process.hrtime.bigint() - partidaDoProcesso) / 1e6;
}

function dadosDoProcesso(): Record<string, unknown> {
  return {
    pid: process.pid,
    revision: revisaoDoBuild,
    startedAt: iniciadoEm,
    port,
    uptimeMs: uptimeMs(),
  };
}

logger.info({ ...dadosDoProcesso() }, "process.start");

function encerrarPorSinal(sinal: NodeJS.Signals): void {
  logger.info(
    { ...dadosDoProcesso(), signal: sinal },
    `process.${sinal.toLowerCase()}`,
  );
  process.exit(0);
}

process.on("SIGTERM", () => encerrarPorSinal("SIGTERM"));
process.on("SIGINT", () => encerrarPorSinal("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error(
    { ...dadosDoProcesso(), err },
    "process.uncaughtException — o processo vai terminar.",
  );
  process.exit(1);
});

process.on("unhandledRejection", (motivo) => {
  logger.error(
    { ...dadosDoProcesso(), err: motivo },
    "process.unhandledRejection — o processo vai terminar.",
  );
  process.exit(1);
});

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
 * **A porta aberta não é mais tráfego aceito, e essa é a correção de
 * 22/08/2026.** Abrir cedo continua obrigatório — é o probe —, mas entre o
 * `listen` e a convergência havia uma janela em que o roteador encaminhava
 * `/api/*` para um processo cujo banco podia estar em qualquer estado
 * anterior. Foi ela que fez um 03.08.18 perfeito virar "o servidor falhou",
 * porque a tela nova conversava com a lista fechada de antes da `0055`. Hoje o
 * portão de prontidão (`middlewares/portao-de-prontidao.ts`) recusa todo
 * tráfego de produto enquanto a fila deste build não estiver aplicada, e o
 * `/api/readyz` responde 503 no mesmo intervalo. O que roda em segundo plano é
 * a fila; o que espera por ela é o produto.
 *
 * Migration failure is logged but does NOT crash the process: crashing would
 * make the deployment look like a success (the previous version keeps
 * serving) but then the next restart would hit the same wall. Staying up
 * with the pendência visível em /api/healthz is the honest, recoverable
 * state — an operator can read it and act. E "de pé" deixou de poder ser
 * confundido com "pronto": `ready` sai no `/api/healthz`, `/api/readyz`
 * responde 503, as rotas de produto recusam, e a partida alerta
 * (`SERVICO_NAO_PRONTO`) em vez de terminar em silêncio.
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
    const { report, reparo } = await migrarComReparo(url, migrationsFolder());
    lembrarRelatorio(report);

    /*
      A fila parou e o reparo a destravou: faltava, no banco, estrutura de
      migration já registrada — o rastro de uma remoção por fora da fila. Sai
      alto e vira alerta pela mesma razão da reconvergência de baixo: o
      conteúdo daquelas tabelas não volta com elas, e ninguém descobre isso
      relendo o log da partida.
    */
    if (reparo && reparo.aplicados.length > 0) {
      logger.warn(
        { repostos: reparo.aplicados.map((a) => a.alvo) },
        "A fila esbarrou em objeto ausente de migration já registrada e foi " +
          "destravada por reposição estrutural. O conteúdo daqueles objetos " +
          "não volta sozinho.",
      );
      void alertar({
        tipo: "RECONVERGENCIA_REPOS",
        resumo:
          `${reparo.aplicados.length} objeto(s) de schema repostos para destravar a fila — ` +
          `algo os removeu por fora; o conteúdo deles não volta sozinho.`,
        detalhe: { repostos: reparo.aplicados.map((a) => a.alvo) },
      });
    }
    if (reparo && (reparo.semComando.length > 0 || reparo.falhas.length > 0)) {
      logger.error(
        { semComando: reparo.semComando, falhas: reparo.falhas },
        "O reparo que destravaria a fila não conseguiu repor tudo.",
      );
    }

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
      void alertar({
        tipo: "MIGRATION_FALHOU",
        resumo: `A migration ${report.failure.tag} falhou na partida; o schema está atrás do build.`,
        detalhe: { tag: report.failure.tag, code: report.failure.code },
      });
      return;
    }

    logger.info(
      {
        applied: report.applied,
        total: report.alreadyApplied.length + report.applied.length,
      },
      report.applied.length > 0
        ? "Migrations aplicadas."
        : "Nenhuma migration pendente.",
    );

    /*
      Depois da fila, a reconvergência: se o Provision desta publicação removeu
      objetos de migrations já registradas — o que ele faz quando Development
      está atrás, ver `@workspace/db/reconvergencia` —, é aqui que eles voltam,
      com DDL levantado das próprias migrations. Num deploy limpo o relatório
      sai vazio e esta linha não aparece.
    */
    const reconvergencia = await reconvergirNaPartida(url);
    if (!reconvergencia.rodou) {
      logger.info(
        { motivo: reconvergencia.motivo },
        "Reconvergência de schema não rodou.",
      );
    } else if (reconvergencia.relatorio.aplicados.length > 0) {
      logger.warn(
        {
          repostos: reconvergencia.relatorio.aplicados.map(
            (aplicado) => aplicado.alvo,
          ),
          semComando: reconvergencia.relatorio.semComando,
          falhas: reconvergencia.relatorio.falhas,
        },
        "O schema divergia do que o registro afirma — objetos repostos pela " +
          "fila na partida. A causa mais provável é o Provision do Publishing " +
          "ter espelhado um Development atrasado; o conteúdo de coluna " +
          "removida não volta, e é por isso que `publicar:conferir` antes de " +
          "todo Publish continua valendo.",
      );
      // Reposição estrutural é o rastro de uma mutilação: o conteúdo daquelas
      // colunas se perdeu (ex.: papéis voltam todos OPERADOR) e alguém precisa
      // decidir entre restaurar o backup ou refazer as decisões. Isso não pode
      // depender de alguém reler o log da partida.
      void alertar({
        tipo: "RECONVERGENCIA_REPOS",
        resumo:
          `${reconvergencia.relatorio.aplicados.length} objeto(s) de schema repostos na ` +
          `partida — algo os removeu por fora; o conteúdo deles não volta sozinho.`,
        detalhe: {
          repostos: reconvergencia.relatorio.aplicados.map((a) => a.alvo),
        },
      });
    } else if (
      reconvergencia.relatorio.semComando.length > 0 ||
      reconvergencia.relatorio.falhas.length > 0
    ) {
      logger.error(
        {
          semComando: reconvergencia.relatorio.semComando,
          falhas: reconvergencia.relatorio.falhas,
        },
        "Reconvergência incompleta — /api/healthz continua nomeando o que falta.",
      );
      void alertar({
        tipo: "RECONVERGENCIA_INCOMPLETA",
        resumo: "A partida não conseguiu repor todos os objetos de schema.",
        detalhe: {
          semComando: reconvergencia.relatorio.semComando,
          falhas: reconvergencia.relatorio.falhas,
        },
      });
    }
  } catch (err) {
    logger.error(
      { err },
      "Não foi possível sequer tentar as migrations — o servidor continua no ar, mas /api/healthz vai reportar o schema desatualizado.",
    );
    void alertar({
      tipo: "MIGRATION_FALHOU",
      resumo:
        "A partida não conseguiu sequer tentar as migrations — banco fora ou pasta ausente.",
      detalhe: { erro: err instanceof Error ? err.message : String(err) },
    });
  }

  /*
    O histórico anterior ao censo é recenseado aqui — depois da fila, nunca
    dentro dela.

    A `0080` cria a tabela; quem a preenche é isto. Ficou fora da
    migration de propósito: a classificação de um acervo grande leva segundos, e
    uma migration que não termina é uma partida que não termina. Aqui é uma
    importação por vez, reentrante, e o servidor já está respondendo.

    **Não bloqueia nada, e não precisa.** Enquanto uma importação não tem censo,
    ela não tem linha na tabela e `listarBalancos` calcula aquele run na hora —
    a resposta é a mesma desde o primeiro instante, e só fica mais rápida
    conforme isto avança. Falhar aqui deixa o produto exatamente como estava
    antes da mudança, que é o pior caso aceitável para um backfill.
  */
  try {
    const recenseadas = await recensearPendentes(db);
    if (recenseadas > 0) {
      logger.info(
        { importacoes: recenseadas },
        "Censo do balanço gravado para as importações que ainda não tinham — " +
          "`GET /api/balance` deixa de reclassificar o acervo a cada leitura.",
      );
    }
  } catch (err) {
    logger.warn(
      { err },
      "Backfill do censo do balanço não completou; a leitura calcula na hora as " +
        "importações que faltarem, como antes.",
    );
  }

  /*
    O mesmo para a presença das vigências (`0081`) — e pelas mesmas razões:
    fora da migration porque o custo cresce com o acervo, em segundo plano
    porque a leitura não depende dele, e tolerante a falha porque a vigência
    sem presença continua sendo contada na hora, como sempre foi.
  */
  try {
    const preenchidas = await preencherPresencasPendentes(db);
    if (preenchidas > 0) {
      logger.info(
        { vigencias: preenchidas },
        "Presença gravada para as vigências que ainda não tinham — o seletor de " +
          "tipos e a Visão Geral deixam de reler os fatos para contar entidades.",
      );
    }
  } catch (err) {
    logger.warn(
      { err },
      "Backfill da presença não completou; as vigências que faltarem continuam " +
        "sendo contadas na leitura, como antes.",
    );
  }
}

/**
 * Depois da tentativa: o processo está pronto, ou está no ar e recusando?
 *
 * **Isto existe porque "no ar" nunca quis dizer "pronto", e ninguém dizia a
 * diferença.** A falha da fila já alertava; o que não existia era o estado que
 * sobra depois dela — um processo de pé, com a porta aberta, recusando todo
 * tráfego de produto. Ele não pode depender de alguém reler o log da partida
 * nem de alguém abrir a tela e receber 503: sai alto, e vira alerta, na mesma
 * classe de tudo o que deixa o produto indisponível.
 *
 * A medição é a mesma do portão e a mesma do `/healthz` — `estadoDaProntidao`,
 * que pergunta a `diagnosticar`. A partida não declara prontidão nenhuma: se
 * declarasse, seria uma segunda versão da verdade, e as duas discordariam no
 * minuto em que outra instância aplicasse a fila.
 */
async function anunciarProntidao(): Promise<void> {
  try {
    const estado = await estadoDaProntidao();
    if (estado.pronto) {
      logger.info(
        {},
        "Pronto: a fila deste build está aplicada neste banco, e as rotas de produto respondem.",
      );
      return;
    }
    logger.error(
      {
        estado: estado.diagnostico.estado,
        acao: estado.diagnostico.acao?.codigo,
      },
      "NO AR E NÃO PRONTO — as rotas de produto respondem 503 até a fila deste " +
        "build ser aplicada. /api/readyz responde 503 e /api/healthz traz ready:false.",
    );
    void alertar({
      tipo: "SERVICO_NAO_PRONTO",
      resumo:
        `O servidor subiu e não está pronto (${estado.diagnostico.estado}): o tráfego de ` +
        `produto é recusado até a fila deste build ser aplicada.`,
      detalhe: {
        estado: estado.diagnostico.estado,
        evidencia: estado.diagnostico.evidencia,
      },
    });
  } catch (err) {
    /* Medir falhou — e medir é leitura. Não muda o portão (que mede por
       chamada); muda o que se sabe daqui, e por isso sai alto. */
    logger.error({ err }, "Não foi possível medir a prontidão na partida.");
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

  /*
    A fila roda depois do bind — é o que mantém a janela do startup probe
    limpa. O que mudou é o que acontece **enquanto** ela roda: o portão de
    prontidão recusa tráfego de produto até o banco convergir (ver
    `middlewares/portao-de-prontidao.ts`), e a partida diz alto em que dos dois
    estados ela terminou.
  */
  /*
    O fato que `/api/startupz` publica: a tentativa começou aqui, e termina —
    em qualquer um dos desfechos internos de `applyMigrationsInBackground`,
    inclusive os que retornam cedo — na linha seguinte. Ver `lib/partida.ts`
    para o que esse fato é e o que ele deliberadamente não é.
  */
  tentativaComecou();
  void applyMigrationsInBackground()
    .catch((err) => {
      logger.error(
        { err },
        "A tentativa de partida terminou por exceção não tratada.",
      );
    })
    .finally(() => {
      tentativaTerminou("A tentativa de partida terminou.");
    })
    .then(anunciarProntidao);

  // Depois da fila, a cópia: com BACKUP_DIR definido, toda partida confere a
  // idade do último dump e repõe o que envelheceu — ver backup-agendado.ts.
  agendarBackups();

  // E a varredura de leituras órfãs: um run preso em PENDING/READING por um
  // reinício era um beco sem saída para o usuário (reenvio recusado como
  // duplicata, exclusão recusada como "ainda lendo"). Ver lib/ingest/recuperacao.
  agendarVarreduraDeOrfas();
});

function agendarVarreduraDeOrfas(): void {
  if (!process.env["DATABASE_URL"]) return;

  const varrer = async (momento: string): Promise<void> => {
    try {
      const relatorio = await varrerLeiturasOrfas(db);
      if (relatorio.importacoes.length > 0 || relatorio.chamados.length > 0) {
        logger.warn(
          {
            momento,
            importacoes: relatorio.importacoes,
            chamados: relatorio.chamados,
          },
          "Leituras órfãs encontradas e encerradas — o reinício levou o processo " +
            "que as terminaria. Os arquivos podem ser excluídos e reenviados.",
        );
        void alertar({
          tipo: "LEITURA_ORFA_ENCERRADA",
          resumo:
            `${relatorio.importacoes.length + relatorio.chamados.length} leitura(s) ` +
            `órfã(s) encerrada(s) — um reinício interrompeu importação em andamento.`,
          detalhe: {
            momento,
            importacoes: relatorio.importacoes.length,
            chamados: relatorio.chamados.length,
          },
        });
      }
    } catch (err) {
      logger.error({ err, momento }, "A varredura de leituras órfãs falhou.");
    }
  };

  void varrer("partida");
  const timer = setInterval(() => void varrer("intervalo"), 5 * 60_000);
  timer.unref();
}
