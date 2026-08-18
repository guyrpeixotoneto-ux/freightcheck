/**
 * Supervisionar o api-server em desenvolvimento.
 *
 * O roteador do Replit encaminha `/api` para uma porta e não pergunta a
 * ninguém se tem alguém lá. Se não tiver, ele responde 502 com o corpo vazio —
 * e 502 de corpo vazio é a pior mensagem de erro possível, porque não diz nem
 * de que camada veio. Foi o que este projeto viu por dias seguidos.
 *
 * A versão anterior deste código tinha dois caminhos que terminavam
 * exatamente assim, sem servidor nenhum na porta:
 *
 *   - migrations falhando derrubavam o processo inteiro (`shutdown`), e a única
 *     explicação ficava no console de quem não estava olhando;
 *   - build falhando na primeira execução caía no ramo "mantendo o processo
 *     anterior", que na primeira execução não existe. O script seguia vivo,
 *     observando arquivos, sem nunca ter subido nada.
 *
 * A regra agora é uma só: **a porta da API sempre tem alguém, e quando não é a
 * API é alguém que sabe dizer por quê.** Se o servidor não pode subir, um
 * explicador ocupa a porta e responde 503 com a razão em JSON — que é o formato
 * que a interface já sabe ler e mostrar na tela.
 */
import http from "node:http";

/**
 * Últimas linhas úteis da saída de um comando, para caber numa mensagem.
 *
 * Quadros de stack e linhas que são só pontuação ocupam o lugar da frase que
 * interessa — e o destino disto é um card na tela, não um terminal. O que
 * sobra é a linha que nomeia a falha.
 */
export function tail(output, lines = 6, limit = 500) {
  const texto = (output ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .filter((l) => !/^at\s/.test(l))
    .filter((l) => !/^[[\]{}(),;:'"`|]+$/.test(l))
    .slice(-lines)
    .join(" · ");
  return texto.length > limit ? `${texto.slice(0, limit)}…` : texto;
}

/**
 * Um servidor que existe só para dizer por que o outro não existe.
 *
 * Responde 503 a qualquer requisição, com `{ error }` em JSON: 503 é o que de
 * fato aconteceu — o serviço existe e não está em condição de responder — e o
 * corpo em JSON chega à tela em vez de morrer como um número solto.
 */
export function startExplainer(port, reason) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: reason }));
    });
    server.on("error", reject);
    server.listen(Number(port), () => resolve(server));
  });
}

/**
 * @param {object} deps
 * @param {number|string} deps.port          porta que o roteador encaminha
 * @param {null|(() => Promise<{ok: boolean, output: string}>)} [deps.runInstall]
 *   Instala as dependências do workspace antes de qualquer outra coisa.
 *   `null` para pular — os testes não precisam de node_modules.
 * @param {null|(() => Promise<{ok: boolean, output: string}>)} deps.runMigrations
 *   `null` quando não há `DATABASE_URL` — sem banco configurado não há o que
 *   aplicar, e isso não é motivo para não subir.
 * @param {() => Promise<{ok: boolean, output: string}>} deps.runBuild
 * @param {() => {on: Function, kill: Function}} deps.spawnServer
 * @param {(port: number|string, reason: string) => Promise<any>} [deps.listenExplainer]
 */
