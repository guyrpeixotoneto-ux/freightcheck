import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O freio da única rota que custa dinheiro por chamada.
 *
 * O que se prova aqui é o comportamento, e não a constante: que o volume tem
 * teto, que a largura tem teto, que o 429 diz quando soltar, que uma conta não
 * gasta a cota da outra, e — o caso que mais importa num freio — que ele
 * **solta**. Um limitador que conta a entrada e esquece a saída bloqueia o
 * produto no segundo dia sem ninguém entender por quê, e o teste que pega isso é
 * o da resposta que fecha.
 */

let servidor: Server;
let base: string;
let esquecer: () => void;

beforeAll(async () => {
  /*
    Os tetos vêm do ambiente e são lidos na importação do módulo: definir aqui,
    antes do `import`, é o que torna este teste independente dos números de
    produção. Dois e dois são o menor par que distingue as duas contagens.
  */
  process.env.ASSISTENTE_TETO_POR_JANELA = "3";
  process.env.ASSISTENTE_JANELA_MS = "60000";
  process.env.ASSISTENTE_SIMULTANEAS = "2";

  const { tetoDoAssistente, esquecerOsTetos } = await import("../teto-do-assistente");
  esquecer = esquecerOsTetos;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const quem = req.header("x-teste-como");
    if (quem) req.user = { id: quem, name: quem, email: quem, role: "OPERADOR" };
    next();
  });

  app.post("/assistant/ask", tetoDoAssistente, (req, res) => {
    /*
      Uma resposta que só termina quando o teste mandar — é como se mede o teto
      de simultâneas sem depender de relógio.
    */
    const segurar = req.header("x-segurar") === "1";
    if (!segurar) {
      res.json({ ok: true });
      return;
    }
    emVoo.push(() => res.json({ ok: true }));
  });

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
});

const emVoo: Array<() => void> = [];

afterEach(() => {
  for (const soltar of emVoo.splice(0)) soltar();
  esquecer();
});

const perguntar = (quem: string, segurar = false) =>
  fetch(`${base}/assistant/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-teste-como": quem,
      ...(segurar ? { "x-segurar": "1" } : {}),
    },
    body: JSON.stringify({ pergunta: "o que mudou?" }),
  });

describe("o volume tem teto, e o 429 diz quando solta", () => {
  it("até o teto passa; a seguinte é recusada", async () => {
    expect((await perguntar("ana")).status).toBe(200);
    expect((await perguntar("ana")).status).toBe(200);
    expect((await perguntar("ana")).status).toBe(200);

    const res = await perguntar("ana");
    expect(res.status).toBe(429);
    const corpo = (await res.json()) as { code: string; retryAfterSegundos: number };
    expect(corpo.code).toBe("ASSISTENTE_TETO");
    expect(corpo.retryAfterSegundos).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("uma conta não gasta a cota da outra", async () => {
    for (let i = 0; i < 3; i += 1) expect((await perguntar("ana")).status).toBe(200);
    expect((await perguntar("ana")).status).toBe(429);
    expect((await perguntar("bruno")).status).toBe(200);
  });
});

describe("a largura tem teto, e ele solta quando a resposta fecha", () => {
  it("duas em voo passam; a terceira é recusada com o outro código", async () => {
    const primeira = perguntar("ana", true);
    const segunda = perguntar("ana", true);
    await esperarEmVoo(2);

    const res = await perguntar("ana");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("ASSISTENTE_EM_VOO");

    for (const soltar of emVoo.splice(0)) soltar();
    expect((await primeira).status).toBe(200);
    expect((await segunda).status).toBe(200);
  });

  it("soltas as anteriores, a conta volta a perguntar", async () => {
    const presa = perguntar("ana", true);
    await esperarEmVoo(1);
    for (const soltar of emVoo.splice(0)) soltar();
    await presa;

    /*
      Duas ainda cabem na janela (o teto é três e uma já foi). O que se mede é
      que a vaga da simultânea voltou — se ela não voltasse, esta seria 429 com
      `ASSISTENTE_EM_VOO`, e não 200.
    */
    expect((await perguntar("ana")).status).toBe(200);
  });
});

describe("sem conta, não há o que limitar", () => {
  it("um pedido sem sessão atravessa — quem o recusa é o portão de sessão", async () => {
    const res = await fetch(`${base}/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});

/** Espera as respostas presas chegarem ao servidor, sem cravar um tempo. */
async function esperarEmVoo(quantas: number): Promise<void> {
  for (let i = 0; i < 200 && emVoo.length < quantas; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(emVoo.length).toBe(quantas);
}
