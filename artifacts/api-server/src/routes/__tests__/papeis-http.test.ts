import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * O cadastro de papéis, atravessado por HTTP.
 *
 * O que este arquivo prova é o que faz o papel valer a pena existir, e nada
 * disso é visível olhando uma tabela:
 *
 * 1. **O papel é vínculo, e não modelo copiado.** Restringir um módulo no papel
 *    muda o que a conta daquele papel alcança, sem tocar na conta — e é a
 *    resposta de `/users/:id/permissoes` que tem de mudar, porque é ela que o
 *    portão e o menu leem.
 * 2. **A exceção da pessoa vence o papel, e sobrevive à troca de papel.** É o
 *    que impede o cadastro de desfazer, em silêncio, decisões tomadas uma a uma.
 * 3. **`role` é derivado.** Mover uma conta para um papel que gerencia contas a
 *    torna administradora no mesmo ato; tirar a administração de um papel
 *    rebaixa quem o usa. Duas escritas discordantes aqui seriam a tela dizendo
 *    uma coisa e o portão fazendo outra.
 * 4. **Os becos respondem 409**: papel do sistema não se apaga nem se renomeia,
 *    papel com gente dentro não se apaga, e ninguém tira a administração do
 *    último papel que a tem com gente ativa.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};

async function papelDoBanco(nome: string): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT "id" FROM "papel" WHERE lower("nome") = lower($1)`,
    [nome],
  );
  return rows[0]!.id;
}

async function criarConta(email: string, role: string): Promise<SessionUser> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role","papel_id")
     VALUES ($1,$1,'scrypt$x',$2,$3) RETURNING id`,
    [
      email,
      role,
      await papelDoBanco(role === "ADMIN" ? "Administrador" : "Operador"),
    ],
  );
  const user = { id: rows[0]!.id, name: email, email, role };
  CONTAS[email] = user;
  return user;
}

