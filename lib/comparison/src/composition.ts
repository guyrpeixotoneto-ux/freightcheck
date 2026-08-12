/**
 * Composição — quais atributos são o **total** de outros.
 *
 * O problema que este módulo resolve: `assessImpact` avalia cada alteração
 * isoladamente e não tem como saber que `carreta.custo_fixo` é a soma de
 * `carreta.finame` com `carreta.lucro_fixomodelo_novo_ciclo`. Quando o total e
 * as suas parcelas mudam no mesmo ativo, os três entram no acumulado e o mesmo
 * dinheiro é contado duas vezes. Em Ago/2026 isso inflava o número em destaque
 * do produto.
 *
 * A saída **não** é excluir atributos. Um total é um valor legítimo, e em outro
 * contexto — uma vigência em que só ele mudou — ele é a única informação
 * disponível. O que se exclui é a *linha*, no ativo e na comparação em que as
 * suas parcelas já explicam a variação. A alteração continua na lista, continua
 * rastreável até a célula, e o cartão diz por que ela está fora da soma.
 *
 * Como o registro é mantido: igual a `CONFIRMED_SEMANTICS` em
 * `@workspace/curation` — em código, com a evidência que sustenta cada linha,
 * revisável num pull request. Uma relação só entra aqui depois de medida contra
 * as vigências reais, e a medição fica escrita junto.
 */

/** Uma identidade "total = soma das parcelas", medida antes de ser declarada. */
export interface Composition {
  /** O atributo que é o total. */
  total: string;
  /** Os atributos que o compõem. */
  parts: string[];
  /**
   * A medição que sustenta a relação, com números. Sem isto a entrada é um
   * palpite com aparência de regra.
   */
  evidence: string;
}

/**
 * As três composições medidas nas 18 vigências de `attached_assets`.
 *
 * Método, idêntico para as três: pivotar `fact` por (vigência, ativo), testar a
 * identidade em NUMERIC exato — nunca em ponto flutuante, que produz diferenças
 * de 1e-14 e transforma acerto em falha — e separar "fecha exatamente" de
 * "fecha a menos de um centavo" de "não fecha".
 */
export const COMPOSITIONS: Composition[] = [
  {
    total: "carreta.custo_fixo",
    parts: ["carreta.finame", "carreta.lucro_fixomodelo_novo_ciclo"],
    evidence:
      "Medido em 12/08/2026 sobre as 9 vigências de carreta: 657 de 657 linhas " +
      "(vigência × ativo) fecham — 598 exatamente, 46 com diferença de até R$ 0,01 " +
      "(arredondamento), 0 falhas. Considerando só as 644 linhas em que o total " +
      "não é zero: 598 exatas e 46 por arredondamento.",
  },
  {
    total: "carreta.finame_implemento",
    parts: [
      "carreta.amortizacao_implemento",
      "carreta.juros_finame_implemento",
      "carreta.custo_aluguel",
    ],
    evidence:
      "Medido em 12/08/2026: 651 de 651 linhas fecham — 628 exatamente, 23 por " +
      "arredondamento, 0 falhas. Sem `custo_aluguel` a identidade falha em 18 " +
      "linhas, todas das placas CUL0J25 e FCW7D86 nas 9 vigências: são implementos " +
      "alugados, sem financiamento, em que o custo inteiro está no aluguel. " +
      "A terceira parcela não foi acrescentada para fazer a conta fechar — ela " +
      "explica exatamente as 18 exceções, e zera a diferença nas 18.",
  },
  {
    total: "cavalo.finame_cavalo",
    parts: [
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ],
    evidence:
      "Medido em 12/08/2026: das 533 linhas em que o total não é zero, 532 fecham " +
      "(377 exatamente, 155 por arredondamento) e 1 não fecha — placa QYP0I48 em " +
      "abr/2026, diferença de R$ 5,85. A hipótese de que o total seria apenas " +
      "amortização + juros foi testada e **rejeitada**: falha em 30 linhas. " +
      "`finame_cavalo` não é a parcela de financiamento do cavalo; é o custo fixo " +
      "dele, e quando o financiamento se encerra o valor migra para o lucro fixo " +
      "do novo ciclo, dentro do mesmo total.",
  },
];

/** Índice `total -> parcelas`, para consulta em O(1). */
const PARTS_BY_TOTAL = new Map<string, Set<string>>(
  COMPOSITIONS.map((c) => [c.total, new Set(c.parts)]),
);

const EVIDENCE_BY_TOTAL = new Map<string, Composition>(
  COMPOSITIONS.map((c) => [c.total, c]),
);

/** Se este atributo é o total de alguma composição declarada. */
export function isTotalAttribute(attributeCode: string | null): boolean {
  return attributeCode !== null && PARTS_BY_TOTAL.has(attributeCode);
}

export function compositionOf(attributeCode: string | null): Composition | null {
  return attributeCode === null ? null : (EVIDENCE_BY_TOTAL.get(attributeCode) ?? null);
}

/**
 * Se a variação de um total já está explicada pelas suas parcelas **neste
 * ativo, nesta comparação**.
 *
 * A decisão é por ativo, e não por atributo ou por vigência, porque o dado real
 * exige: em Ago/2026, `cavalo.finame_cavalo` mudou em cinco cavalos, e só em um
 * deles alguma parcela mudou junto. Excluir o atributo inteiro apagaria
 * R$ 17.086,20 de variação que nenhuma parcela explica; não excluir nada
 * contaria R$ 5.169,50 duas vezes. A regra por ativo acerta os dois casos.
 */
export function isCoveredByParts(
  attributeCode: string | null,
  entityId: string | null,
  changedPartsByEntity: Map<string, Set<string>>,
): boolean {
  if (attributeCode === null || entityId === null) return false;
  const parts = PARTS_BY_TOTAL.get(attributeCode);
  if (!parts) return false;
  const changed = changedPartsByEntity.get(entityId);
  if (!changed) return false;
  for (const part of parts) if (changed.has(part)) return true;
  return false;
}

/**
 * Índice "que atributos mudaram em cada ativo", que é o insumo de
 * {@link isCoveredByParts}. Recebe as linhas cruas da comparação.
 */
export function indexChangedAttributesByEntity(
  rows: { entityId: string | null; attributeCode: string | null }[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.entityId === null || row.attributeCode === null) continue;
    let set = index.get(row.entityId);
    if (!set) index.set(row.entityId, (set = new Set()));
    set.add(row.attributeCode);
  }
  return index;
}
