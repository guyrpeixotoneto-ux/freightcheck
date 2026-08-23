/**
 * O cenário exato que foi observado no Replit, reproduzido pelo comando real.
 *
 * O `doctor`, rodado no workspace, disse: interface viva na 25609, roteamento
 * de `/api` apontando para a 8080, **e ninguém na 8080**. É esse estado que
 * este teste torna impossível — não pela lógica interna do supervisor, que os
 * testes ao lado já cobrem, mas subindo `node scripts/dev.mjs api` de verdade,
 * com um `DATABASE_URL` que não responde, e exigindo que a porta tenha alguém
 * dizendo por quê.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let processo = null;

afterEach(() => {
  processo?.kill("SIGKILL");
  processo = null;
});

/** Espera a porta responder, seja lá com o que for. */
async function esperarResposta(port, timeoutMs) {
  const limite = Date.now() + timeoutMs;
  let ultimoErro;
  while (Date.now() < limite) {
    try {
      return await fetch(`http://127.0.0.1:${port}/api/imports`);
    } catch (err) {
      ultimoErro = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `nada respondeu na porta ${port} em ${timeoutMs}ms — este é exatamente o ` +
      `estado que produz 502 sem corpo (último erro: ${ultimoErro?.message})`,
  );
}

describe("node scripts/dev.mjs api", () => {
  it("com um banco inalcançável, deixa a porta ocupada e explicada", async () => {
    const port = 47_811;
    processo = spawn("node", ["scripts/dev.mjs", "api"], {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        API_PORT: String(port),
        PORT: "",
        // Porta 1 não aceita conexão.
        DATABASE_URL:
          "postgres://ninguem@127.0.0.1:1/inexistente?sslmode=disable",
      },
    });

    /*
      A invariante é esta, e é a única que importa aqui: **alguém responde**.
      O estado que este teste torna impossível é a porta vazia, que vira 502 sem
      corpo e manda quem depura procurar o defeito na tela errada.

      O *status* mudou, e mudou de propósito. Enquanto `dev.mjs` aplicava as
      migrations na partida, um banco inalcançável derrubava esse passo e quem
      ficava na porta era o explicador, com 503. Migrar Development deixou de ser
      efeito colateral de subir o servidor — a ordem correta é Production
      primeiro, e um `Run` que migrasse sozinho fabricaria justamente o diff que
      trava o Publishing (ver `sem-auto-migracao.test.mjs`). Sem esse passo, o
      servidor sobe, e o diagnóstico do banco mora em `/api/readyz` — que
      responde 503 com ele no corpo, enquanto o `/api/healthz` responde 200
      porque é liveness e não fala do banco.
    */
    const resposta = await esperarResposta(port, 90_000);
    expect(resposta.status).toBeGreaterThanOrEqual(200);

    /* Liveness: de pé, com o banco fora. É o que o startup probe consulta. */
    const vivo = await fetch(`http://127.0.0.1:${port}/api/healthz`);
    expect(vivo.status).toBe(200);
    expect((await vivo.json()).status).toBe("ok");

    /* Readiness: não está pronto, e diz por quê. */
    const pronto = await fetch(`http://127.0.0.1:${port}/api/readyz`);
    expect(pronto.status).toBe(503);
    const corpo = await pronto.json();
    expect(corpo.ready).toBe(false);
    expect(corpo.database.configured).toBe(true);
    expect(corpo.database.reachable).toBe(false);
    expect(corpo.database.detail).toMatch(/banco/i);
  }, 120_000);
});
