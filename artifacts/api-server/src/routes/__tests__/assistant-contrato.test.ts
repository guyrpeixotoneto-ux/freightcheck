/**
 * O contrato do Assistente sobre HTTP: **sempre JSON, inclusive quando falha.**
 *
 * A interface inteira foi escrita sobre essa promessa. `lib/transporte.ts`, do
 * lado do navegador, classifica corpo não-JSON como "não foi a nossa API que
 * respondeu — foi um proxy, um roteador, uma página de erro do ambiente", e
 * manda quem investiga procurar um processo derrubado. Quando o servidor
 * quebra a promessa, um defeito de código passa a se parecer com uma falha de
 * infraestrutura, e o tempo vai todo para o lugar errado.
 *
 * O servidor quebrava a promessa. Ela era cumprida rota a rota, num `try/catch`
 * por handler, e nada cobria o que passa por fora deles: caminho sem rota,
 * corpo malformado recusado antes de qualquer rota, exceção lançada fora do
 * `try`. Nos três o Express respondia `text/html` pelo `finalhandler`, cujo
 * `<pre>` num 500 diz exatamente `Internal Server Error`.
 *
 * Cada caso abaixo é uma dessas condições, exercitada **pelo app de verdade** —
 * `app.ts` inteiro, com o portão de sessão, o parser de corpo e os dois
 * handlers de contrato montados na ordem em que produção os monta. O primeiro
 * caso é a pergunta real, porque um contrato de erro que só valha no erro não
 * prova que o caminho feliz continua de pé.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `responder` é interceptado para que o erro possa ser **provocado**, e não
 * esperado.
 *
 * A implementação real continua sendo a de todos os casos felizes — o mock
 * delega a ela por padrão. O que o mock acrescenta é a capacidade de fazer a
 * orquestração falhar numa chamada específica, que é a única forma honesta de
 * provar o que a rota responde quando algo dentro dela quebra: sem isso, o
 * teste do erro dependeria de derrubar o banco no meio da suíte e torcer para
 * a falha cair onde se queria.
 */
const responderMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/assistant", async (original) => {
  const real = await original<typeof import("@workspace/assistant")>();
  return { ...real, responder: responderMock };
});

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;
let cookie: string;

interface Observado {
  status: number;
  tipo: string;
  texto: string;
  /** O corpo interpretado como JSON, ou `null` quando ele não é JSON. */
  json: Record<string, unknown> | null;
}

async function chamar(caminho: string, init: RequestInit = {}): Promise<Observado> {
  const res = await fetch(`${base}${caminho}`, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const texto = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    /* null é o sinal que estes testes medem */
  }
  return {
    status: res.status,
    tipo: res.headers.get("content-type") ?? "",
    texto,
    json,
  };
}

function perguntar(pergunta: string, accept: string): Promise<Observado> {
  return chamar("/api/assistant/ask", {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    body: JSON.stringify({ pergunta }),
  });
}

