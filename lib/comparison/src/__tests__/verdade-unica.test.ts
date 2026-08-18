import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { changeSetTable } from "@workspace/db";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { getGroupedView } from "../grouped";
import { getFamiliesView } from "../families-view";
import { getConsolidated } from "../consolidated";
import { listChanges, totaisDoEscopo, getChangeSetBreakdown } from "../query";
import { impactoApurado } from "../impacto-apurado";
import { computeChangeSet } from "../engine";

/**
 * Uma verdade financeira só.
 *
 * Este arquivo é o contrato que faltava. O produto respondia "qual foi o
 * impacto líquido das alterações?" com números diferentes conforme a porta de
 * entrada — R$ 39.936,28 na aba Planilha, R$ 28.511,24 na Visão geral — e cada
 * leitura tinha o seu próprio teste, verde, medindo a sua própria divergência.
 * Nenhum deles comparava duas portas entre si, e é exatamente isso que se faz
 * aqui.
 */

const AGOSTO = "2026-08-01";
/**
 * O oficial de agosto/2026, deduplicado por composição **e** por conjunto.
 *
 * Era 16.594,55 até 18/08/2026, quando `carreta.lucro_fixomodelo_novo_ciclo`
 * passou a escopo de conjunto: ela é a soma da parcela da carreta com a do
 * cavalo (284 de 284 pares), e os R$ 4.677,85 que saíram são o lucro fixo de um
 * cavalo que já estava contado na linha dele.
 */
const OFICIAL = 11916.7;
/** O bruto, antes de qualquer regra. Só auditoria técnica o pode citar. */
const BRUTO = 39936.28;

let ctx: TestDb;

/** Os `change_set` da vigência — a mesma lista que a rota de Alterações usa. */
async function idsDeAgosto(): Promise<string[]> {
  return (await getConsolidated(ctx.db, AGOSTO))!.changeSetIds;
}

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("verdade_unica");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("todo caminho responde o mesmo número", () => {
  it("Visão geral, Alterações e o consolidado chegam em R$ 11.916,70/mês", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const familias = (await getFamiliesView(ctx.db, AGOSTO))!;
    const ids = await idsDeAgosto();
    const totais = await totaisDoEscopo(ctx.db, ids);
    const apurado = await impactoApurado(ctx.db, ids);
    const consolidado = (await getConsolidated(ctx.db, AGOSTO))!;

    expect(view.impact.byPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
    expect(familias.impact.byPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
    expect(totais.impactByPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
    expect(apurado.byPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
    expect(consolidado.impactByPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
  });

  it("o change_set grava o oficial, e o bruto fica identificado como bruto", async () => {
    const ids = await idsDeAgosto();
    const sets = await ctx.db
      .select()
      .from(changeSetTable)
      .where(eq(changeSetTable.id, ids[0]));

    // A soma das séries da vigência — cada `change_set` é uma delas.
    let oficial = 0;
    let bruto = 0;
    for (const id of ids) {
      const [s] = await ctx.db.select().from(changeSetTable).where(eq(changeSetTable.id, id));
      oficial += s.impactoOficialByPeriodicity.MENSAL ?? 0;
      bruto += s.impactoBrutoByPeriodicity.MENSAL ?? 0;
    }
    expect(oficial).toBeCloseTo(OFICIAL, 2);
    expect(bruto).toBeCloseTo(BRUTO, 2);
    expect(sets[0].deducaoRastro).toHaveProperty("degraus");
  });

  it("o bruto nunca é o oficial — se um dia forem iguais, a regra parou de rodar", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    expect(view.impact.brutoByPeriodicity.MENSAL).toBeCloseTo(BRUTO, 2);
    expect(view.impact.brutoByPeriodicity.MENSAL).not.toBeCloseTo(
      view.impact.byPeriodicity.MENSAL,
      2,
    );
  });

  it("recalcular não muda o número — a dedução é idempotente", async () => {
    const ids = await idsDeAgosto();
    const [set] = await ctx.db
      .select()
      .from(changeSetTable)
      .where(eq(changeSetTable.id, ids[0]));
    const antes = { ...set.impactoOficialByPeriodicity };
    const refeito = await computeChangeSet(ctx.db, set.snapshotAId, set.snapshotBId, {
      force: true,
    });
    expect(refeito.impacto.oficial).toEqual(antes);
  });
});

describe("cabeçalho e lista respondem pela mesma população", () => {
  it("com impactConfidence=CALCULATED, os totais seguem o filtro da lista", async () => {
    const ids = await idsDeAgosto();
    const filtros = { impactConfidence: "CALCULATED" as const };

    const lista = await listChanges(ctx.db, ids, filtros);
    const totais = await totaisDoEscopo(ctx.db, ids, {}, filtros);

    // As 19 com preço, e não as 267 da vigência.
    expect(lista.total).toBe(19);
    expect(totais.valueChanges).toBe(19);
    expect(totais.impactNotCalculable).toBe(0);
    // E o dinheiro continua sendo o oficial: filtrar não desliga a dedução.
    expect(totais.impactByPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
  });

  it("sem filtro, cabeçalho e lista voltam a ser a vigência inteira", async () => {
    const ids = await idsDeAgosto();
    const lista = await listChanges(ctx.db, ids, {});
    const totais = await totaisDoEscopo(ctx.db, ids);
    expect(lista.total).toBe(267);
    expect(totais.valueChanges).toBe(267);
    expect(totais.impactByPeriodicity.MENSAL).toBeCloseTo(OFICIAL, 2);
  });

  it("um recorte nunca mostra mais dinheiro do que a frota inteira", async () => {
    const ids = await idsDeAgosto();
    const inteira = await totaisDoEscopo(ctx.db, ids);
    for (const entityType of ["CAVALO", "CARRETA"]) {
      const recorte = await totaisDoEscopo(ctx.db, ids, { entityType });
      expect(
        Math.abs(recorte.impactByPeriodicity.MENSAL ?? 0),
        entityType,
      ).toBeLessThanOrEqual(Math.abs(inteira.impactByPeriodicity.MENSAL) + 0.01);
    }
  });

  it("o painel por atributo não destaca o que a soma já descartou", async () => {
    const breakdown = await getChangeSetBreakdown(ctx.db, await idsDeAgosto());
    const porCodigo = new Map(
      breakdown.byAttribute.map((a) => [a.attributeCode, a.impact ?? []]),
    );
    /*
      `carreta.custo_fixo` abria "Impactos relevantes" com +R$ 16.595/mês —
      o maior número da tela, e inteiro dupla contagem. `carreta.finame`
      aparecia logo abaixo com o finame do cavalo somado de novo.
    */
    expect(porCodigo.get("carreta.custo_fixo")).toEqual([]);
    expect(porCodigo.get("carreta.finame")).toEqual([]);
    // As parcelas do cavalo continuam lá, com o dinheiro delas.
    const amortizacao = porCodigo.get("cavalo.amortizacao_cavalo")!;
    expect(amortizacao[0].amount).toBeCloseTo(-7700.16, 2);
  });

  it("a soma dos atributos do painel reproduz o total do cartão", async () => {
    const breakdown = await getChangeSetBreakdown(ctx.db, await idsDeAgosto());
    const soma = breakdown.byAttribute
      .flatMap((a) => a.impact ?? [])
      .filter((i) => i.periodicity === "MENSAL")
      .reduce((total, i) => total + i.amount, 0);
    expect(soma).toBeCloseTo(OFICIAL, 2);
  });
});
