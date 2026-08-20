import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { sql } from "drizzle-orm";
import { hashScopeSet } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `POST /remuneracao/unidades` — a borda onde a unidade digitada ganha o
 * identificador da unidade importada.
 *
 * O domínio é provado sem HTTP em `lib/remuneracao`. O que só existe aqui, e é
 * o que decide se este caminho funciona ou vira uma armadilha de meses:
 *
 * 1. **O `scope_hash` é somado na borda, com o `hashScopeSet` da importação.**
 *    Se um dia esta rota passar a somá-lo de outro jeito — ou a limpar a
 *    máscara do código antes —, a unidade digitada deixa de reencontrar a
 *    importada, e nada em tela avisa. O primeiro caso abaixo compara contra a
 *    função de verdade, e não contra um valor copiado. Sem código, ele é somado
 *    sobre o nome, e o que os casos fixam é o preço disso.
 * 2. **As recusas viram número por classe**, pela tabela de
 *    `recusa-de-dominio.ts` — sem `try/catch` na rota.
 * 3. **O autor sai da sessão**, e nunca do corpo.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function enviar(corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}/remuneracao/unidades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function informarCodigo(corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}/remuneracao/unidades/codigo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

/** Grava uma célula da planilha direto no banco, para o teste do movimento. */
async function planilhaEm(scopeHash: string, canal: string, vigencia: string, chave: string) {
  await ctx.db.execute(sql`
    INSERT INTO remuneracao_planilha (scope_hash, canal, effective_date, chave, valor)
    VALUES (${scopeHash}, ${canal}, ${vigencia}, ${chave}, '1')
  `);
}

async function celulasEm(scopeHash: string): Promise<number> {
  const { rows } = await ctx.db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM remuneracao_planilha WHERE scope_hash = ${scopeHash}`,
  );
  return rows[0]?.total ?? 0;
}

const VALIDO = {
  nome: "CAMAÇARI",
  codigo: "12345678000199",
  canal: "EMPURRADA",
  vigencia: "2026-08-01",
};

beforeAll(async () => {
  ctx = await createTestDatabase("api_remuneracao_unidades");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: remuneracaoRouter } = await import("../remuneracao");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    (req as unknown as { user: unknown }).user = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Guy",
      email: "teste@freightcheck",
      role: "OPERADOR",
    };
    next();
  });
  app.use(remuneracaoRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

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

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE remuneracao_unidade`);
  await ctx.db.execute(sql`TRUNCATE remuneracao_planilha`);
});

describe("o identificador que a rota soma", () => {
  it("é o mesmo que a importação calcularia para aquele código", async () => {
    const r = await enviar(VALIDO);

    expect(r.status).toBe(201);
    // Contra a função de verdade, e não contra um hash copiado: uma constante
    // aqui passaria a valer sozinha no dia em que a importação mudasse a regra
    // — que é exatamente o dia em que este teste precisa falhar.
    expect(r.body.scopeHash).toBe(hashScopeSet(["UNIDADE:12345678000199"]));
  });

  it("não limpa a máscara do código — o hash da importação é sobre o texto da célula", async () => {
    /*
      Parece capricho normalizar `12.345.678/0001-99` para dígitos. Seria o
      defeito: `resolveScopes` soma o hash sobre o código como veio na célula,
      com `trim` e nada mais. Limpar aqui produziria o identificador de um
      código que o arquivo não tem.
    */
    const r = await enviar({ ...VALIDO, codigo: " 12.345.678/0001-99 " });

    expect(r.body.codigo).toBe("12.345.678/0001-99");
    expect(r.body.scopeHash).toBe(hashScopeSet(["UNIDADE:12.345.678/0001-99"]));
  });
});

/**
 * A unidade sem código — o caminho que exigir o CNPJ fechava.
 *
 * Exigi-lo mandava quem tem a aba de Excel na mão procurar o código num export
 * que ainda não chegou, para poder digitar a planilha que já chegou: a mesma
 * parede que esta rota existe para derrubar, um passo adiante. Ela passa a
 * aceitar, e o que estes casos fixam é **o preço** — porque um preço que a
 * suíte não afirma é um preço que alguém vai descobrir em produção.
 */
