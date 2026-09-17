import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * "Visualizar como", atravessado por HTTP — do login ao retorno ao próprio
 * perfil.
 *
 * O teste sobe o mesmo empilhamento do servidor (sessão → portão da
 * visualização → rotas) porque as três coisas que importam aqui só existem
 * juntas: a sessão continua sendo a de quem clicou, a tela passa a ser a da
 * conta visualizada, e **nada** pode ser escrito enquanto isso durar. Provar
 * uma delas isolada não prova nenhuma.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let cookie = "";

let chefe: SessionUser;
let operador: SessionUser;
let afastado: SessionUser;

const SENHA_DO_CHEFE = "senha-do-chefe";
const SENHA_DO_OPERADOR = "senha-do-operador";

/** Uma chamada com o cookie da sessão, guardando o que o servidor devolver. */
async function chamar(
  caminho: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; corpo: any }> {
  const resposta = await fetch(`${base}${caminho}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const enviado = resposta.headers.get("set-cookie");
  if (enviado) cookie = enviado.split(";")[0]!;
  return { status: resposta.status, corpo: await resposta.json() };
}

const entrar = (email: string, password: string) =>
  chamar("/auth/login", { method: "POST", body: { email, password } });

beforeAll(async () => {
  ctx = await createTestDatabase("visualizar_como");
  process.env.DATABASE_URL = ctx.url;

  const { db } = await import("@workspace/db");
  const { createUser, setUserDisabled } = await import("../../lib/session");

  chefe = await createUser(db, {
    name: "Guy",
    email: "chefe@x.com",
    password: SENHA_DO_CHEFE,
    role: "ADMIN",
  });
  operador = await createUser(db, {
    name: "Bruno Henrique",
    email: "bruno@x.com",
    password: SENHA_DO_OPERADOR,
    role: "OPERADOR",
  });
  afastado = await createUser(db, {
    name: "Quem saiu",
    email: "saiu@x.com",
    password: "senha-de-quem-saiu",
    role: "OPERADOR",
  });
  await setUserDisabled(db, afastado.id, true, chefe.email);

  const { default: authRouter } = await import("../auth");
  const { default: usersRouter } = await import("../users");
  const { requireSession } = await import("../../middlewares/require-session");
  const { visualizacaoSomenteLeitura } = await import(
    "../../middlewares/visualizacao-como"
  );
  const { erroEmJson } = await import("../../middlewares/contrato-json");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(requireSession);
  app.use(visualizacaoSomenteLeitura);
  app.use(authRouter);
  app.use(usersRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

describe("o administrador visualizando como outra conta", () => {
  it("entra, visualiza, não escreve e volta", async () => {
    expect((await entrar(chefe.email, SENHA_DO_CHEFE)).status).toBe(200);

    const antes = await chamar("/auth/session");
    expect(antes.corpo.user.email).toBe(chefe.email);
    expect(antes.corpo.visualizacao).toBeNull();

    const olhar = await chamar("/auth/visualizar-como", {
      method: "POST",
      body: { userId: operador.id },
    });
    expect(olhar.status).toBe(200);
    /*
      A conta da sessão passa a ser a visualizada — é ela que o menu e as telas
      seguem, porque ver o produto pelos olhos de alguém é o que se pediu. E o
      dono continua dito, porque a faixa do topo o escreve.
    */
    expect(olhar.corpo.user.email).toBe(operador.email);
    expect(olhar.corpo.visualizacao.por.email).toBe(chefe.email);
    expect(olhar.corpo.visualizacao.alvo.email).toBe(operador.email);

    // E a próxima requisição enxerga o mesmo — o estado está na sessão, no
    // servidor, e não numa resposta que a tela guardou.
    const durante = await chamar("/auth/session");
    expect(durante.corpo.user.email).toBe(operador.email);
    expect(durante.corpo.visualizacao.por.email).toBe(chefe.email);

    /*
      A escrita recusada é a razão de tudo isto existir com esta forma: criar
      uma conta aqui gravaria `created_by` com o e-mail de quem não clicou.
    */
    const escrita = await chamar("/users", {
      method: "POST",
      body: {
        name: "Ninguém",
        email: "ninguem@x.com",
        password: "senha-de-ninguem",
      },
    });
    expect(escrita.status).toBe(403);
    expect(escrita.corpo.code).toBe("VISUALIZANDO_COMO");

    const voltou = await chamar("/auth/visualizar-como/parar", { method: "POST" });
    expect(voltou.status).toBe(200);
    expect(voltou.corpo.user.email).toBe(chefe.email);
    expect(voltou.corpo.visualizacao).toBeNull();

    // De volta ao próprio perfil, a mesma sessão escreve outra vez.
    const depois = await chamar("/auth/session");
    expect(depois.corpo.user.email).toBe(chefe.email);
    expect(depois.corpo.visualizacao).toBeNull();
  }, 120_000);

  it("recusa a própria conta e a conta desativada", async () => {
    expect((await entrar(chefe.email, SENHA_DO_CHEFE)).status).toBe(200);

    const eu = await chamar("/auth/visualizar-como", {
      method: "POST",
      body: { userId: chefe.id },
    });
    expect(eu.status).toBe(409);

    const morta = await chamar("/auth/visualizar-como", {
      method: "POST",
      body: { userId: afastado.id },
    });
    expect(morta.status).toBe(409);
    expect(String(morta.corpo.error)).toContain("desativada");

    const torto = await chamar("/auth/visualizar-como", {
      method: "POST",
      body: { userId: "não é um uuid" },
    });
    expect(torto.status).toBe(400);
  }, 120_000);

  it("o operador não visualiza ninguém", async () => {
    expect((await entrar(operador.email, SENHA_DO_OPERADOR)).status).toBe(200);

    const tentou = await chamar("/auth/visualizar-como", {
      method: "POST",
      body: { userId: chefe.id },
    });
    expect(tentou.status).toBe(403);

    // E parar sem estar visualizando não quebra: é desfazer o que não há.
    const parou = await chamar("/auth/visualizar-como/parar", { method: "POST" });
    expect(parou.status).toBe(200);
    expect(parou.corpo.user.email).toBe(operador.email);
  }, 120_000);
});
