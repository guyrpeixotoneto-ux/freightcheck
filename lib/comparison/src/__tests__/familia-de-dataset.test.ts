import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  DATASET_FAMILY_QUADRO_DE_PESSOAL,
  DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
} from "@workspace/ingest";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets, listPeriods } from "../consolidated";
import { getGroupedView } from "../grouped";
import { listContexts, resolveContext } from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * A leitura de equipamento não enxerga as vigências do quadro de pessoal.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este arquivo fixa
 * ---------------------------------------------------------------------------
 * Uma importação de QLP Administrativo fez os dados de cavalo e carreta
 * *sumirem* da tela — Resumo executivo aberto na unidade de sempre, e nele
 * apenas `qlp_administrativo`. Nada tinha sido apagado: os fatos do
 * equipamento continuavam no banco, na vigência de sempre, com a mesma
 * contagem. O que mudou foi **qual contexto a tela abre por padrão**.
 *
 * `snapshot.dataset_family` existe justamente para separar "a vigência que
 * fala de caminhão" da "que fala de gente" — o comentário de
 * `DATASET_FAMILY_QUADRO_DE_PESSOAL` diz isso com todas as letras, e a
 * ingestão respeita a separação: as duas famílias nunca caem no mesmo
 * snapshot. A **leitura** é que não sabia que famílias existem.
 * `lib/qlp/src/contexto.ts` já se protegia — lista contextos só da família
 * QUADRO_DE_PESSOAL, "senão o seletor da tela ofereceria quinzenas de
 * equipamento que esta leitura não sabe responder". A proteção espelhada, do
 * lado do equipamento, nunca foi escrita.
 *
 * Sem ela, `listContexts()` devolve o QLP junto do equipamento, e
 * `resolveContext` sem pedido explícito pega `contexts[0]` — a barra lateral
 * faz o mesmo (`contextos[0]`). Duas linhas rotuladas "CAMAÇARI", uma delas
 * sem um caminhão sequer, e a tela abrindo na errada.
 *
 * ---------------------------------------------------------------------------
 * Os dois caminhos, e por que os dois estão aqui
 * ---------------------------------------------------------------------------
 * O `scope_hash` do arquivo de QLP pode ou não bater com o do equipamento — ele
 * é o hash do conjunto de escopos **como veio escrito**, e dois exports do
 * mesmo sistema divergem no CNPJ mascarado, no conjunto de operadores, na
 * regional. O defeito aparece dos dois jeitos, e por isso os dois são testados:
 *
 * - **hash diferente** → o QLP vira um *segundo contexto* da mesma unidade, e
 *   pode ganhar o padrão. Foi o que a tela mostrou.
 * - **hash igual** → o QLP entra na *régua de vigências* do equipamento, e uma
 *   data que só o quadro entregou vira o período aberto por padrão.
 */

let ctx: TestDb;

/*
  Hashes escolhidos para que o do quadro ordene **antes** do de equipamento.

  `listContexts` desempata `max(effective_date) DESC` por `scope_hash`, e em
  produção esses valores são SHA-256: qual dos dois vem primeiro é sorteio. O
  teste fixa o sorteio no lado que expõe o defeito — o outro lado passaria
  mesmo com o bug, e um teste que só passa por sorte não prova nada.
*/
const UNIDADE_EQUIPAMENTO = "a7f1e2d4-equipamento-camacari";
const UNIDADE_QUADRO = "a3c0b9e8-quadro-camacari";
/** Mesma unidade, mesmo canal, mesmo `scope_hash`: o segundo caminho. */
const UNIDADE_COMPARTILHADA = "c5d2f0a1-compartilhada-jaguariuna";