export function createApiSupervisor({
  port,
  runInstall = null,
  runMigrations,
  runBuild,
  spawnServer,
  listenExplainer = startExplainer,
  log = console.log,
  error = console.error,
}) {
  let server = null;
  let explainer = null;
  let building = false;
  let queued = false;
  let replacing = false;
  let stopped = false;

  async function clearExplainer() {
    if (!explainer) return;
    const atual = explainer;
    explainer = null;
    // As conexões vivas seguram o `close` e a porta junto — e a porta é
    // justamente o que o servidor de verdade precisa a seguir.
    atual.closeAllConnections?.();
    await new Promise((resolve) => atual.close(resolve));
  }

  /** Ocupa a porta com a razão pela qual a API não está lá. */
  async function explain(reason) {
    if (stopped) return;
    error(`[api] ${reason}`);
    await clearExplainer();
    if (server) return; // o servidor de verdade está de pé; a porta é dele
    try {
      explainer = await listenExplainer(port, reason);
    } catch (err) {
      // Se nem o explicador consegue a porta, alguém já está nela: dizer isso é
      // mais útil do que tentar de novo em silêncio.
      error(
        `[api] a porta ${port} não pôde ser ocupada (${err?.code ?? err}). ` +
          `Provavelmente há outro processo nela — suba o ambiente só pelo Run.`,
      );
    }
  }

  function restartServer() {
    if (server) {
      /*
        A hora exata em que o processo anterior foi mandado embora.

        Existe para fechar um diagnóstico: uma chamada que morre no meio chega à
        tela como `SEM_RESPOSTA`, e as duas causas possíveis — reinício ou tempo
        — pediam consertos opostos sem que nada no log as separasse. Esta linha
        é o carimbo do lado de cá; o do lado de lá é a despedida que o próprio
        servidor escreve (`artifacts/api-server/src/index.ts`), com quantas
        requisições estavam em voo. Duas linhas no mesmo segundo = reinício.
      */
      log(
        `[api] ${new Date().toISOString()} reiniciando: SIGTERM no processo ` +
          `anterior (pid ${server.pid}). Requisições em voo agora morrem sem ` +
          `resposta — é assim que este reinício aparece na tela.`,
      );
      replacing = true;
      server.kill("SIGTERM");
      server = null;
    }
    const child = spawnServer();
    server = child;
    log(`[api] ${new Date().toISOString()} processo novo no ar (pid ${child.pid}).`);
    child.on("exit", (code) => {
      if (child !== server) return;
      server = null;
      if (replacing || stopped) {
        replacing = false;
        return;
      }
      // Morrer sozinho era o caminho mais confuso que este projeto produziu: a
      // interface seguia no ar, parecendo atual, e a API sumia sem nota.
      void explain(
        `o api-server encerrou sozinho (código ${code}). Enquanto ele não ` +
          `voltar, nenhuma chamada de API tem resposta.`,
      );
    });
    return child;
  }

  async function rebuild(motivo = "partida") {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    // O motivo entra no log porque é ele que liga o reinício à sua causa: sem
    // isso, "o servidor reiniciou" é um fato sem responsável, e a pergunta
    // "por que a chamada morreu?" volta ao ponto de partida.
    log(`[api] ${new Date().toISOString()} build iniciado (motivo: ${motivo}).`);
    const { ok, output } = await runBuild();
    building = false;

    if (ok) {
      // A porta tem que estar livre antes de o servidor de verdade tentar.
      await clearExplainer();
      restartServer();
    } else if (server) {
      // Um build quebrado não derruba o que está de pé: o processo anterior
      // continua servindo até o código voltar a compilar.
      error("[api] build falhou; mantendo o processo anterior.");
    } else {
      await explain(
        `a API não subiu: o build falhou e não havia processo anterior para ` +
          `manter. ${tail(output)}`,
      );
    }

    if (queued) {
      queued = false;
      await rebuild("mudança enfileirada durante o build anterior");
    }
  }

  return {
    async start() {
      if (runInstall) {
        const { ok, output } = await runInstall();
        if (!ok) {
          // Sem node_modules em dia não há migration nem build: as duas coisas
          // rodam por `pnpm --filter`, e o esbuild resolve os pacotes do
          // workspace pelos symlinks que só o install cria. Parar aqui, com o
          // motivo, evita que a falha reapareça duas etapas adiante como
          // "Could not resolve @workspace/...", que não se parece com a causa.
          await explain(
            `a API não subiu: o \`pnpm install\` falhou, e sem as dependências ` +
              `instaladas o build não resolve os pacotes do workspace. ` +
              `${tail(output)}`,
          );
          return this;
        }
      }
      if (runMigrations) {
        const { ok, output } = await runMigrations();
        if (!ok) {
          // Subir contra um schema desatualizado produz erro longe da causa,
          // então o servidor continua não subindo. O que mudou é que agora
          // alguém na porta diz isso, em vez de o processo sumir.
          await explain(
            `a API não subiu: as migrations falharam, e subir contra um schema ` +
              `desatualizado esconderia a causa. ${tail(output)}`,
          );
          return this;
        }
      }
      await rebuild();
      return this;
    },

    /** Rebuild disparado pelo watcher de arquivos. */
    rebuild,

    /** Só para os testes e para o encerramento: o que está na porta agora. */
    state() {
      return server ? "server" : explainer ? "explainer" : "nada";
    },

    async stop() {
      stopped = true;
      await clearExplainer();
      if (server) server.kill("SIGTERM");
    },
  };
}
