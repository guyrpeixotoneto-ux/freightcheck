import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { snapshotTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { setImportRunHidden } from "@workspace/ingest";
import { computeChangeSet } from "../engine";
import { getRadarDeTrechos, resolverComparacaoDeTrecho } from "../radar-trechos";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * A leitura do Radar contra o banco — o que `radar-trechos.test.ts` não
 * cobre porque é pura.
 *
 * Três afirmações que só o banco prova:
 *
 * 1. Um trecho sem nenhuma alteração ainda aparece, como IGUAL — ele não gera
 *    linha em `change` (o motor pula `unchanged`), e sem a consulta de
 *    presença por `fato_visivel` ele simplesmente desapareceria do Radar.
 * 2. `entity_type <> 'TRECHO'` nunca vaza para dentro — o mesmo risco que o
 *    commit #345 corrigiu nos outros motores compartilhados.
 * 3. Um fato oculto (`import_run.hidden_at`) não aparece nem no cálculo nem
 *    na presença.
 */

let ctx: TestDb;

const FRETE: AttributeSpec[] = [
  {
    code: "trecho.frete_liquido",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    economicDirection: "HIGHER_IS_BETTER",
  },
  {
    code: "trecho.pedagio",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    economicDirection: "HIGHER_IS_WORSE",
  },
  {
    code: "trecho.unidade_nome",
    dataType: "TEXT",
    semanticsStatus: "CONFIRMED",
    economicDirection: "NEUTRAL",
  },
];

const CUSTO_CAVALO: AttributeSpec[] = [
  {
    code: "cavalo.ipva",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    economicDirection: "HIGHER_IS_WORSE",
  },
];

let changeSetId: string;
let changeSetOcultoId: string;
let importRunOcultaId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("radar_trechos_leitura");
  await seedTaxonomy(ctx.db, "test");

  const trechos = await buildFixture(
    ctx.db,
    FRETE,
    [
      {
        label: "EMPURRADA_1_1_2026",
        effectiveDate: "2026-01-01",
        data: {
          T_MELHOROU: { "trecho.frete_liquido": 5000, "trecho.pedagio": 800, "trecho.unidade_nome": "Manaus" },
          T_IGUAL: { "trecho.frete_liquido": 3000, "trecho.pedagio": 400, "trecho.unidade_nome": "Belém" },
        },
      },
      {
        label: "EMPURRADA_1_2_2026",
        effectiveDate: "2026-02-01",
        data: {
          // Melhorou: frete líquido subiu (bom) e pedágio caiu (bom).
          T_MELHOROU: { "trecho.frete_liquido": 5500, "trecho.pedagio": 700, "trecho.unidade_nome": "Manaus" },
          // Igual: nada mudou.
          T_IGUAL: { "trecho.frete_liquido": 3000, "trecho.pedagio": 400, "trecho.unidade_nome": "Belém" },
        },
      },
    ],
    { entityType: "TRECHO", scopeHash: "scope-radar" },
  );

  // Cavalo na mesma unidade e no mesmo canal, para provar que ele não vaza
  // para dentro do Radar (que só lê entity_type = 'TRECHO').
  const cavalo = await buildFixture(
    ctx.db,
    CUSTO_CAVALO,
    [
      {
        label: "EMPURRADA_1_1_2026",
        effectiveDate: "2026-01-01",
        data: { AAA1A11: { "cavalo.ipva": 200 } },
      },
      {
        label: "EMPURRADA_1_2_2026",
        effectiveDate: "2026-02-01",
        data: { AAA1A11: { "cavalo.ipva": 900 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: "scope-radar", canal: "CAVALO_RADAR" },
  );
  void cavalo;

  const set = await computeChangeSet(
    ctx.db,
    trechos.snapshotIds.EMPURRADA_1_1_2026,
    trechos.snapshotIds.EMPURRADA_1_2_2026,
    { computedBy: "test:radar" },
  );
  changeSetId = set.id;

  // Uma segunda série, oculta na origem: prova que o Radar não a mostra.
  const oculta = await buildFixture(
    ctx.db,
    FRETE,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: "2026-01-01",
        data: { T_OCULTO: { "trecho.frete_liquido": 1000, "trecho.pedagio": 100, "trecho.unidade_nome": "Recife" } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-01",
        data: { T_OCULTO: { "trecho.frete_liquido": 200, "trecho.pedagio": 100, "trecho.unidade_nome": "Recife" } },
      },
    ],
    { entityType: "TRECHO", scopeHash: "scope-radar-oculta", canal: "OCULTA" },
  );
  const setOculto = await computeChangeSet(
    ctx.db,
    oculta.snapshotIds.EMPURRADA_2_1_2026,
    oculta.snapshotIds.EMPURRADA_2_2_2026,
    { computedBy: "test:radar" },
  );
  changeSetOcultoId = setOculto.id;

  const [snapOculta] = await ctx.db
    .select({ importRunId: snapshotTable.importRunId })
    .from(snapshotTable)
    .where(eq(snapshotTable.id, oculta.snapshotIds.EMPURRADA_2_1_2026));
  importRunOcultaId = snapOculta.importRunId;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("um trecho sem nenhuma alteração ainda aparece, como IGUAL", () => {
  it("T_IGUAL está no Radar mesmo sem gerar linha em `change`", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId);
    const igual = radar.trechos.find((t) => t.entityLabel === "T_IGUAL");
    expect(igual).toBeDefined();
    expect(igual!.resumo.veredito).toBe("IGUAL");
    expect(igual!.resumo.totalAlteracoes).toBe(0);
  });

  it("T_MELHOROU consolida frete líquido subindo e pedágio caindo como melhora", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId);
    const melhorou = radar.trechos.find((t) => t.entityLabel === "T_MELHOROU");
    expect(melhorou).toBeDefined();
    expect(melhorou!.resumo.veredito).toBe("MELHOROU");
    // +500 (frete líquido) + 100 (pedágio caiu 100, favorável) = 600
    expect(melhorou!.resumo.impactoLiquido).toBe(600);
  });

  it("o total do Radar conta os dois trechos da unidade — nenhum se perde", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId);
    expect(radar.total).toBe(2);
  });
});

