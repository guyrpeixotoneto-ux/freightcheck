import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  DATASET_FAMILY_QUADRO_DE_PESSOAL,
  DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
} from "@workspace/ingest";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets, listPeriods } from "../consolidated";
import { getGroupedView } from "../grouped";
import { listarVigenciasDaAuditoria } from "../gerencial";
import { listChangeSets, listComparableSnapshots } from "../query";
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

  /*
    Duas quinzenas, e a segunda **depois** da última de equipamento.

    É a forma exata do caso real: o quadro entrega uma data que o equipamento
    ainda não entregou. Com duas, ele também forma um par comparável — e é esse
    par que o contador do menu pegava por ser o mais recente do banco.
  */
  await buildFixture(
    ctx.db,
    QUADRO,
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: "2026-08-01",
        data: { ANALISTA: { "qlp_administrativo.despesa_beneficio": 700 } },
      },
      {
        label: "EMPURRADA_1_9_2026",
        effectiveDate: "2026-09-01",
        data: { ANALISTA: { "qlp_administrativo.despesa_beneficio": 800 } },
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


/**
 * As duas leituras que não passam pelo `contextFilter`.
 *
 * A correção original pôs a família dentro do contexto, e o contexto é o
 * predicado de mais de sessenta consultas — mas não de todas. Duas ficaram de
 * fora **por construção**, porque nenhuma delas é a leitura de uma unidade só:
 * a Visão Gerencial percorre todos os contextos de uma vez, e o seletor de
 * "Comparar vigências" lista todas as vigências vivas. Nas duas, o quadro de
 * pessoal continuou entrando pela mesma porta de sempre: mesma unidade, mesmo
 * canal, portanto a mesma chave de contexto.
 */
describe("a Visão Gerencial da auditoria de equipamento", () => {
  it("não conta as vigências do quadro entre as vigências da unidade", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(linhas.map((l) => l.entityTypeSet)).not.toContain("QLP_ADMINISTRATIVO");
  });

  it("não conta a vigência do quadro no cartão da unidade que divide o escopo", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);
    const daUnidade = linhas.filter((l) => l.contexto.scopeHash === UNIDADE_COMPARTILHADA);

    /*
      Sem a cláusula, esta unidade tinha duas linhas — a de julho, de carreta, e
      a de agosto, de cargos —, e a segunda entrava no cartão como uma vigência
      comparável que ninguém comparou. Era metade da conta "N de M vigências
      comparadas" descrevendo outro assunto.

      E o estrago não parava no cartão. O cartão é um link, e ele leva aos
      Parâmetros da unidade **na última vigência dela** — `max(effectiveDate)`
      destas linhas. Com a de agosto no meio, o link abria os Parâmetros numa
      data que só o quadro entregou: `getGroupedView` não acha o período na
      régua do equipamento, a rota devolve 404, e a tela — que lê 404 como
      "ainda não importaram nada" — anunciava "Nenhuma vigência importada
      ainda" sobre uma unidade com nove vigências no banco. A última data desta
      lista é, portanto, a asserção que importa.
    */
    expect(daUnidade.map((l) => l.effectiveDate)).toEqual(["2026-07-01"]);
  });

  it("a unidade que só entregou quadro não vira cartão de equipamento", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(linhas.map((l) => l.contexto.scopeHash)).not.toContain(UNIDADE_QUADRO);
  });

  it("quem lê o quadro continua enxergando as vigências dele", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    });

    expect(linhas.map((l) => l.entityTypeSet)).toEqual([
      "QLP_ADMINISTRATIVO",
      "QLP_ADMINISTRATIVO",
      "QLP_ADMINISTRATIVO",
    ]);
    expect(linhas.map((l) => l.contexto.scopeHash)).toEqual(
      expect.arrayContaining([UNIDADE_QUADRO, UNIDADE_COMPARTILHADA]),
    );
  });
});

describe("o seletor de vigências para comparar", () => {
  it("não oferece uma quinzena do quadro de pessoal", async () => {
    const vivas = await listComparableSnapshots(ctx.db);

    expect(vivas.map((s) => s.entityTypeSet)).not.toContain("QLP_ADMINISTRATIVO");
  });

  it("continua oferecendo as vigências de equipamento", async () => {
    const vivas = await listComparableSnapshots(ctx.db);

    expect(vivas.map((s) => s.entityTypeSet)).toEqual(["CARRETA", "CARRETA", "CARRETA"]);
  });

  it("quem lê o quadro continua escolhendo entre as quinzenas dele", async () => {
    const vivas = await listComparableSnapshots(ctx.db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    });

    expect(vivas.map((s) => s.entityTypeSet)).toEqual([
      "QLP_ADMINISTRATIVO",
      "QLP_ADMINISTRATIVO",
      "QLP_ADMINISTRATIVO",
    ]);
  });
});

describe("o contador de alterações do menu", () => {
  /*
    Ele lê a listagem de comparações, pega a data mais recente e soma o que
    termina nela — ver `components/layout/contadores.ts`. Sem a cláusula, a
    comparação do quadro, que termina em setembro, virava "a vigência aberta", e
    o menu escrevia as alterações de cargos ao lado de um Resumo executivo que
    falava de placas: dois números, duas realidades, a mesma tela.
  */
  const dataDe = (linha: Record<string, unknown>) =>
    String(linha.snapshot_b_date ?? "").slice(0, 10);

  it("a vigência mais recente da lista é a do equipamento, e não a do quadro", async () => {
    const comparacoes = await listChangeSets(ctx.db);
    const datas = comparacoes.map(dataDe);

    expect(datas).not.toContain("2026-09-01");
    expect(datas[0]).toBe("2026-08-01");
  });

  it("quem lê o quadro continua enxergando as comparações dele", async () => {
    const comparacoes = await listChangeSets(ctx.db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    });

    expect(comparacoes.map(dataDe)).toEqual(["2026-09-01"]);
  });
});
