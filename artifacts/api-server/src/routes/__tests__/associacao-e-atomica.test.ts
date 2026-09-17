import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  cadastrarUnidade,
  db as dbDoProcesso,
  encerrarPoolDoProcesso,
  remuneracaoUnidadeTable,
} from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * A ASSOCIAÇÃO É ATÔMICA — ou grava as três coisas, ou não grava nenhuma.
 *
 * **O que está em jogo.** Associar uma competência escreve identidade em três
 * lugares: a coluna desta competência, a das irmãs com o mesmo texto, e o
 * cadastro de Remuneração sob aquela grafia. As três são **uma afirmação só** —
 * "esta unidade é esta" — e o estado pela metade não é hipotético: competência
 * com identidade e cadastro sem é exatamente a configuração em que
 * `resolverUnidade` deixa de comparar texto e não acha nada pela identidade. O
 * devido some, e nada na tela diz que a gravação foi parcial. Era esse o defeito
 * original; escrevê-lo de novo por uma falha no meio do caminho seria reintroduzi-lo.
 *
 * **Como a falha é forçada — sem mock.** Um gatilho no Postgres que levanta
 * exceção em todo `UPDATE` de `remuneracao_unidade`. A segunda etapa falha de
 * verdade, no banco, dentro da transação: é a falha que um `constraint`, um
 * `deadlock` ou uma queda de conexão produziriam, e não uma função trocada por
 * outra que joga. Se a atomicidade for falsa, este teste vê a competência
 * gravada sozinha.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CNPJ = "11.222.333/0001-81";
const ESCOPO = "escopo-atomicidade";
const UNIDADE = { codigo: CNPJ, nome: "CDD BELÉM" };
const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE" };
const MES = {
  unidade: UNIDADE.codigo,
  transportadora: "36",
  tipoDeOperacao: "ROTA",
  ano: 2026,
  mes: 7,
};

let unidadeId: string;

async function pedir(
  caminho: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function busca(alvo: Record<string, unknown>): string {
  return new URLSearchParams(
    Object.entries(alvo).map(([k, v]) => [k, String(v)]),
  ).toString();
}

/** O estado das três colunas que a associação escreve. */
async function identidades(): Promise<{
  competencias: (string | null)[];
  cadastro: string | null;
}> {
  const { rows: comps } = await dbDoProcesso.execute<{ unidade_id: string | null }>(sql`
    SELECT unidade_id FROM fechamento_competencia
     WHERE ano = 2026 AND mes = 7 ORDER BY quinzena
  `);
  const { rows: cad } = await dbDoProcesso.execute<{ unidade_id: string | null }>(sql`
    SELECT unidade_id FROM remuneracao_unidade WHERE scope_hash = ${ESCOPO}
  `);
  return {
    competencias: comps.map((c) => c.unidade_id),
    cadastro: cad[0]?.unidade_id ?? null,
  };
}

const GATILHO_QUE_FALHA = sql`
  CREATE OR REPLACE FUNCTION falhar_na_conciliacao() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'falha forçada na conciliação do cadastro';
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER conciliacao_falha
    BEFORE UPDATE ON remuneracao_unidade
    FOR EACH ROW EXECUTE FUNCTION falhar_na_conciliacao();
`;

beforeAll(async () => {
  ctx = await createTestDatabase("api_associacao_atomica");
  process.env.DATABASE_URL = ctx.url;

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
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
  app.use(fechamentoRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /* As duas quinzenas com o mesmo texto — a propagação às irmãs também é escrita. */
  for (const quinzena of [1, 2] as const) {
    const { status } = await pedir("/fechamento/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ano: MES.ano,
        mes: MES.mes,
        quinzena,
        unidade: UNIDADE,
        transportadora: TRANSPORTADORA,
        tipoDeOperacao: MES.tipoDeOperacao,
      }),
    });
    expect(status).toBeLessThan(300);
  }

  /* O cadastro legado — sem identidade, que é o que a terceira escrita conserta. */
  await dbDoProcesso.insert(remuneracaoUnidadeTable).values({
    scopeHash: ESCOPO,
    scopeType: "UNIDADE",
    codigo: CNPJ,
    nome: "CDD BELEM",
    canal: "ROTA",
    unidadeId: null,
    vigenciaInicial: "2026-07-01",
  });

  const u = await cadastrarUnidade(dbDoProcesso, { nome: "CDD BELEM", cnpj: CNPJ });
  unidadeId = u.id;

  /*
    Cadastrar a unidade canônica já concilia — é um dos gatilhos normais. Aqui
    isso atrapalharia: o assunto é a associação, e ela precisa começar com as
    três colunas nulas. Desfeito por SQL, e só neste teste.
  */
  await dbDoProcesso.execute(sql`UPDATE fechamento_competencia SET unidade_id = NULL`);
  await dbDoProcesso.execute(sql`UPDATE remuneracao_unidade SET unidade_id = NULL`);
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso().catch(() => {});
  await ctx?.drop().catch(() => {});
});

async function associar(): Promise<{ status: number; body: any }> {
  const competencias = await pedir(`/fechamento/competencias?${busca(MES)}`);
  const primeira = competencias.body.find((c: any) => c.quinzena === 1);
  return pedir(`/fechamento/competencias/${primeira.id}/unidade`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unidadeId }),
  });
}

describe("a associação e a conciliação do cadastro, na mesma transação", () => {
  it("parte do estado em que nada tem identidade", async () => {
    expect(await identidades()).toEqual({ competencias: [null, null], cadastro: null });
  });

  /**
   * A prova: a segunda etapa falha, e a primeira **não** fica.
   *
   * Sem transação, este teste veria `competencias: [<id>, <id>]` com
   * `cadastro: null` — a competência associada e o cadastro sem identidade, que
   * é o estado que faz o `comparado` sumir.
   */
  it("falhando a conciliação do cadastro, nada é gravado", async () => {
    await dbDoProcesso.execute(GATILHO_QUE_FALHA);

    const { status } = await associar();
    expect(status).toBe(500);

    /* Nem a competência, nem a irmã, nem o cadastro. */
    expect(await identidades()).toEqual({ competencias: [null, null], cadastro: null });

    await dbDoProcesso.execute(sql`DROP TRIGGER conciliacao_falha ON remuneracao_unidade`);
  }, 60_000);

  /**
   * E, sem a falha, as três escritas acontecem — de uma vez.
   *
   * É a outra metade do "ou tudo, ou nada": um rollback que também engolisse o
   * caminho feliz passaria no teste de cima e não serviria para nada.
   */
  it("sem a falha, as três escritas acontecem juntas", async () => {
    const { status } = await associar();
    expect(status).toBe(200);

    expect(await identidades()).toEqual({
      competencias: [unidadeId, unidadeId],
      cadastro: unidadeId,
    });
  }, 60_000);
});
