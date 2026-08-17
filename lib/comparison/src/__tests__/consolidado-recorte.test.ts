import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { getConsolidated, listPeriodLabels } from "../consolidated";
import { resolveContext } from "../series";
import { listChanges } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O recorte De/Até na leitura da planilha.
 *
 * A aba Planilha respondia por *uma* vigência — a pedida, ou a mais recente —
 * enquanto a aba Impacto, ao lado, já mostrava as nove da série com um seletor
 * De/Até em cima. Este arquivo prova o que a Planilha passou a fazer quando o
 * mesmo seletor chegou nela, e a regra que sustenta o número.
 *
 * **A regra é a das duas pontas.** Uma transição entra no recorte quando as
 * duas vigências que ela compara caem dentro dele. A consequência que se mede
 * abaixo é a que importa: dois recortes vizinhos somam cada alteração **uma
 * vez**. Se a transição que atravessa a borda entrasse nos dois, a mesma
 * alteração apareceria em janeiro–fevereiro e de novo em fevereiro–março, e
 * ninguém que lesse as duas telas teria como notar.
 *
 * O fixture é o mesmo desenho de `consolidated.test.ts`, e a assimetria é de
 * propósito: carreta entrega os três meses, cavalo pula fevereiro. É ela que
 * separa "a vigência mais antiga do recorte" de "a vigência anterior desta
 * série" — duas coisas que coincidem quando todas as séries entregam sempre.
 */

let ctx: TestDb;
const SCOPE = "scope-recorte";