describe("a unidade sem código", () => {
  it("é aceita, e o identificador passa a sair do nome", async () => {
    const r = await enviar({ ...VALIDO, codigo: "  " });

    expect(r.status).toBe(201);
    // O código continua sendo o que foi digitado — nada. Inventá-lo a partir
    // do nome faria a linha afirmar um código que ninguém deu.
    expect(r.body.codigo).toBe("");
    expect(r.body.scopeHash).toBe(hashScopeSet(["UNIDADE:CAMAÇARI"]));
  });

  it("não recebe o identificador que a importação daquele CNPJ produziria", async () => {
    /*
      É o preço, afirmado: o hash do nome não é o hash do código, então o export
      abrirá a unidade dele ao lado desta. A tela diz isso por extenso embaixo do
      campo, e este teste é o que impede a frase de virar mentira em silêncio se
      alguém "melhorar" a regra do identificador.
    */
    const r = await enviar({ ...VALIDO, codigo: "" });

    expect(r.body.scopeHash).not.toBe(hashScopeSet(["UNIDADE:12345678000199"]));
  });

  it("duas unidades sem código não colidem uma na outra", async () => {
    /*
      O caso que um descritor `UNIDADE:` puro quebraria: todas as unidades sem
      código dividiriam um identificador só, e a segunda voltaria 409 — CAMAÇARI
      barrando a entrada de BELÉM, sem nada em tela explicando por quê.
    */
    await enviar({ ...VALIDO, codigo: "", nome: "CAMAÇARI" });
    const r = await enviar({ ...VALIDO, codigo: "", nome: "BELÉM" });

    expect(r.status).toBe(201);
    expect(r.body.scopeHash).toBe(hashScopeSet(["UNIDADE:BELÉM"]));
  });

  it("o mesmo nome, com outra caixa, continua sendo a mesma unidade", async () => {
    // O hash sai do nome **normalizado**, e é o que faz o segundo registro ser
    // reconhecido como repetição em vez de abrir uma CAMAÇARI minúscula.
    await enviar({ ...VALIDO, codigo: "" });
    const r = await enviar({ ...VALIDO, codigo: "", nome: " camaçari " });

    expect(r.status).toBe(409);
  });
});

describe("o que a rota recusa, e com qual número", () => {
  it("400 sem quinzena, porque o formulário abriria sem nada para escolher", async () => {
    const r = await enviar({ ...VALIDO, vigencia: "" });

    expect(r.status).toBe(400);
  });

  it("400 com quinzena que não é data", async () => {
    const r = await enviar({ ...VALIDO, vigencia: "agosto de 2026" });

    expect(r.status).toBe(400);
  });

  it("400 sem nome", async () => {
    const r = await enviar({ ...VALIDO, nome: "   " });

    expect(r.status).toBe(400);
  });

  it("409 no par repetido — o pedido está bom, o estado é que já responde", async () => {
    await enviar(VALIDO);
    const r = await enviar(VALIDO);

    // 409 e não 400: a frase manda para a lista, onde a unidade está.
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("lista de unidades");
  });

  it("aceita o mesmo código em outro tipo de operação", async () => {
    await enviar(VALIDO);
    const r = await enviar({ ...VALIDO, canal: "ROTA" });

    // É a mesma unidade rodando duas operações — o par (escopo, canal) as
    // separa, como no acervo.
    expect(r.status).toBe(201);
    expect(r.body.scopeHash).toBe(hashScopeSet(["UNIDADE:12345678000199"]));
  });
});

/**
 * `PUT /remuneracao/unidades/codigo` — o CNPJ que chega depois.
 *
 * Cadastrar sem código é permitido, e o preço é o reencontro: o identificador
 * sai do nome, e o export abre a unidade dele ao lado desta. Esta rota é o que
 * torna esse preço **reversível** — e o que ela move não é uma linha, são duas
 * tabelas: sem a planilha junto, a unidade reapareceria no lugar certo e vazia,
 * com o que alguém digitou pendurado num escopo que nenhuma tela mostra mais.
 */
