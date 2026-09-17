import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * ARQUIVAR UMA CONTA, pelo fio — o que a lixeira faz em quem já não tem acesso.
 *
 * A tela de Usuários mostra tudo o que já existiu, e desativar resolve o acesso
 * sem resolver a lista: os desligados continuam ali, no grupo do cargo que já
 * não é de ninguém. Arquivar é a decisão sobre a lista, e este teste guarda as
 * três propriedades que a tornam segura de oferecer:
 *
 * 1. **Nunca esconde quem entra.** Arquivar uma conta ativa é 409 — uma conta
 *    fora da lista e dentro do produto é exatamente o que uma tela de acesso
 *    não pode permitir.
 * 2. **Não mexe em acesso.** Arquivar não desativa, e desarquivar não reativa.
 * 3. **Reativar desarquiva junto.** Voltar a entrar e continuar escondido
 *    seriam as duas metades da mesma contradição.
 *
 * E, como toda mutação de conta, ela passa pelo portão de papel antes de tocar
 * o banco.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

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

/** O que o banco guarda sobre o arquivamento e o acesso daquela conta. */
async function estado(id: string): Promise<{
  disabledAt: Date | null;
  archivedAt: Date | null;
  archivedBy: string | null;
}> {
  const { rows } = await ctx.pool.query<{
    disabled_at: Date | null;
    archived_at: Date | null;
    archived_by: string | null;
  }>(
    `SELECT "disabled_at", "archived_at", "archived_by"
       FROM "app_user" WHERE "id" = $1`,
    [id],
  );
  return {
    disabledAt: rows[0].disabled_at,
    archivedAt: rows[0].archived_at,
    archivedBy: rows[0].archived_by,
  };
}

let chefe: SessionUser;
let saiu: SessionUser;

beforeAll(async () => {
  ctx = await createTestDatabase("arquivar_conta_http");
  process.env.DATABASE_URL = ctx.url;

  chefe = await criarConta("chefe@x.com", "ADMIN");
  await criarConta("op@x.com", "OPERADOR");
  /* Um segundo administrador para que desativar o primeiro alvo não esbarre na
     guarda do último admin ativo, que é outro assunto e tem teste próprio. */
  await criarConta("outro-chefe@x.com", "ADMIN");
  saiu = await criarConta("saiu@x.com", "OPERADOR");

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

const chamar = (id: string, acao: string, quem = "chefe@x.com") =>
  fetch(`${base}/users/${id}/${acao}`, { method: "POST", headers: como(quem) });

describe("arquivar é do administrador, e só dele", () => {
  it("operador leva 403, com a frase que diz a quem pedir", async () => {
    const res = await chamar(saiu.id, "arquivar", "op@x.com");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/administradores/i);
    expect((await estado(saiu.id)).archivedAt).toBeNull();
  });

  it("desarquivar também", async () => {
    expect((await chamar(saiu.id, "desarquivar", "op@x.com")).status).toBe(403);
  });

  it("conta que não existe é 404, e id torto é 400", async () => {
    expect(
      (await chamar("00000000-0000-0000-0000-000000000000", "arquivar")).status,
    ).toBe(404);
    expect((await chamar("nao-e-uuid", "arquivar")).status).toBe(400);
  });
});

describe("nunca se esconde uma conta que ainda entra", () => {
  it("arquivar uma conta ativa é 409, e manda desativar primeiro", async () => {
    const res = await chamar(saiu.id, "arquivar");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/desative o acesso/i);
    expect((await estado(saiu.id)).archivedAt).toBeNull();
  });

  it("a própria conta não se arquiva — está em uso agora", async () => {
    await chamar(chefe.id, "disable");
    const res = await chamar(chefe.id, "arquivar");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/própria conta/i);
  });
});

describe("arquivar, desarquivar e reativar", () => {
  it("depois de desativada, arquivar tira da lista sem tocar no acesso", async () => {
    expect((await chamar(saiu.id, "disable")).status).toBe(200);
    const antes = await estado(saiu.id);
    expect(antes.disabledAt).not.toBeNull();

    const res = await chamar(saiu.id, "arquivar");
    expect(res.status).toBe(200);

    const depois = await estado(saiu.id);
    expect(depois.archivedAt).not.toBeNull();
    expect(depois.archivedBy).toBe("chefe@x.com");
    /* Arquivar não desativa nem reativa: o acesso é o mesmo de antes. */
    expect(depois.disabledAt?.toISOString()).toBe(antes.disabledAt?.toISOString());
  });

  it("a lista devolvida já traz a conta arquivada, com autor e data", async () => {
    const res = await fetch(`${base}/users`, { headers: como("chefe@x.com") });
    const lista = (await res.json()) as {
      id: string;
      archivedAt: string | null;
      archivedBy: string | null;
    }[];
    const linha = lista.find((u) => u.id === saiu.id);
    expect(linha?.archivedAt).toEqual(expect.any(String));
    expect(linha?.archivedBy).toBe("chefe@x.com");
  });

  it("desarquivar devolve à lista e deixa o acesso como estava — desativado", async () => {
    const res = await chamar(saiu.id, "desarquivar");
    expect(res.status).toBe(200);

    const depois = await estado(saiu.id);
    expect(depois.archivedAt).toBeNull();
    expect(depois.archivedBy).toBeNull();
    expect(depois.disabledAt).not.toBeNull();
  });

  it("reativar o acesso desarquiva junto — entrar e ficar escondido não convivem", async () => {
    await chamar(saiu.id, "arquivar");
    expect((await estado(saiu.id)).archivedAt).not.toBeNull();

    expect((await chamar(saiu.id, "enable")).status).toBe(200);

    const depois = await estado(saiu.id);
    expect(depois.disabledAt).toBeNull();
    expect(depois.archivedAt).toBeNull();
    expect(depois.archivedBy).toBeNull();
  });
});