const CARRETA: AttributeSpec[] = [
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

const CAVALO: AttributeSpec[] = [
  {
    code: "cavalo.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    code: "cavalo.ipva",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const JAN = "2026-01-01";
const FEV = "2026-02-01";
const MAR = "2026-03-01";

beforeAll(async () => {
  ctx = await createTestDatabase("consolidado_recorte");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    CARRETA,
    [
      { label: "CAR_JAN", effectiveDate: JAN, data: { AAA1A11: { "carreta.custo_fixo": 1000 } } },
      { label: "CAR_FEV", effectiveDate: FEV, data: { AAA1A11: { "carreta.custo_fixo": 1300 } } },
      { label: "CAR_MAR", effectiveDate: MAR, data: { AAA1A11: { "carreta.custo_fixo": 1350 } } },
    ],
    { entityType: "CARRETA", scopeHash: SCOPE },
  );

  // Cavalos entregam janeiro e março — fevereiro nunca chegou.
  await buildFixture(
    ctx.db,
    CAVALO,
    [
      {
        label: "CAV_JAN",
        effectiveDate: JAN,
        data: { BBB2B22: { "cavalo.custo_fixo": 5000, "cavalo.ipva": 12000 } },
      },
      {
        label: "CAV_MAR",
        effectiveDate: MAR,
        data: { BBB2B22: { "cavalo.custo_fixo": 5500, "cavalo.ipva": 9000 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: SCOPE },
  );
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const recorte = (de?: string, ate?: string) =>
  getConsolidated(ctx.db, undefined, { janela: { de, ate } });

describe("o recorte é o intervalo inteiro, e não uma vigência dele", () => {
  it("cobre todas as vigências do intervalo e soma as transições de dentro", async () => {
    const view = (await recorte(JAN, MAR))!;

    expect(view.janela).toEqual({ de: JAN, ate: MAR });
    expect(view.periodos).toEqual([JAN, FEV, MAR]);

    // Três vigências, três comparações — e não três, nem duas por acaso:
    // carreta jan→fev, carreta fev→mar, cavalo jan→mar.
    expect(view.transicoes).toBe(3);
    expect(view.changeSetIds).toHaveLength(3);

    // carreta 1000→1300 (+300) e 1300→1350 (+50); cavalo 5000→5500 (+500)
    // e 12000→9000 (−3000, anual).
    expect(view.totals.valueChanges).toBe(4);
    expect(view.impactByPeriodicity).toEqual({ MENSAL: 850, ANUAL: -3000 });
  });

  it("a ponta de cima é a que a tela nomeia como período da leitura", async () => {
    const view = (await recorte(JAN, FEV))!;
    expect(view.period).toBe(FEV);
    expect(view.periodLabel).toBe("fevereiro/2026");
  });

  it("meia janela é um pedido legítimo, completado com o extremo da série", async () => {
    const daquiEmDiante = (await recorte(FEV, undefined))!;
    expect(daquiEmDiante.janela).toEqual({ de: FEV, ate: MAR });

    const ateAqui = (await recorte(undefined, FEV))!;
    expect(ateAqui.janela).toEqual({ de: JAN, ate: FEV });
  });
});

/**
 * A regra das duas pontas, medida pelo efeito que ela existe para evitar.
 *
 * Não basta afirmar que a transição da borda fica de fora: o que prova a regra
 * é que a soma de dois recortes vizinhos é igual à do recorte inteiro. Se a
 * comparação que atravessa a borda entrasse nos dois, esta conta estouraria —
 * e é exatamente o erro que ninguém notaria olhando uma tela de cada vez.
 */
describe("dois recortes vizinhos não contam a mesma alteração duas vezes", () => {
  it("a transição cuja ponta de baixo está fora pertence ao recorte anterior", async () => {
    const baixo = (await recorte(JAN, FEV))!;
    const cima = (await recorte(FEV, MAR))!;

    // jan→fev da carreta é do recorte de baixo; fev→mar é do de cima. A
    // comparação do cavalo (jan→mar) não cabe em nenhum dos dois: ela atravessa
    // os dois intervalos, e afirmá-la em qualquer um seria atribuir ao recorte
    // uma alteração que não aconteceu inteiramente dentro dele.
    expect(baixo.transicoes).toBe(1);
    expect(cima.transicoes).toBe(1);
    expect(baixo.impactByPeriodicity).toEqual({ MENSAL: 300 });
    expect(cima.impactByPeriodicity).toEqual({ MENSAL: 50 });

    // Nenhum change set aparece nos dois.
    const repetido = baixo.changeSetIds.filter((id) =>
      cima.changeSetIds.includes(id),
    );
    expect(repetido).toEqual([]);
  });

  it("a série sem par dentro do recorte diz por que, em vez de sumir", async () => {
    const view = (await recorte(FEV, MAR))!;

    const cavalo = view.present.filter((p) => p.entityTypeSet === "CAVALO");
    expect(cavalo).not.toHaveLength(0);
    expect(cavalo.every((p) => p.changeSetId === null)).toBe(true);
    expect(cavalo.some((p) => /fora do recorte/.test(p.reason ?? ""))).toBe(true);

    // E, por ter entregue no intervalo, o cavalo não é dado como ausente: a
    // leitura continua completa, com uma comparação a menos e o motivo escrito.
    expect(view.missing).toEqual([]);
    expect(view.complete).toBe(true);
  });

  it("a primeira vigência de uma série continua dizendo que não há anterior", async () => {
    const view = (await recorte(JAN, FEV))!;
    const emJaneiro = view.present.filter((p) => p.effectiveDate === JAN);
    expect(emJaneiro).not.toHaveLength(0);
    expect(
      emJaneiro.every((p) => /Primeira vigência/.test(p.reason ?? "")),
    ).toBe(true);
  });
});

/**
 * O recorte não muda o que já era verdade sem ele.
 *
 * A leitura de uma vigência é o caso de todo mundo que abre a tela pelo menu, e
 * o recorte não podia mudá-la por dentro ao ser acrescentado.
 */
describe("sem recorte, a leitura continua sendo a de uma vigência", () => {
  it("responde pela vigência pedida, comparada com a anterior de cada série", async () => {
    const view = (await getConsolidated(ctx.db, MAR))!;
    expect(view.janela).toBeNull();
    expect(view.periodos).toEqual([MAR]);
    expect(view.transicoes).toBe(2);
    // O cavalo compara com janeiro, que está fora de qualquer intervalo — e é a
    // resposta certa aqui, porque a pergunta é sobre a série, não sobre um
    // intervalo.
    expect(view.impactByPeriodicity).toEqual({ MENSAL: 550, ANUAL: -3000 });
  });

  it("a vigência pedida perde para o recorte quando os dois chegam juntos", async () => {
    // Pela tela isso não acontece — escolher um apaga o outro. Um endereço
    // colado à mão pode trazer os dois, e a precedência precisa estar escrita
    // em algum lugar que não seja a tela.
    const view = (await getConsolidated(ctx.db, MAR, {
      janela: { de: JAN, ate: FEV },
    }))!;
    expect(view.periodos).toEqual([JAN, FEV]);
    expect(view.period).toBe(FEV);
  });
});

describe("a lista de alterações é a do recorte inteiro", () => {
  it("junta as transições do intervalo numa lista só, sem repetir linha", async () => {
    const view = (await recorte(JAN, MAR))!;
    const { total, rows } = await listChanges(ctx.db, view.changeSetIds);

    expect(total).toBe(4);
    expect(rows).toHaveLength(4);

    // As duas alterações de custo fixo da carreta são a mesma célula em dois
    // meses: continuam sendo duas linhas, porque foram dois movimentos.
    const daCarreta = rows.filter((r) => r.attributeCode === "carreta.custo_fixo");
    expect(daCarreta.map((r) => r.impactAmount).sort((a, b) => Number(a) - Number(b)))
      .toEqual([50, 300]);
  });

  it("os filtros de linha continuam valendo dentro do recorte", async () => {
    const view = (await recorte(JAN, MAR))!;
    const { total } = await listChanges(ctx.db, view.changeSetIds, {
      entityType: "CAVALO",
    });
    expect(total).toBe(2);
  });
});

/**
 * Os rótulos do seletor.
 *
 * O seletor De/Até existe para sair do intervalo atual, então ele precisa
 * nomear as vigências que estão **fora** dele. Uma consulta que respeitasse o
 * recorte devolveria só as de dentro, e as outras opções apareceriam como datas
 * soltas ao lado de rótulos da fonte.
 */
describe("os nomes das vigências para o seletor", () => {
  it("nomeia todas as do contexto, inclusive as fora do recorte", async () => {
    const comRecorte = (await resolveContext(ctx.db, { janela: { de: MAR, ate: MAR } }))!;
    const rotulos = await listPeriodLabels(ctx.db, comRecorte);

    expect(Object.keys(rotulos).sort()).toEqual([JAN, FEV, MAR]);
  });

  it("a resposta traz os mesmos rótulos que o seletor vai mostrar", async () => {
    const view = (await recorte(FEV, MAR))!;
    expect(Object.keys(view.rotulos).sort()).toEqual([JAN, FEV, MAR]);
    // Uma data com duas séries tem dois rótulos possíveis; a escolha é
    // determinística para que a legenda não mude de render em render.
    expect(view.rotulos[FEV]).toBe("CAR_FEV");
    expect(await listPeriodLabels(ctx.db, view.context)).toEqual(view.rotulos);
  });
});
