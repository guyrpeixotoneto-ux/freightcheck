import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { changeSetTable, changeTable } from "@workspace/db";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { getGroupedView } from "../grouped";
import { getFamiliesView } from "../families-view";
import { getConsolidated } from "../consolidated";
import { listChanges, totaisDoEscopo, getChangeSetBreakdown } from "../query";
import { impactoApurado } from "../impacto-apurado";
import { computeChangeSet } from "../engine";
import { criarDeduplicador, daLinhaDoBanco } from "../deduplicacao";
import { carregarVinculosDeConjunto, snapshotsDosChangeSets } from "../vinculos";
import { compositionOf, escopoDeConjunto } from "../composition";

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
/** O oficial de agosto/2026, deduplicado por composição **e** por conjunto. */
const OFICIAL = 16594.55;
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
  it("Visão geral, Alterações e o consolidado chegam em R$ 16.594,55/mês", async () => {
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

/**
 * A ordem dos degraus não pode mover o total.
 *
 * `foraDoTotal` testa composição primeiro e conjunto depois, e por muito tempo
 * este módulo afirmou que a ordem era indiferente "porque nenhum código está
 * nos dois conjuntos". A segunda metade era falsa: `carreta.custo_fixo` é total
 * em `COMPOSITIONS` **e** coluna de conjunto em `ESCOPOS_DE_CONJUNTO`, e em
 * agosto/2026 cinco linhas satisfazem as duas regras.
 *
 * A conclusão sobrevive, e é ela que estas provas prendem — porque uma
 * afirmação sem teste é o que fez este produto ter seis respostas para a mesma
 * pergunta. Quem inverter a ordem dos degraus amanhã é pego aqui.
 */
describe("a ordem dos degraus não move o dinheiro", () => {
  /** As linhas com preço de agosto, com as duas regras avaliadas em separado. */
  async function linhasComAsDuasRegras() {
    const ids = await idsDeAgosto();
    const { rows } = await ctx.db.execute<{
      change_set_id: string;
      entity_id: string | null;
      attribute_code: string | null;
      impact_confidence: string | null;
      impact_amount: string | null;
      impact_periodicity: string | null;
    }>(sql`
      SELECT change_set_id::text AS change_set_id, entity_id::text AS entity_id,
             attribute_code, impact_confidence,
             impact_amount::text AS impact_amount, impact_periodicity
        FROM "change"
       WHERE ${inArray(changeTable.changeSetId, ids)}
    `);

    const vinculos = await carregarVinculosDeConjunto(
      ctx.db,
      await snapshotsDosChangeSets(ctx.db, ids),
    );
    const dedup = criarDeduplicador(rows.map(daLinhaDoBanco), vinculos);

    /*
      O índice é reconstruído aqui de propósito: um oráculo que chamasse o
      próprio deduplicador não provaria nada sobre ele. O que estas provas
      comparam é a decisão publicada contra as duas regras avaliadas à parte.
    */
    const chave = (cs: string, ent: string) => `${cs}::${ent}`;
    const mudou = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.entity_id || !r.attribute_code) continue;
      const k = chave(r.change_set_id, r.entity_id);
      let s = mudou.get(k);
      if (!s) mudou.set(k, (s = new Set()));
      s.add(r.attribute_code);
    }

    const porComposicao = (r: (typeof rows)[number]) => {
      const c = compositionOf(r.attribute_code);
      if (!c || !r.entity_id) return false;
      const mudaram = mudou.get(chave(r.change_set_id, r.entity_id)) ?? new Set<string>();
      return c.parts.some((parte) => mudaram.has(parte));
    };
    const porConjunto = (r: (typeof rows)[number]) => {
      const e = escopoDeConjunto(r.attribute_code);
      if (!e || !r.entity_id) return false;
      return (vinculos.embutidos.get(r.entity_id) ?? []).some((id) =>
        mudou.get(chave(r.change_set_id, id))?.has(e.contem),
      );
    };

    const comPreco = rows.filter(
      (r) => r.impact_confidence === "CALCULATED" && r.impact_amount !== null,
    );
    return comPreco.map((r) => ({
      code: r.attribute_code,
      valor: Number(r.impact_amount),
      A: porComposicao(r),
      B: porConjunto(r),
      publicada: dedup.foraDoTotal(daLinhaDoBanco(r)),
    }));
  }

  it("a decisão publicada é exatamente a união das duas regras", async () => {
    /*
      É esta a prova de invariância, e ela é estrutural em vez de aritmética:
      se "sai da soma" equivale a "A ou B", então trocar a ordem em que A e B
      são testadas não pode mudar **quem** sai — só o rótulo de quem saiu.
    */
    for (const l of await linhasComAsDuasRegras()) {
      expect(l.publicada !== null, `${l.code} ${l.valor}`).toBe(l.A || l.B);
    }
  });

  it("cinco linhas satisfazem as duas regras, e são carreta.custo_fixo", async () => {
    // A sobreposição é real e declarada: `carreta.custo_fixo` está nos dois
    // registros. Se algum dia deixar de estar, esta prova avisa.
    const ambas = (await linhasComAsDuasRegras()).filter((l) => l.A && l.B);
    expect(ambas).toHaveLength(5);
    expect([...new Set(ambas.map((l) => l.code))]).toEqual(["carreta.custo_fixo"]);
    // Elas caem em composição só porque ela é testada primeiro.
    expect(ambas.every((l) => l.publicada?.motivo === "COBERTO_POR_PARCELAS")).toBe(true);
  });

  it("as duas ordens chegam no mesmo oficial, e os degraus não", async () => {
    const linhas = await linhasComAsDuasRegras();
    const soma = (f: (l: (typeof linhas)[number]) => boolean) =>
      Number(linhas.filter(f).reduce((s, l) => s + l.valor, 0).toFixed(2));

    const bruto = soma(() => true);
    // Composição primeiro: o ambíguo conta como composição.
    const oficialA = Number((bruto - soma((l) => l.A) - soma((l) => !l.A && l.B)).toFixed(2));
    // Conjunto primeiro: o ambíguo conta como conjunto.
    const oficialB = Number((bruto - soma((l) => l.B) - soma((l) => !l.B && l.A)).toFixed(2));

    expect(bruto).toBeCloseTo(BRUTO, 2);
    expect(oficialA).toBeCloseTo(OFICIAL, 2);
    expect(oficialB).toBeCloseTo(OFICIAL, 2);

    // E o que **muda** com a ordem: o primeiro degrau, e portanto o subtotal.
    expect(soma((l) => l.A)).toBeCloseTo(11425.04, 2);
    expect(soma((l) => l.B)).toBeCloseTo(28511.23, 2);
  });

  it("as exclusões são uma partição: nada sai duas vezes, nada some", async () => {
    const linhas = await linhasComAsDuasRegras();
    const fora = linhas.filter((l) => l.publicada !== null);
    const dentro = linhas.filter((l) => l.publicada === null);

    expect(fora.length + dentro.length).toBe(linhas.length);
    expect(linhas).toHaveLength(19);
    expect(fora.filter((l) => l.publicada!.motivo === "COBERTO_POR_PARCELAS")).toHaveLength(6);
    expect(fora.filter((l) => l.publicada!.motivo === "ESCOPO_DE_CONJUNTO")).toHaveLength(5);
    expect(dentro).toHaveLength(8);

    const somar = (ls: typeof linhas) => Number(ls.reduce((s, l) => s + l.valor, 0).toFixed(2));
    expect(somar(dentro)).toBeCloseTo(OFICIAL, 2);
    expect(somar(fora) + somar(dentro)).toBeCloseTo(BRUTO, 2);
  });
});
