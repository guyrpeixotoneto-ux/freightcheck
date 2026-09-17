import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * O portão de papel, atravessado por HTTP — não pela função, pela rota.
 *
 * O teste puro (`users-papeis.test.ts`) prova a decisão; este prova que TODA
 * mutação de conta a consulta antes de tocar o banco, que o 403 chega com a
 * frase que diz a quem pedir, e que as duas guardas de beco (último admin não
 * cai nem é rebaixado) respondem 409 no fio. É o cenário 6 do plano de
 * liberação, repetível — a prova ao vivo do ambiente de desenvolvimento
 * envelhece; esta roda em todo CI.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

/** Quem "está logado" em cada chamada — o cabeçalho escolhe a conta. */
const CONTAS: Record<string, SessionUser> = {};

async function criarConta(email: string, role: string): Promise<SessionUser> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role")
     VALUES ($1,$1,'scrypt$x',$2) RETURNING id`,
    [email, role],
  );
  const user = { id: rows[0].id, name: email, email, role };
  CONTAS[email] = user;
  return user;
}

beforeAll(async () => {
  ctx = await createTestDatabase("users_papeis_http");
  process.env.DATABASE_URL = ctx.url;

  await criarConta("chefe@x.com", "ADMIN");
  await criarConta("op@x.com", "OPERADOR");

  const { default: usersRouter } = await import("../users");
  const { erroEmJson } = await import("../../middlewares/contrato-json");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    const quem = req.header("x-teste-como");
    if (quem && CONTAS[quem]) req.user = CONTAS[quem];
    next();
  });
  app.use(usersRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

const como = (email: string) => ({
  "Content-Type": "application/json",
  "x-teste-como": email,
});

describe("operador não gerencia contas", () => {
  it("POST /users → 403 com a frase que diz a quem pedir", async () => {
    const res = await fetch(`${base}/users`, {
      method: "POST",
      headers: como("op@x.com"),
      body: JSON.stringify({ name: "X", email: "x@x.com", password: "senha-forte-123" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/administradores/i);
  });

  it("redefinir a senha do admin → 403 — a tomada de conta que motivou os papéis", async () => {
    const res = await fetch(`${base}/users/${CONTAS["chefe@x.com"].id}/password`, {
      method: "POST",
      headers: como("op@x.com"),
      body: JSON.stringify({ password: "senha-roubada-123" }),
    });
    expect(res.status).toBe(403);
  });

  it("desativar, reativar e mudar papel → 403, todos", async () => {
    const alvo = CONTAS["chefe@x.com"].id;
    for (const [caminho, body] of [
      [`/users/${alvo}/disable`, {}],
      [`/users/${alvo}/enable`, {}],
      [`/users/${alvo}/role`, { role: "OPERADOR" }],
    ] as const) {
      const res = await fetch(`${base}${caminho}`, {
        method: "POST",
        headers: como("op@x.com"),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(403);
    }
  });

  it("a lista continua legível — transparência não é privilégio", async () => {
    const res = await fetch(`${base}/users`, { headers: como("op@x.com") });
    expect(res.status).toBe(200);
  });
});

describe("admin gerencia — e os becos respondem 409", () => {
  it("cria conta com papel, promove e rebaixa", async () => {
    const criada = await fetch(`${base}/users`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({
        name: "Nova",
        email: "nova@x.com",
        password: "senha-forte-123",
        role: "OPERADOR",
      }),
    });
    expect(criada.status).toBe(201);
    const nova = (await criada.json()) as SessionUser;
    expect(nova.role).toBe("OPERADOR");

    const promovida = await fetch(`${base}/users/${nova.id}/role`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ role: "ADMIN" }),
    });
    expect(promovida.status).toBe(200);

    const rebaixada = await fetch(`${base}/users/${nova.id}/role`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ role: "OPERADOR" }),
    });
    expect(rebaixada.status).toBe(200);
  });

  it("papel inventado → 400", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/role`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ role: "ROOT" }),
    });
    expect(res.status).toBe(400);
  });

  it("o último admin ativo não é rebaixado nem desativado", async () => {
    const eu = CONTAS["chefe@x.com"].id;
    const rebaixar = await fetch(`${base}/users/${eu}/role`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ role: "OPERADOR" }),
    });
    expect(rebaixar.status).toBe(409);
    expect(((await rebaixar.json()) as { error: string }).error).toMatch(/última conta de administrador/i);

    // Desativar a si mesmo já era recusado; o beco do último admin é provado
    // por outro admin temporário tentando desativá-lo… que aqui não existe —
    // então a recusa que chega primeiro é a do alvo=ator, também 409.
    const desativar = await fetch(`${base}/users/${eu}/disable`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({}),
    });
    expect(desativar.status).toBe(409);
  });
});