describe("informar o código depois", () => {
  const POR_NOME = hashScopeSet(["UNIDADE:CAMAÇARI"]);
  const POR_CODIGO = hashScopeSet(["UNIDADE:12345678000199"]);

  it("move a unidade para o escopo que a importação vai produzir", async () => {
    await enviar({ ...VALIDO, codigo: "" });

    const r = await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    expect(r.status).toBe(200);
    expect(r.body.scopeHash).toBe(POR_CODIGO);
    expect(r.body.unidades[0].codigo).toBe("12345678000199");
    expect(r.body.unidades[0].scopeHash).toBe(POR_CODIGO);
  });

  it("leva a planilha digitada junto — é o ponto do ato", async () => {
    await enviar({ ...VALIDO, codigo: "" });
    await planilhaEm(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_pis");
    await planilhaEm(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_cofins");

    await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    expect(await celulasEm(POR_NOME)).toBe(0);
    expect(await celulasEm(POR_CODIGO)).toBe(2);
  });

  it("move os dois tipos de operação de uma vez — o CNPJ é da unidade", async () => {
    /*
      EMPURRADA e ROTA da mesma CAMAÇARI dividem o escopo do nome, e o arquivo
      vai trazer as duas com o mesmo CNPJ. Mover uma e deixar a outra partiria
      em duas uma unidade que o export traz inteira.
    */
    await enviar({ ...VALIDO, codigo: "" });
    await enviar({ ...VALIDO, codigo: "", canal: "ROTA" });

    const r = await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    expect(r.status).toBe(200);
    expect(r.body.unidades).toHaveLength(2);
    expect(r.body.unidades.map((u: { canal: string }) => u.canal).sort()).toEqual([
      "EMPURRADA",
      "ROTA",
    ]);
  });

  it("404 no escopo que não é de unidade cadastrada à mão", async () => {
    const r = await informarCodigo({ scopeHash: POR_CODIGO, codigo: "12345678000199" });

    expect(r.status).toBe(404);
  });

  it("409 na unidade que já tem código — trocar um código que vale é outra coisa", async () => {
    await enviar(VALIDO);

    const r = await informarCodigo({ scopeHash: POR_CODIGO, codigo: "99999999000199" });

    expect(r.status).toBe(409);
    expect(r.body.error).toContain("12345678000199");
  });

  it("409 quando o destino já é de outra unidade cadastrada à mão", async () => {
    await enviar({ ...VALIDO, codigo: "" });
    await enviar({ ...VALIDO, codigo: "12345678000199", nome: "OUTRA" });

    const r = await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    expect(r.status).toBe(409);
    expect(r.body.error).toContain("OUTRA");
  });

  it("409 quando as duas planilhas têm a mesma célula, e diz em qual vigência", async () => {
    await enviar({ ...VALIDO, codigo: "" });
    await planilhaEm(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_pis");
    await planilhaEm(POR_CODIGO, "EMPURRADA", "2026-08-01", "aliquota_pis");

    const r = await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    expect(r.status).toBe(409);
    expect(r.body.error).toContain("2026-08-01");
  });

  it("não move nada quando recusa — a transação inteira volta atrás", async () => {
    await enviar({ ...VALIDO, codigo: "" });
    await planilhaEm(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_pis");
    await planilhaEm(POR_NOME, "EMPURRADA", "2026-08-16", "aliquota_cofins");
    await planilhaEm(POR_CODIGO, "EMPURRADA", "2026-08-01", "aliquota_pis");

    await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    // As duas células da origem continuam onde estavam: uma recusa não pode
    // deixar a unidade metade aqui e metade lá.
    expect(await celulasEm(POR_NOME)).toBe(2);
  });

  it("400 sem código — é o que o ato informa", async () => {
    await enviar({ ...VALIDO, codigo: "" });

    const r = await informarCodigo({ scopeHash: POR_NOME, codigo: "   " });

    expect(r.status).toBe(400);
  });

  it("depois de informado, a unidade responde no escopo novo", async () => {
    await enviar({ ...VALIDO, codigo: "" });
    await informarCodigo({ scopeHash: POR_NOME, codigo: "12345678000199" });

    const res = await fetch(`${base}/remuneracao/situacao`);
    const body = (await res.json()) as { unidades: { scopeHash: string; label: string }[] };

    expect(body.unidades.find((u) => u.scopeHash === POR_NOME)).toBeUndefined();
    expect(body.unidades.find((u) => u.scopeHash === POR_CODIGO)?.label).toBe(
      "CAMAÇARI · EMPURRADA",
    );
  });
});

describe("o que a rota grava sem perguntar ao corpo", () => {
  it("o autor sai da sessão", async () => {
    const r = await enviar({ ...VALIDO, autorNome: "Outra Pessoa" });

    expect(r.body.autorNome).toBe("Guy");
  });

  it("o nome e o canal vão normalizados, para a mesma unidade não virar duas", async () => {
    const r = await enviar({ ...VALIDO, nome: " camaçari ", canal: " empurrada " });

    expect(r.body.nome).toBe("CAMAÇARI");
    expect(r.body.canal).toBe("EMPURRADA");
  });
});

describe("a unidade cadastrada aparece nas leituras do módulo", () => {
  it("entra na situação, marcada como cadastrada à mão", async () => {
    await enviar(VALIDO);

    const res = await fetch(`${base}/remuneracao/situacao`);
    const body = (await res.json()) as {
      unidades: { scopeHash: string; registradaAMao: boolean; label: string }[];
    };

    const nossa = body.unidades.find(
      (u) => u.scopeHash === hashScopeSet(["UNIDADE:12345678000199"]),
    );

    expect(nossa).toBeDefined();
    expect(nossa!.label).toBe("CAMAÇARI · EMPURRADA");
    // A marca é o que impede a tela de dizer "sem lastro" do mesmo jeito nos
    // dois casos — num deles falta coluna, no outro falta arquivo inteiro.
    expect(nossa!.registradaAMao).toBe(true);
  });

  it("abre o cadastro na quinzena declarada", async () => {
    await enviar(VALIDO);

    const escopo = hashScopeSet(["UNIDADE:12345678000199"]);
    const res = await fetch(
      `${base}/remuneracao/cadastro?scopeHash=${escopo}&canal=EMPURRADA`,
    );
    const body = (await res.json()) as { effectiveDate: string };

    expect(res.status).toBe(200);
    expect(body.effectiveDate).toBe("2026-08-01");
  });
});
