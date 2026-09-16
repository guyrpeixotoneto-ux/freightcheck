import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /finame/totais` — **e de quem é o total que ele devolve.**
 *
 * A rota lê o acervo direto, e não o change set: um total tem de incluir quem
 * não mudou, e o change set não conhece esses veículos. O preço dessa leitura é
 * que ela precisa dizer **qual recorte lê** — e por um tempo não dizia.
 * `getEntityTable` resolve o contexto sozinho quando não recebe um, e o padrão
 * dele é o primeiro contexto do acervo; como a leitura é recortada depois pela
 * `effective_date` do par, o resultado não vinha vazio: vinha de **outra
 * unidade na mesma data**.
 *
 * Era invisível na tela e caro na leitura: o cartão de impacto, que sai do
 * change set do par, falava de uma unidade, e o gráfico de totais logo abaixo —
 * junto com a Evolução, que é a subtração dos dois totais — podia estar falando
 * de outra. Duas unidades, duas datas iguais e dois pares é o mínimo para que a
 * troca apareça, e é o que este arquivo monta.
 *
 * As duas pontas são testadas de propósito. Qual das unidades é o "primeiro
 * contexto" é decisão de uma consulta que não é esta, então afirmar só uma
 * deixaria o defeito passar na metade das vezes.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

/** A parcela do cavalo — a única variável que o total soma. */
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

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";

const CAMACARI = "scope-finame-camacari";
const PERNAMBUCO = "scope-finame-pernambuco";

/** Os ids das quatro vigências, por rótulo. */
let vigencia: Record<string, string> = {};

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O total de uma ponta, como a tela o lê. */
function total(body: any, ponta: "BASE" | "COMPARADA"): number | undefined {
  return body.totais.find((t: any) => t.ponta === ponta)?.total;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_finame_totais");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  const camacari = await buildFixture(
    ctx.db,
    PARCELA,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          CAM1A11: { "cavalo.finame_cavalo": 1000 },
          CAM2B22: { "cavalo.finame_cavalo": 500 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          CAM1A11: { "cavalo.finame_cavalo": 900 },
          CAM2B22: { "cavalo.finame_cavalo": 500 },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: CAMACARI, canal: "EMPURRADA" },
  );

  /* A outra unidade, nas **mesmas duas datas** e com valores de outra ordem de
     grandeza: se um total vazar, ele vaza visível. */
  const pernambuco = await buildFixture(
    ctx.db,
    PARCELA,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: { PER3C33: { "cavalo.finame_cavalo": 70_000 } },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: { PER3C33: { "cavalo.finame_cavalo": 60_000 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: PERNAMBUCO, canal: "EMPURRADA" },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

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

describe("GET /finame/totais", () => {
  it("exige as duas pontas", async () => {
    expect((await get("/finame/totais")).status).toBe(400);
  });

  it("soma a unidade do par, e não a primeira do acervo", async () => {
    const res = await get(
      `/finame/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(total(res.body, "BASE")).toBe(1500);
    expect(total(res.body, "COMPARADA")).toBe(1400);
  });

  /*
    A decomposição sai da mesma leitura que os totais — é a razão de ela vir
    nesta rota, e não de uma segunda consulta. Aqui se prende o que a tela
    precisa poder afirmar: as três parcelas e os dois totais são a mesma conta,
    e a identidade fecha no número que o painel escreve ao lado.
  */
  it("abre a diferença nas três parcelas, e elas fecham com os totais", async () => {
    const res = await get(
      `/finame/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    const cavalo = res.body.evolucao.find((e: any) => e.entityType === "CAVALO");
    expect(cavalo.base).toBe(total(res.body, "BASE"));
    expect(cavalo.comparada).toBe(total(res.body, "COMPARADA"));
    /* CAM1A11 caiu 100; CAM2B22 está nas duas pontas e não se moveu. */
    expect(cavalo.alterados).toBe(-100);
    expect(cavalo.veiculosAlterados).toBe(1);
    expect(cavalo.entradas).toBe(0);
    expect(cavalo.saidas).toBe(0);
    expect(cavalo.base + cavalo.alterados + cavalo.entradas - cavalo.saidas).toBeCloseTo(
      cavalo.comparada,
      2,
    );
  });

  it("soma a outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/finame/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(total(res.body, "BASE")).toBe(70_000);
    expect(total(res.body, "COMPARADA")).toBe(60_000);
  });

  /*
    A mesma leitura direta alimenta as linhas "sem alteração" e as colunas de
    contexto da tabela, e ela tinha o mesmo defeito: com o alternador ligado, a
    tabela de uma unidade podia ganhar as placas da outra. É pedido pelo par de
    Pernambuco de propósito: o padrão que o defeito usava é o **primeiro**
    contexto do acervo, então é a segunda unidade que prova a troca.
  */
  it("não traz a placa da outra unidade nas linhas sem alteração", async () => {
    const res = await get(
      `/finame/comparacao?base=${vigencia.pernambucoBase}` +
        `&comparada=${vigencia.pernambucoComparada}&semAlteracao=true`,
    );
    expect(res.status).toBe(200);
    const placas = new Set<string>(res.body.linhas.map((l: any) => l.entityLabel));
    expect(placas.has("PER3C33")).toBe(true);
    expect(placas.has("CAM1A11")).toBe(false);
    expect(placas.has("CAM2B22")).toBe(false);
  });

  /*
    A Evolução é a subtração destes dois totais, feita na tela. Ela só reconcilia
    com o resto da página se as duas pontas forem da mesma unidade — que é o que
    os dois casos acima garantem, e o que esta asserção escreve por extenso.
  */
  it("dá uma evolução que fecha com a unidade do par", async () => {
    const res = await get(
      `/finame/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(total(res.body, "COMPARADA")! - total(res.body, "BASE")!).toBe(-100);
  });
});
