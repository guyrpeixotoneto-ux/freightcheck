import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * A FONTE REAL NA API — e a regra de consolidação que a base semeada não exercita.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo monta **duas quinzenas no mesmo mês**
 * ---------------------------------------------------------------------------
 * Porque é o caso que decide se o produto conta o dinheiro duas vezes, e o
 * acervo de desenvolvimento não o tem: as nove vigências dele caem uma por mês.
 * Um confronto contra o realizado mensal lido sobre uma base assim passaria por
 * correto **e continuaria errado** no dia em que a operação entregasse as duas
 * quinzenas — que é o que ela faz em produção.
 *
 * A parcela FINAME é MENSAL (`docs/AUDITORIA-PERIODICIDADE.md`): as duas
 * entregas de um mês declaram **a mesma** parcela, e não duas metades. O mês
 * consolidado vale uma parcela, e é isso que a primeira asserção prende.
 *
 * ---------------------------------------------------------------------------
 * E por que ele monta duas unidades
 * ---------------------------------------------------------------------------
 * Pela razão de `finame-totais.test.ts`: as leituras que vão ao acervo direto
 * precisam dizer qual recorte leem, e o defeito dessa família não aparece com
 * uma unidade só — aparece como o total da outra, na mesma data.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const PARCELA: AttributeSpec[] = [
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

/** As duas quinzenas de setembro — o mês que o acervo de desenvolvimento não tem. */
const SETEMBRO_Q1 = "2026-09-01";
const SETEMBRO_Q2 = "2026-09-16";
/** Um mês de entrega única, para o outro caminho da consolidação. */
const OUTUBRO = "2026-10-01";

const CAMACARI = "scope-confronto-camacari";
const PERNAMBUCO = "scope-confronto-pernambuco";

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_finame_confronto");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    PARCELA,
    [
      {
        label: "EMPURRADA_1_9_2026",
        effectiveDate: SETEMBRO_Q1,
        data: {
          /* Concorda entre as quinzenas: o mês vale 1.000, e não 2.000. */
          CAM1A11: { "cavalo.finame_cavalo": 1000 },
          /* Discorda: o financiamento mudou no meio do mês. */
          CAM2B22: { "cavalo.finame_cavalo": 500 },
        },
      },
      {
        label: "EMPURRADA_2_9_2026",
        effectiveDate: SETEMBRO_Q2,
        data: {
          CAM1A11: { "cavalo.finame_cavalo": 1000 },
          CAM2B22: { "cavalo.finame_cavalo": 700 },
          /* Só na segunda quinzena: o mês desta placa não é um mês inteiro. */
          CAM3C33: { "cavalo.finame_cavalo": 300 },
        },
      },
      {
        label: "EMPURRADA_1_10_2026",
        effectiveDate: OUTUBRO,
        data: { CAM1A11: { "cavalo.finame_cavalo": 1100 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: CAMACARI, canal: "EMPURRADA" },
  );

  /* A outra unidade, nas mesmas datas e noutra ordem de grandeza: se vazar,
     vaza visível. */
  await buildFixture(
    ctx.db,
    PARCELA,
    [
      {
        label: "EMPURRADA_1_9_2026",
        effectiveDate: SETEMBRO_Q1,
        data: { PER9Z99: { "cavalo.finame_cavalo": 90_000 } },
      },
      {
        label: "EMPURRADA_2_9_2026",
        effectiveDate: SETEMBRO_Q2,
        data: { PER9Z99: { "cavalo.finame_cavalo": 90_000 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: PERNAMBUCO, canal: "EMPURRADA" },
  );

  const { default: finameRouter } = await import("../finame");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(finameRouter);
  app.use(erroEmJson);

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

describe("GET /finame/competencias", () => {
  it("agrupa as duas quinzenas do mês numa competência só", async () => {
    const { status, body } = await get(`/finame/competencias?scopeHash=${CAMACARI}`);
    expect(status).toBe(200);

    const setembro = body.competencias.find((c: any) => c.competencia === "2026-09");
    expect(setembro.rotulo).toBe("setembro/2026");
    expect(setembro.vigencias).toHaveLength(2);
    expect(setembro.vigencias.map((v: any) => v.effectiveDate).sort()).toEqual([
      SETEMBRO_Q1,
      SETEMBRO_Q2,
    ]);
  });

  /* O eixo do Real é mensal. A quinzena existe do lado remunerado, e aparece
     como as **entregas** que compõem o mês — nunca como um período escolhível. */
  it("não oferece quinzena como período", async () => {
    const { body } = await get(`/finame/competencias?scopeHash=${CAMACARI}`);
    const rotulos = body.competencias.map((c: any) => c.rotulo).join(" ");
    expect(rotulos).not.toMatch(/quinzena/i);
    expect(body.competencias.map((c: any) => c.competencia)).toEqual(["2026-09", "2026-10"]);
  });

  it("diz que não há fonte do realizado, em vez de omitir", async () => {
    const { body } = await get(`/finame/competencias?scopeHash=${CAMACARI}`);
    expect(body.realizado.disponivel).toBe(false);
    expect(body.realizado.motivo).toBe("SEM_FONTE");
    expect(body.competencias.every((c: any) => c.temRealizado === false)).toBe(true);
  });

  it("recorta por unidade — Camaçari não vê a competência de Pernambuco somada", async () => {
    const { body } = await get(`/finame/competencias?scopeHash=${PERNAMBUCO}`);
    /* Pernambuco não tem outubro. */
    expect(body.competencias.map((c: any) => c.competencia)).toEqual(["2026-09"]);
  });
});

describe("GET /finame/confronto", () => {
  /**
   * A REGRA CENTRAL: o mês vale **uma** parcela mensal, não a soma das duas
   * entregas. CAM1A11 declara 1.000 nas duas quinzenas de setembro.
   */
  it("não soma as duas quinzenas — o mês de CAM1A11 vale 1.000, não 2.000", async () => {
    const { status, body } = await get(
      `/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}`,
    );
    expect(status).toBe(200);
    expect(body.remunerado.totalConsolidado).toBe(1000);
    expect(body.remunerado.totalConsolidado).not.toBe(2000);
    expect(body.remunerado.consolidados).toBe(1);
  });

  it("a placa que mudou no meio do mês não vira um número — vira divergência", async () => {
    const { body } = await get(`/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}`);
    /* CAM2B22: 500 na primeira quinzena, 700 na segunda. */
    expect(body.remunerado.divergencias).toBe(1);
    /* E os 500 e os 700 ficam fora do total: nem um, nem outro, nem a média. */
    expect(body.remunerado.totalConsolidado).toBe(1000);
  });

  it("a placa presente em meio mês fica como cobertura parcial", async () => {
    const { body } = await get(`/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}`);
    /* CAM3C33 só existe na segunda quinzena. */
    expect(body.remunerado.coberturaParcial).toBe(1);
    expect(body.remunerado.veiculos).toBe(3);
  });

  it("um mês de entrega única consolida com ela", async () => {
    const { body } = await get(`/finame/confronto?competencia=2026-10&scopeHash=${CAMACARI}`);
    expect(body.remunerado.consolidados).toBe(1);
    expect(body.remunerado.totalConsolidado).toBe(1100);
  });

  it("sem fonte do realizado não há confronto, e não há zero", async () => {
    const { body } = await get(`/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}`);
    expect(body.confronto).toBeNull();
    expect(body.realizado.disponivel).toBe(false);
    expect(body.realizado.frase).toContain("Não há fonte de FINAME realizado");
    /* E o que falta é dito, inclusive a recusa do dado de trecho. */
    expect(body.realizado.oQueFalta).toContain("trecho");
  });

  it("o recorte de unidade vale — Pernambuco não entra no total de Camaçari", async () => {
    const camacari = await get(`/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}`);
    const pernambuco = await get(`/finame/confronto?competencia=2026-09&scopeHash=${PERNAMBUCO}`);

    expect(camacari.body.remunerado.totalConsolidado).toBe(1000);
    expect(pernambuco.body.remunerado.totalConsolidado).toBe(90_000);
  });

  it("uma competência que o recorte não tem é 404, e não um mês vazio", async () => {
    const { status, body } = await get(
      `/finame/confronto?competencia=2026-10&scopeHash=${PERNAMBUCO}`,
    );
    expect(status).toBe(404);
    expect(body.error).toContain("outubro/2026");
  });

  it("competência malformada é recusada", async () => {
    expect((await get("/finame/confronto?competencia=2026-13")).status).toBe(400);
    expect((await get("/finame/confronto?competencia=setembro")).status).toBe(400);
    expect((await get("/finame/confronto")).status).toBe(400);
  });
});

/**
 * O portão da fonte — o servidor não aceita o que o cliente diz.
 */
describe("a fonte declarada pelo cliente", () => {
  it("uma fonte inventada é recusada, e não atendida com a outra", async () => {
    const { status, body } = await get(`/finame/competencias?fonte=realizado`);
    expect(status).toBe(400);
    expect(body.error).toContain("fonte=remunerado ou fonte=real");
  });

  it("fonte=real na rota de duas vigências é recusada, com a rota certa na frase", async () => {
    const { status, body } = await get(
      "/finame/comparacao?base=00000000-0000-0000-0000-000000000000" +
        "&comparada=00000000-0000-0000-0000-000000000001&fonte=real",
    );
    expect(status).toBe(422);
    expect(body.error).toContain("/finame/confronto");
  });

  it("fonte=remunerado na rota do confronto é recusada", async () => {
    const { status } = await get("/finame/confronto?competencia=2026-09&fonte=remunerado");
    expect(status).toBe(422);
  });

  /**
   * DADO DE TRECHO NÃO ENTRA — nem por parâmetro.
   *
   * O acervo entrega o arquivo de trecho como vigência própria
   * (`entity_type_set = TRECHO`), e esta auditoria é de custo fixo. A recusa
   * existe em dois lugares e este caso prende o da entrada: `?tipo=TRECHO` é
   * 400, e não uma leitura de custo variável somada dentro do FINAME.
   */
  it("tipo de ativo fora de cavalo e carreta é recusado", async () => {
    for (const tipo of ["TRECHO", "EQUIPE", "QUALQUER"]) {
      const { status, body } = await get(
        `/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}&tipo=${tipo}`,
      );
      expect(status).toBe(400);
      expect(body.error).toContain("CAVALO");
    }
  });

  it("o recorte por tipo válido é honrado", async () => {
    const { status, body } = await get(
      `/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}&tipo=CAVALO`,
    );
    expect(status).toBe(200);
    expect(body.remunerado.totalConsolidado).toBe(1000);

    /* Não há carreta nesta fixture: o recorte devolve um mês sem vigência de
       carreta, e não o total do cavalo sob o rótulo de carreta. */
    const carreta = await get(
      `/finame/confronto?competencia=2026-09&scopeHash=${CAMACARI}&tipo=CARRETA`,
    );
    expect(carreta.status).toBe(404);
  });
});

describe("GET /finame/confronto/evolucao", () => {
  it("sem fonte do realizado, não devolve série — nem a remunerada sozinha", async () => {
    const { status, body } = await get(
      `/finame/confronto/evolucao?scopeHash=${CAMACARI}`,
    );
    expect(status).toBe(200);
    expect(body.serie).toBeNull();
    expect(body.realizado.disponivel).toBe(false);
  });
});
