import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { reconvergirSeCabivel } from "@workspace/db/reconvergencia";
import { protegerDecisaoDaCasa } from "@workspace/db/decisao-da-casa";
import type { SessionUser } from "../../lib/session";

/**
 * O desligamento fica desligado — através do HTTP, e através do deploy.
 *
 * O outro arquivo de rota prova o **sentido** da camada: desligar vence papel e
 * exceção, `/configuracoes` não se desliga, ligar de volta devolve o que havia.
 * Este prova a **permanência**, que é o que faltava e é o que o produto errava:
 * a decisão atravessa uma releitura, uma conta diferente, uma escrita sobre
 * outra chave e — a que importa — o DDL destrutivo que o Provision do
 * Publishing executa quando Development está atrás de Production.
 *
 * A cadeia daquele incidente está medida no grão do banco em
 * `lib/db/src/__tests__/decisao-da-casa.test.ts`. Aqui ela é medida por onde a
 * pessoa a vê: a mesma resposta de `GET /modulos-universais` que desenha a tela.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};

const como = (email: string) => ({
  "x-teste-como": email,
  "Content-Type": "application/json",
});

beforeAll(async () => {
  ctx = await createTestDatabase("modulos_universais_persistencia");
  process.env["DATABASE_URL"] = ctx.url;

  for (const [email, role] of [
    ["chefe@x.com", "ADMIN"],
    ["outra-chefe@x.com", "ADMIN"],
    ["op@x.com", "OPERADOR"],
  ] as const) {
    const { rows } = await ctx.pool.query<{ id: string }>(
      `INSERT INTO "app_user" ("name","email","password_hash","role")
       VALUES ($1,$1,'scrypt$x',$2) RETURNING id`,
      [email, role],
    );
    CONTAS[email] = { id: rows[0]!.id, name: email, email, role };
  }

  const { default: modulosRouter } = await import("../modulos-universais");

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
  app.use(modulosRouter);

  servidor = app.listen(0);
  const endereco = servidor.address();
  base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
}, 120_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

interface Resposta {
  desligadas: Array<{
    chave: string;
    desligadoPor: string;
    motivo: string | null;
  }>;
  protegidas: string[];
  historico: Array<{ chave: string; ligado: boolean }>;
}

async function ler(quem = "chefe@x.com"): Promise<Resposta> {
  const res = await fetch(`${base}/modulos-universais`, {
    headers: como(quem),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Resposta;
}

async function definir(
  chaves: Record<string, boolean>,
  quem = "chefe@x.com",
  motivo?: string,
): Promise<Response> {
  return fetch(`${base}/modulos-universais`, {
    method: "PUT",
    headers: como(quem),
    body: JSON.stringify({ chaves, motivo }),
  });
}

const chavesDesligadas = (r: Resposta): string[] =>
  r.desligadas.map((d) => d.chave).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe("o desligamento fica desligado", () => {
  it("desligar, reler pela API, e continuar desligado", async () => {
    expect(
      (await definir({ "/qlp": false }, "chefe@x.com", "não usamos QLP"))
        .status,
    ).toBe(200);

    expect(chavesDesligadas(await ler())).toEqual(["/qlp"]);
  });

  it("a releitura é a mesma para outra conta do mesmo escopo", async () => {
    /*
      Esta camada não tem escopo por pessoa — é a decisão da casa, e "a mesma
      para todo mundo" é a promessa que a tela faz por escrito. Um operador lê o
      mesmo que quem decidiu.
    */
    expect(chavesDesligadas(await ler("op@x.com"))).toEqual(["/qlp"]);
    expect(chavesDesligadas(await ler("outra-chefe@x.com"))).toEqual(["/qlp"]);
  });

  it("uma decisão sobre outra chave não religa a primeira", async () => {
    /*
      O `PUT` manda **uma** chave, e não a lista do que está ligado. É a
      diferença entre gravar uma decisão e mandar um estado inteiro: um endpoint
      que recebesse só os ligados teria de decidir o que fazer com os ausentes,
      e "ausente = ligado" religa em silêncio tudo que a tela não mandou.
    */
    expect((await definir({ "/frota": false })).status).toBe(200);

    expect(chavesDesligadas(await ler())).toEqual(["/frota", "/qlp"]);
  });

  it("ligar uma chave não mexe na outra, e o histórico guarda as duas decisões", async () => {
    expect((await definir({ "/frota": true })).status).toBe(200);

    const depois = await ler();
    expect(chavesDesligadas(depois)).toEqual(["/qlp"]);
    expect(depois.historico.filter((h) => h.chave === "/frota")).toHaveLength(
      2,
    );
  });

  it("o `false` sobrevive a uma releitura vinda de conexão nova", async () => {
    /*
      O pool do processo responde de memória nenhuma, mas a prova barata é
      perguntar ao banco por outra conexão — é o que um refresh, um logout/login
      ou um segundo processo fariam.
    */
    const { rows } = await ctx.pool.query<{ chave: string }>(
      `SELECT chave FROM "modulo_universal" ORDER BY chave`,
    );
    expect(rows.map((r) => r.chave)).toEqual(["/qlp"]);
  });
});

describe("a gravação é uma transação, e o sucesso da tela é o do banco", () => {
  it("o espelho fora de public é escrito pela mesma transação da decisão", async () => {
    const { rows } = await ctx.pool.query<{ chave: string }>(
      `SELECT chave FROM "drizzle"."modulo_universal__casa" ORDER BY chave`,
    );
    expect(rows.map((r) => r.chave)).toEqual(["/qlp"]);
  });

  it("uma gravação que falha não deixa decisão pela metade nem responde sucesso", async () => {
    /*
      O histórico é parte da decisão, e não um efeito colateral dela. Com as
      quatro escritas soltas, um erro depois da primeira deixava a chave
      desligada **sem** a linha que diz quem a desligou — e a resposta HTTP
      falhava, então a tela nem mostrava o que tinha acontecido. Aqui a tabela
      do histórico é removida para forçar exatamente essa falha.
    */
    await ctx.pool.query(
      `ALTER TABLE "modulo_universal_evento" RENAME TO "mue_escondida"`,
    );
    try {
      const res = await definir({ "/importacoes": false });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await ctx.pool.query(
        `ALTER TABLE "mue_escondida" RENAME TO "modulo_universal_evento"`,
      );
    }

    // Nada meio gravado: a chave não ficou desligada sem o registro de quem a desligou.
    expect(chavesDesligadas(await ler())).toEqual(["/qlp"]);
  });
});

describe("o deploy que apagava a decisão", () => {
  it("depois do DDL destrutivo e da partida, a API volta a responder o que a casa decidiu", async () => {
    const antes = chavesDesligadas(await ler());
    expect(antes).toEqual(["/qlp"]);

    /* O Provision do Publishing, quando Development está atrás de Production. */
    await ctx.pool.query(`DROP TABLE "modulo_universal_evento"`);
    await ctx.pool.query(`DROP TABLE "modulo_universal"`);

    /* A partida seguinte: a fila não vê pendência, a reconvergência repõe a
       estrutura, e a proteção repõe o conteúdo. */
    await reconvergirSeCabivel(ctx.url);
    const protecao = await protegerDecisaoDaCasa(async (texto) => {
      const { rows } = await ctx.pool.query(texto);
      return rows as Record<string, unknown>[];
    });
    expect(protecao.reposicao.repos).toBe(true);

    expect(chavesDesligadas(await ler())).toEqual(antes);
  }, 180_000);
});