/** Os eventos de um corpo `text/event-stream`, na ordem em que chegaram. */
function eventos(texto: string): { nome: string; dados: Record<string, unknown> }[] {
  return texto
    .split("\n\n")
    .map((bloco) => ({
      nome: /^event: (.+)$/m.exec(bloco)?.[1],
      bruto: /^data: (.+)$/m.exec(bloco)?.[1],
    }))
    .filter((e): e is { nome: string; bruto: string } => Boolean(e.nome && e.bruto))
    .map((e) => ({ nome: e.nome, dados: JSON.parse(e.bruto) as Record<string, unknown> }));
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_assistant_contrato");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  /*
    A sessão é criada pelo mesmo caminho que o login usa — nada aqui é fixado
    por fora do portão, porque metade destes casos existe para provar que o
    portão continua respondendo em JSON.
  */
  const { createUser, startSession, SESSION_COOKIE } = await import("../../lib/session");
  const pessoa = await createUser(ctx.db, {
    name: "Contrato",
    email: "contrato@teste.local",
    password: "SenhaDeTeste#12345",
  });
  const { token } = await startSession(ctx.db, pessoa.id);
  cookie = `${SESSION_COOKIE}=${token}`;

  const real = await vi.importActual<typeof import("@workspace/assistant")>(
    "@workspace/assistant",
  );
  responderMock.mockImplementation(real.responder);

  const { default: app } = await import("../../app");
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 600_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

describe("uma pergunta de verdade ao Assistente", () => {
  it("responde JSON com a resposta, as fontes e a conversa criada", async () => {
    const r = await perguntar("o que vc já sabe?", "application/json");

    expect(r.status).toBe(200);
    expect(r.tipo).toContain("application/json");
    expect(r.json).not.toBeNull();
    expect(typeof r.json!.texto).toBe("string");
    expect((r.json!.texto as string).length).toBeGreaterThan(0);
    expect(Array.isArray(r.json!.fontes)).toBe(true);
    expect(typeof r.json!.conversationId).toBe("string");
    expect(typeof r.json!.messageId).toBe("string");
  });

  it("com `text/event-stream`, cada evento carrega JSON e o último é a resposta", async () => {
    const r = await perguntar("Como funciona o preço de combustível?", "text/event-stream");

    expect(r.status).toBe(200);
    expect(r.tipo).toContain("text/event-stream");

    // `eventos` faz `JSON.parse` em cada `data:`; um corpo fora do contrato
    // estoura aqui, que é o ponto.
    const lidos = eventos(r.texto);
    expect(lidos.length).toBeGreaterThan(0);
    expect(lidos.map((e) => e.nome)).toContain("etapa");

    const ultimo = lidos[lidos.length - 1]!;
    expect(ultimo.nome).toBe("resposta");
    expect(typeof ultimo.dados.texto).toBe("string");
    expect(typeof ultimo.dados.conversationId).toBe("string");
  });
});

describe("quando a orquestração falha, o que volta continua sendo JSON", () => {
  it("sem streaming: 500 em JSON, com código e requestId — nunca HTML", async () => {
    responderMock.mockRejectedValueOnce(new Error("o banco caiu no meio da consulta"));

    const r = await perguntar("Onde tivemos maior perda?", "application/json");

    expect(r.status).toBe(500);
    expect(r.tipo).toContain("application/json");
    expect(r.tipo).not.toContain("text/html");
    expect(r.json).not.toBeNull();
    expect(r.json!.code).toBe("ASSISTENTE_FALHOU");
    expect(r.json!.requestId).toBeDefined();
    // A frase que o `finalhandler` do Express produziria no lugar disto.
    expect(r.texto).not.toContain("<!DOCTYPE html>");
    expect(r.texto).not.toContain("Internal Server Error");
  });

  it("com streaming: o erro vira o último evento, e o `data:` é JSON", async () => {
    responderMock.mockRejectedValueOnce(new Error("o banco caiu no meio da consulta"));

    const r = await perguntar("Onde tivemos maior perda?", "text/event-stream");

    /*
      O `200` aqui não é um acerto do teste: no stream o cabeçalho sai antes de
      a orquestração começar, e a partir daí não existe status para trocar. É
      por isso que um `500` observado no navegador **nesta** chamada prova que a
      requisição não chegou à rota — a rota, quando alcançada, não tem como
      produzir um.
    */
    expect(r.status).toBe(200);
    const lidos = eventos(r.texto);
    const ultimo = lidos[lidos.length - 1]!;
    expect(ultimo.nome).toBe("erro");
    expect(ultimo.dados.code).toBe("ASSISTENTE_FALHOU");
    expect(ultimo.dados.requestId).toBeDefined();
  });
});

describe("o contrato vale para o que passa por fora das rotas", () => {
  it("caminho sem rota responde 404 em JSON, não a página de erro do Express", async () => {
    const r = await chamar("/api/assistant/nao-existe", { method: "POST" });

    expect(r.status).toBe(404);
    expect(r.tipo).toContain("application/json");
    expect(r.json).not.toBeNull();
    expect(r.json!.code).toBe("ROTA_DESCONHECIDA");
    expect(r.texto).not.toContain("<!DOCTYPE html>");
  });

  it("corpo JSON malformado responde 400 em JSON — o parser recusa antes da rota", async () => {
    const r = await chamar("/api/assistant/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"pergunta": ',
    });

    expect(r.status).toBe(400);
    expect(r.tipo).toContain("application/json");
    expect(r.json).not.toBeNull();
    // Recusa do pedido, não falha do servidor: os dois códigos mandam fazer
    // coisas opostas, e a tela precisa poder distingui-los.
    expect(r.json!.code).toBe("PEDIDO_INVALIDO");
    expect(r.json!.requestId).toBeDefined();
    expect(r.texto).not.toContain("<!DOCTYPE html>");
  });

  it("pergunta vazia e pergunta longa demais recusam em JSON, com a frase de quem lê", async () => {
    const vazia = await perguntar("   ", "application/json");
    expect(vazia.status).toBe(400);
    expect(vazia.json?.error).toMatch(/escreva a pergunta/i);

    const longa = await perguntar("a".repeat(1001), "application/json");
    expect(longa.status).toBe(413);
    expect(longa.json?.error).toMatch(/1000 caracteres/);
  });

  it("sem sessão, o portão recusa em JSON — inclusive na rota de perguntar", async () => {
    const guardado = cookie;
    cookie = "";
    try {
      const r = await perguntar("o que vc já sabe?", "text/event-stream");
      expect(r.status).toBe(401);
      expect(r.tipo).toContain("application/json");
      expect(r.json!.code).toBe("UNAUTHENTICATED");
      expect(r.texto).not.toContain("<!DOCTYPE html>");
    } finally {
      cookie = guardado;
    }
  });
});