describe("isolamento — entity_type <> 'TRECHO' nunca aparece", () => {
  it("o cavalo da mesma unidade e do mesmo period não entra no Radar", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId);
    expect(radar.trechos.every((t) => t.entityLabel !== "AAA1A11")).toBe(true);
  });
});

/**
 * A resolução do contexto — o caminho que produziu, em produção, "este
 * contexto não tem nenhuma vigência de trecho importada" numa unidade que o
 * Trecho 360° mostrava com centenas de trechos.
 *
 * A causa é a "casca": um acervo em que o trecho vem no próprio snapshot
 * (`entity_type_set = 'TRECHO'`) é invisível para `listContexts` sem
 * `incluirCascaDeTrecho` — e essa exclusão existe por um bom motivo (a casca
 * não deve virar "a vigência mais recente" das telas de equipamento). Só que
 * **o Radar é a tela de trecho**: pedir a lista sem a casca faz o padrão dele
 * cair numa unidade de equipamento e não achar trecho nenhum.
 */
describe("resolverComparacaoDeTrecho acha a vigência de trecho", () => {
  it("sem scopeHash pedido, cai numa unidade que tem trecho — não numa de equipamento", async () => {
    const r = await resolverComparacaoDeTrecho(ctx.db);
    expect(r.erro).toBeNull();
  });

  it("com o scopeHash da unidade de trecho, acha a comparação", async () => {
    const r = await resolverComparacaoDeTrecho(ctx.db, { scopeHash: "scope-radar" });
    expect(r.erro).toBeNull();
    if (r.erro === null) {
      expect(r.changeSetId).toBeTruthy();
      expect(r.context.scopeHash).toBe("scope-radar");
    }
  });

  /*
    A reprodução do defeito de produção: uma unidade **só de equipamento**,
    com vigência mais recente que a de trecho. Ela é a primeira da lista que
    `listContexts` devolve (ordenada por data), então era ela que o padrão do
    Radar resolvia — e dentro dela não há trecho nenhum. O Trecho 360° da
    outra unidade seguia mostrando centenas de trechos ao lado.
  */
  it("uma unidade de equipamento mais recente não rouba o padrão do Radar", async () => {
    await buildFixture(
      ctx.db,
      CUSTO_CAVALO,
      [
        {
          label: "EMPURRADA_9_1_2027",
          effectiveDate: "2027-01-01",
          data: { ZZZ9Z99: { "cavalo.ipva": 100 } },
        },
        {
          label: "EMPURRADA_9_2_2027",
          effectiveDate: "2027-02-01",
          data: { ZZZ9Z99: { "cavalo.ipva": 150 } },
        },
      ],
      { entityType: "CAVALO", scopeHash: "scope-so-equipamento", canal: "SO_EQUIPAMENTO" },
    );

    const r = await resolverComparacaoDeTrecho(ctx.db);
    expect(r.erro).toBeNull();
    if (r.erro === null) {
      expect(r.context.scopeHash).not.toBe("scope-so-equipamento");
    }
  });

  it("um scopeHash que não tem trecho recusa dizendo isso, sem inventar outra unidade", async () => {
    const r = await resolverComparacaoDeTrecho(ctx.db, { scopeHash: "scope-so-equipamento" });
    expect(r.erro).toBe("SEM_TRECHO");
  });
});

describe("filtros, ordenação e paginação", () => {
  it("filtra por status", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId, { status: ["MELHOROU"] });
    expect(radar.trechos).toHaveLength(1);
    expect(radar.trechos[0].entityLabel).toBe("T_MELHOROU");
  });

  it("busca por trecho, case-insensitive", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId, { busca: "melhorou" });
    expect(radar.trechos).toHaveLength(1);
  });

  it("pagina sem perder o total real", async () => {
    const pagina = await getRadarDeTrechos(ctx.db, changeSetId, { limit: 1, offset: 0 });
    expect(pagina.trechos).toHaveLength(1);
    expect(pagina.total).toBe(2);
  });
});

describe("fatos ocultos", () => {
  it("antes de ocultar, T_OCULTO aparece normalmente no seu próprio change-set", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetOcultoId);
    expect(radar.trechos.some((t) => t.entityLabel === "T_OCULTO")).toBe(true);
  });

  it("depois de ocultar a importação de origem, T_OCULTO some do Radar — cálculo e presença", async () => {
    await setImportRunHidden(ctx.db, importRunOcultaId, true, { by: "test@operalog.com.br" });
    const radar = await getRadarDeTrechos(ctx.db, changeSetOcultoId);
    expect(radar.trechos.some((t) => t.entityLabel === "T_OCULTO")).toBe(false);
    expect(radar.total).toBe(0);
  });

  it("um trecho de outra unidade nunca viu o oculto — isolamento intacto", async () => {
    const radar = await getRadarDeTrechos(ctx.db, changeSetId);
    expect(radar.trechos.every((t) => t.entityLabel !== "T_OCULTO")).toBe(true);
  });
});
