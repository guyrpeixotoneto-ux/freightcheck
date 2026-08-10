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
        // Porta 1 não aceita conexão: as migrations falham em segundos, que é
        // a falha que antes derrubava o processo inteiro em silêncio.
        DATABASE_URL: "postgres://ninguem@127.0.0.1:1/inexistente?sslmode=disable",
      },
    });

    const resposta = await esperarResposta(port, 90_000);

    expect(resposta.status).toBe(503);
    const corpo = await resposta.json();
    expect(corpo.error).toMatch(/migrations/i);
  }, 120_000);
});