const CUSTO: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const QUADRO: AttributeSpec[] = [
  {
    code: "qlp_administrativo.despesa_beneficio",
    dataType: "NUMERIC",
    semanticsStatus: "UNKNOWN",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("familia_de_dataset");
  await seedTaxonomy(ctx.db, "test");

  // --- Caminho 1: o quadro com escopo próprio, e mais recente que o equipamento.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_1_7_2026",
        effectiveDate: "2026-07-01",
        data: { AAA1A11: { "carreta.custo_fixo": 1000 } },
      },
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: "2026-08-01",
        data: { AAA1A11: { "carreta.custo_fixo": 1200 } },
      },
    ],
    {
      entityType: "CARRETA",
      scopeHash: UNIDADE_EQUIPAMENTO,
      canal: "EQUIPAMENTO",
      datasetFamily: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    },
  );

  await buildFixture(
    ctx.db,
    QUADRO,
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: "2026-08-01",
        data: { CONFERENTE: { "qlp_administrativo.despesa_beneficio": 900 } },
      },
    ],
    {
      entityType: "QLP_ADMINISTRATIVO",
      scopeHash: UNIDADE_QUADRO,
      canal: "QUADRO",
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    },
  );

  // --- Caminho 2: as duas famílias no mesmo `scope_hash`, o quadro mais recente.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_1_7_2026",
        effectiveDate: "2026-07-01",
        data: { BBB2B22: { "carreta.custo_fixo": 3000 } },
      },
    ],
    {
      entityType: "CARRETA",
      scopeHash: UNIDADE_COMPARTILHADA,
      canal: "EQUIPAMENTO",
      datasetFamily: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    },
  );

  await buildFixture(
    ctx.db,
    QUADRO,
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: "2026-08-01",
        data: { ANALISTA: { "qlp_administrativo.despesa_beneficio": 700 } },
      },
    ],
    {
      entityType: "QLP_ADMINISTRATIVO",
      scopeHash: UNIDADE_COMPARTILHADA,
      canal: "QUADRO",
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    },
  );

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o seletor de unidades da leitura de equipamento", () => {
  it("não oferece uma unidade que só entregou quadro de pessoal", async () => {
    const contextos = await listContexts(ctx.db);

    expect(contextos.map((c) => c.scopeHash)).not.toContain(UNIDADE_QUADRO);
  });

  it("continua oferecendo as unidades que entregaram equipamento", async () => {
    const contextos = await listContexts(ctx.db);

    expect(contextos.map((c) => c.scopeHash)).toEqual(
      expect.arrayContaining([UNIDADE_EQUIPAMENTO, UNIDADE_COMPARTILHADA]),
    );
  });

  it("a tela do quadro continua enxergando as vigências dele", async () => {
    const contextos = await listContexts(ctx.db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    });

    expect(contextos.map((c) => c.scopeHash)).toEqual(
      expect.arrayContaining([UNIDADE_QUADRO, UNIDADE_COMPARTILHADA]),
    );
    expect(contextos.map((c) => c.scopeHash)).not.toContain(UNIDADE_EQUIPAMENTO);
  });
});

describe("o contexto que a leitura de equipamento abre por padrão", () => {
  it("é de equipamento, mesmo com o quadro ordenando antes", async () => {
    const contexto = await resolveContext(ctx.db);

    expect(contexto?.scopeHash).not.toBe(UNIDADE_QUADRO);
    expect(contexto?.scopeHash).toBe(UNIDADE_EQUIPAMENTO);
  });

  it("o Resumo executivo abre na vigência de equipamento, com a série dela", async () => {
    const view = await getGroupedView(ctx.db);

    expect(view).not.toBeNull();
    expect(view!.context.scopeHash).toBe(UNIDADE_EQUIPAMENTO);
    expect(view!.period).toBe("2026-08-01");
    expect(view!.series.map((s) => s.entityTypeSet)).toEqual(["CARRETA"]);
  });
});

describe("a régua de vigências, quando as duas famílias dividem o escopo", () => {
  const contexto = { scopeHash: UNIDADE_COMPARTILHADA, channel: "EMPURRADA" };

  it("não lista a vigência que só o quadro entregou", async () => {
    const periodos = await listPeriods(ctx.db, contexto);

    expect(periodos.map((p) => p.effective_date)).toEqual(["2026-07-01"]);
  });

  it("o Resumo executivo abre em julho, e não na vigência do quadro", async () => {
    const view = await getGroupedView(ctx.db, undefined, {
      scopeHash: UNIDADE_COMPARTILHADA,
    });

    expect(view).not.toBeNull();
    expect(view!.period).toBe("2026-07-01");
    expect(view!.series.map((s) => s.entityTypeSet)).toEqual(["CARRETA"]);
  });
});
