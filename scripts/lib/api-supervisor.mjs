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
 * @param {null|(() => Promise<{ok: boolean, output: string}>)} deps.runMigrations
 *   `null` quando não há `DATABASE_URL` — sem banco configurado não há o que
 *   aplicar, e isso não é motivo para não subir.
 * @param {() => Promise<{ok: boolean, output: string}>} deps.runBuild
 * @param {() => {on: Function, kill: Function}} deps.spawnServer
 * @param {(port: number|string, reason: string) => Promise<any>} [deps.listenExplainer]
 */
export function createApiSupervisor({
  port,
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
      replacing = true;
      server.kill("SIGTERM");
      server = null;
    }
    const child = spawnServer();
    server = child;
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

  async function rebuild() {
    if (building) {
      queued = true;
      return;
    }
    building = true;
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
      await rebuild();
    }
  }

  return {
    async start() {
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
