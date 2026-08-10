/**
 * O que se exige aqui é uma frase só: a porta da API nunca fica vazia.
 *
 * Cada teste abaixo é um caminho que, na versão anterior, terminava sem nada
 * escutando — e portanto em 502 de corpo vazio, o erro que não diz nem de que
 * camada veio. Nenhum deles inventa o cenário: são os três que de fato
 * aconteceram (migrations falhando, build falhando na primeira execução, e o
 * servidor morrendo sozinho depois de subir).
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiSupervisor, tail } from "../lib/api-supervisor.mjs";

/** Uma porta alta e improvável, diferente por teste para não haver corrida. */
let proxima = 47_600;
const porta = () => proxima++;

/** Um processo de mentira, com o mesmo contrato de `child_process`. */
function servidorFalso() {
  const child = new EventEmitter();
  child.kill = () => child.emit("exit", 0);
  return child;
}

const okImediato = async () => ({ ok: true, output: "" });
const falha = (saida) => async () => ({ ok: false, output: saida });

const supervisores = [];
function criar(opcoes) {
  const s = createApiSupervisor(opcoes);
  supervisores.push(s);
  return s;
}

afterEach(async () => {
  while (supervisores.length) await supervisores.pop().stop();
});

async function pedir(port) {
  const resposta = await fetch(`http://127.0.0.1:${port}/api/imports`);
  return { status: resposta.status, corpo: await resposta.json() };
}

describe("a porta da API nunca fica vazia", () => {
  it("migrations falhando deixam um explicador na porta, não o vazio", async () => {
    const port = porta();
    await criar({
      port,
      runMigrations: falha("could not connect to server: Connection refused"),
      runBuild: okImediato,
      spawnServer: servidorFalso,
    }).start();

    const { status, corpo } = await pedir(port);

    expect(status).toBe(503);
    expect(corpo.error).toMatch(/migrations/i);
    // A causa real precisa chegar junto: sem ela, a tela ganha uma frase
    // bonita e a pessoa continua sem saber o que aconteceu.
    expect(corpo.error).toMatch(/Connection refused/);
  });

  it("build falhando na primeira execução deixa um explicador, não o vazio", async () => {
    const port = porta();
    await criar({
      port,
      runMigrations: null,
      runBuild: falha("Cannot find module 'esbuild'"),
      spawnServer: servidorFalso,
    }).start();

    const { status, corpo } = await pedir(port);

    expect(status).toBe(503);
    expect(corpo.error).toMatch(/build/i);
    expect(corpo.error).toMatch(/esbuild/);
  });

  it("servidor que morre sozinho é substituído pelo explicador", async () => {
    const port = porta();
    let servidor;
    const supervisor = criar({
      port,
      runMigrations: null,
      runBuild: okImediato,
      spawnServer: () => (servidor = servidorFalso()),
    });
    await supervisor.start();
    expect(supervisor.state()).toBe("server");

    servidor.emit("exit", 1);
    await vi.waitFor(() => expect(supervisor.state()).toBe("explainer"));

    const { status, corpo } = await pedir(port);
    expect(status).toBe(503);
    expect(corpo.error).toMatch(/encerrou sozinho \(código 1\)/);
  });
});

describe("o que já funcionava continua funcionando", () => {
  it("no caminho feliz quem fica na porta é o servidor, não o explicador", async () => {
    const port = porta();
    let subidas = 0;
    const supervisor = criar({
      port,
      runMigrations: okImediato,
      runBuild: okImediato,
      spawnServer: () => {
        subidas += 1;
        return servidorFalso();
      },
    });
    await supervisor.start();

    expect(subidas).toBe(1);
    expect(supervisor.state()).toBe("server");
    // Nada escutando de nossa parte: a porta é do servidor de verdade, que
    // neste teste é de mentira e não escuta nada.
    await expect(pedir(port)).rejects.toThrow();
  });

  it("build quebrado depois de o servidor subir não derruba o que está de pé", async () => {
    const port = porta();
    let quebrar = false;
    const supervisor = criar({
      port,
      runMigrations: null,
      runBuild: async () =>
        quebrar
          ? { ok: false, output: "erro de sintaxe" }
          : { ok: true, output: "" },
      spawnServer: servidorFalso,
    });
    await supervisor.start();
    expect(supervisor.state()).toBe("server");

    quebrar = true;
    await supervisor.rebuild();

    expect(supervisor.state()).toBe("server");
  });
});

describe("tail", () => {
  it("guarda o fim da saída, que é onde o erro está", () => {
    expect(tail("linha 1\nlinha 2\nlinha 3", 2)).toBe("linha 2 · linha 3");
  });

  it("descarta linhas vazias e limita o tamanho", () => {
    expect(tail("a\n\n\nb")).toBe("a · b");
    expect(tail("x".repeat(900)).length).toBeLessThanOrEqual(501);
  });

  it("descarta stack e pontuação, que roubam o lugar da frase útil", () => {
    const saida = [
      "Error: connect ECONNREFUSED 127.0.0.1:1",
      "    at TCPConnectWrap.afterConnect (node:net:1637:16)",
      "  }",
      "}",
      "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL migrate",
    ].join("\n");

    expect(tail(saida)).toBe(
      "Error: connect ECONNREFUSED 127.0.0.1:1 · ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL migrate",
    );
  });
});
