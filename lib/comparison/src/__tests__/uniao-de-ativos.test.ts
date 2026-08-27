import { describe, expect, it } from "vitest";
import { buildGroup, chaveDaFrota, type ChangeGroup } from "../grouped";
import type { Deduplicador } from "../deduplicacao";

/**
 * `vehicles` conta, `entityIds` identifica — e é a identidade que soma.
 *
 * O Dashboard publicava "42 veículos impactados" somando `grupo.vehicles` das
 * oito linhas visíveis, ao lado de "91 veículos afetados" contados como ativos
 * distintos na faixa do topo. Os dois diziam "veículos" e mediam coisas
 * diferentes: 42 não era um subconjunto de 91 — era o mesmo caminhão contado
 * uma vez por atributo que mudou nele, e a soma podia passar a frota inteira.
 *
 * A união só é possível porque o grupo passou a carregar **quais** ativos. Este
 * teste prende as duas metades do contrato: `entityIds.length === vehicles`
 * dentro de um grupo, e a união entre grupos é menor que a soma sempre que
 * houver um ativo em comum.
 */

/** `buildGroup` só chama `foraDoTotal`; nada aqui exercita a régua de parcelas. */
const semDeduplicacao: Deduplicador = { foraDoTotal: () => null };

let proximoId = 1;

function linha(entityId: string | null, attributeCode: string) {
  return {
    id: proximoId++,
    change_set_id: "cs-1",
    category: "SOURCE_CHANGE",
    change_type: "VALUE_CHANGED",
    nature: "NUMERIC",
    entity_id: entityId,
    entity_label: entityId,
    entity_type: "CAVALO",
    attribute_code: attributeCode,
    attribute_source_name: attributeCode,
    attribute_display_name: attributeCode,
    value_before: "1",
    value_after: "2",
    numeric_before: "1",
    numeric_after: "2",
    delta_percent: "100",
    comparability: "COMPARABLE",
    inconclusive_reason: null,
    impact_confidence: "NOT_CALCULABLE",
    impact_amount: null,
    impact_periodicity: null,
    impact_reason: null,
    cost_class: null,
    taxonomy_name: null,
    semantics_status: "CONFIRMED",
    aggregation: null,
    is_monetary: null,
    unit: null,
  };
}

const frotaDaSerie = new Map([[chaveDaFrota("cs-1", "CAVALO"), 62]]);

const grupo = (attributeCode: string, ativos: (string | null)[]): ChangeGroup =>
  buildGroup(
    ativos.map((a) => linha(a, attributeCode)) as never,
    frotaDaSerie,
    semDeduplicacao,
  );

const uniao = (grupos: ChangeGroup[]) => new Set(grupos.flatMap((g) => g.entityIds)).size;
const soma = (grupos: ChangeGroup[]) => grupos.reduce((s, g) => s + g.vehicles, 0);

describe("entityIds é a identidade por trás de vehicles", () => {
  it("um grupo publica exatamente os ativos que contou", () => {
    const g = grupo("cavalo.amortizacao", ["v1", "v2", "v2", "v3"]);

    expect(g.vehicles).toBe(3);
    expect(g.entityIds).toHaveLength(g.vehicles);
    expect([...g.entityIds].sort()).toEqual(["v1", "v2", "v3"]);
  });

  it("linha sem entidade não vira ativo fantasma nem some da contagem", () => {
    const g = grupo("cavalo.amortizacao", [null, null, "v1"]);

    // Mesma régua de `vehicles`: o id da linha substitui a entidade ausente, e
    // as duas linhas sem ativo continuam sendo duas coisas distintas.
    expect(g.entityIds).toHaveLength(g.vehicles);
    expect(g.entityIds).toContain("v1");
    expect(new Set(g.entityIds).size).toBe(g.entityIds.length);
  });

  it("a união é menor que a soma quando o mesmo caminhão mudou em dois atributos", () => {
    const grupos = [
      grupo("cavalo.amortizacao", ["v1", "v2", "v3"]),
      grupo("cavalo.financiamento", ["v2", "v3", "v4"]),
    ];

    expect(soma(grupos)).toBe(6); // o que a tela publicava
    expect(uniao(grupos)).toBe(4); // os caminhões que existem
    expect(uniao(grupos)).toBeLessThan(soma(grupos));
  });

  it("a soma pode passar a frota; a união nunca", () => {
    const frota = ["v1", "v2", "v3"];
    const grupos = Array.from({ length: 5 }, (_, i) => grupo(`cavalo.attr${i}`, frota));

    expect(soma(grupos)).toBe(15);
    expect(uniao(grupos)).toBe(3);
    expect(uniao(grupos)).toBeLessThanOrEqual(frota.length);
  });

  it("sem ativo em comum, união e soma coincidem — e é o único caso em que coincidem", () => {
    const grupos = [
      grupo("cavalo.amortizacao", ["v1", "v2"]),
      grupo("cavalo.financiamento", ["v3", "v4"]),
    ];

    expect(uniao(grupos)).toBe(soma(grupos));
  });
});