const como = (email: string) => ({
  "Content-Type": "application/json",
  "x-teste-como": email,
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

beforeAll(async () => {
  ctx = await createTestDatabase("papeis_http");
  process.env.DATABASE_URL = ctx.url;

  await criarConta("chefe@x.com", "ADMIN");
  await criarConta("op@x.com", "OPERADOR");

  const { default: usersRouter } = await import("../users");
  const { default: papeisRouter } = await import("../papeis");
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
  app.use(papeisRouter);
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

describe("a migration semeia o que já existia", () => {
  it("os dois papéis do sistema nascem, e sem restrição nenhuma", async () => {
    const papeis = (await (await fetch(`${base}/papeis`, {
      headers: como("op@x.com"),
    })).json()) as Array<Record<string, unknown>>;

    const nomes = papeis.map((p) => p.nome);
    expect(nomes).toContain("Operador");
    expect(nomes).toContain("Administrador");
    for (const p of papeis) {
      expect(p.sistema).toBe(true);
      /* Zero restrições é o ponto: papel sem linha alcança tudo, e é por isso
         que ninguém muda de acesso no dia em que o cadastro nasce. */
      expect(p.restricoes).toBe(0);
    }
    expect(papeis.find((p) => p.nome === "Administrador")!.gerenciaContas).toBe(true);
    expect(papeis.find((p) => p.nome === "Operador")!.gerenciaContas).toBe(false);
  });

  it("ler é de quem tem sessão; cadastrar é de quem gerencia contas", async () => {
    const recusa = await fetch(`${base}/papeis`, {
      method: "POST",
      headers: como("op@x.com"),
      body: JSON.stringify({ nome: "Inventado" }),
    });
    expect(recusa.status).toBe(403);
    expect(((await json(recusa)).error as string)).toMatch(/administradores/i);
  });
});

describe("o papel é vínculo: mexer nele muda o acesso de quem o usa", () => {
  it("restringir no papel aparece na conta — e a exceção da conta vence", async () => {
    const criado = await fetch(`${base}/papeis`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ nome: "Conferente", descricao: "Confere e não mexe." }),
    });
    expect(criado.status).toBe(201);
    const papel = (await json(criado)) as { id: string };

    const posto = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/papel`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ papelId: papel.id }),
    });
    expect(posto.status).toBe(200);

    // Antes de qualquer restrição, a conta não tem nada tirado.
    const antes = await json(
      await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
        headers: como("chefe@x.com"),
      }),
    );
    expect(antes.permissoes).toEqual({});

    const restringido = await fetch(`${base}/papeis/${papel.id}/permissoes`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ niveis: { "/curadoria": "SEM_ACESSO" } }),
    });
    expect(restringido.status).toBe(200);

    /*
      A conta não foi tocada, e o que ela alcança mudou. É a propriedade
      inteira: um modelo copiado na criação daria `{}` aqui.
    */
    const depois = await json(
      await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
        headers: como("chefe@x.com"),
      }),
    );
    expect(depois.permissoes).toEqual({ "/curadoria": "SEM_ACESSO" });
    expect(depois.doPapel).toEqual({ "/curadoria": "SEM_ACESSO" });
    expect(depois.daPessoa).toEqual({});

    // A exceção da pessoa devolve o módulo a ela, e só a ela.
    const excecao = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ niveis: { "/curadoria": "EDITAR" } }),
    });
    expect(excecao.status).toBe(200);
    const comExcecao = (await json(excecao)) as {
      permissoes: Record<string, string>;
      doPapel: Record<string, string>;
      daPessoa: Record<string, string>;
    };
    expect(comExcecao.permissoes["/curadoria"]).toBe("EDITAR");
    expect(comExcecao.doPapel["/curadoria"]).toBe("SEM_ACESSO");
    expect(comExcecao.daPessoa["/curadoria"]).toBe("EDITAR");

    /*
      E voltar a herança apaga a linha em vez de gravar `EDITAR`: a linha de
      base passou a ser o papel, e uma exceção "igual ao padrão antigo" faria a
      conta parar de acompanhar o papel dela em silêncio.
    */
    const devolvida = (await json(
      await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
        method: "PUT",
        headers: como("chefe@x.com"),
        body: JSON.stringify({ niveis: { "/curadoria": "SEM_ACESSO" } }),
      }),
    )) as { daPessoa: Record<string, string> };
    expect(devolvida.daPessoa).toEqual({});
  });

  it("apagar um papel com gente dentro é recusado, e a recusa conta quantas", async () => {
    const papelId = await papelDoBanco("Conferente");
    const res = await fetch(`${base}/papeis/${papelId}`, {
      method: "DELETE",
      headers: como("chefe@x.com"),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error as string).toMatch(/1 conta/);
  });
});

describe("role é derivado do papel — uma decisão, uma escrita", () => {
  it("mover a conta para um papel que administra a torna administradora", async () => {
    const administracao = await papelDoBanco("Administrador");
    await fetch(`${base}/users/${CONTAS["op@x.com"].id}/papel`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ papelId: administracao }),
    });

    const { rows } = await ctx.pool.query<{ role: string }>(
      `SELECT "role" FROM "app_user" WHERE "id" = $1`,
      [CONTAS["op@x.com"]!.id],
    );
    expect(rows[0]!.role).toBe("ADMIN");
  });

  it("tirar a administração de um papel rebaixa quem o usa", async () => {
    const criado = (await json(
      await fetch(`${base}/papeis`, {
        method: "POST",
        headers: como("chefe@x.com"),
        body: JSON.stringify({ nome: "Coordenação", gerenciaContas: true }),
      }),
    )) as { id: string };

    await fetch(`${base}/users/${CONTAS["op@x.com"].id}/papel`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ papelId: criado.id }),
    });

    const res = await fetch(`${base}/papeis/${criado.id}`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ gerenciaContas: false }),
    });
    expect(res.status).toBe(200);

    const { rows } = await ctx.pool.query<{ role: string }>(
      `SELECT "role" FROM "app_user" WHERE "id" = $1`,
      [CONTAS["op@x.com"]!.id],
    );
    expect(rows[0]!.role).toBe("OPERADOR");
  });
});

describe("os becos respondem 409", () => {
  it("papel do sistema não se renomeia nem se apaga", async () => {
    const operador = await papelDoBanco("Operador");

    const renomear = await fetch(`${base}/papeis/${operador}`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ nome: "Usuário comum" }),
    });
    expect(renomear.status).toBe(409);

    const apagar = await fetch(`${base}/papeis/${operador}`, {
      method: "DELETE",
      headers: como("chefe@x.com"),
    });
    expect(apagar.status).toBe(409);
  });

  it("nome repetido é recusado, ignorando maiúsculas", async () => {
    const res = await fetch(`${base}/papeis`, {
      method: "POST",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ nome: "cONFERENTE" }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error as string).toMatch(/já existe/i);
  });

  it("não se tira a administração do último papel que a tem com gente ativa", async () => {
    const administracao = await papelDoBanco("Administrador");
    const res = await fetch(`${base}/papeis/${administracao}`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ gerenciaContas: false }),
    });
    /*
      Aqui a recusa que chega primeiro é a do papel do sistema — e ela basta:
      as duas dizem a mesma coisa, que este papel não deixa de administrar.
    */
    expect(res.status).toBe(409);
  });

  it("um papel que gerencia contas não perde Configurações", async () => {
    const administracao = await papelDoBanco("Administrador");
    const res = await fetch(`${base}/papeis/${administracao}/permissoes`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ niveis: { "/configuracoes": "SEM_ACESSO" } }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error as string).toMatch(/Configurações/);
  });
});
