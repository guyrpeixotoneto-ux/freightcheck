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

/**
 * Um atributo que aparece na linha de um equipamento e remunera o **conjunto**.
 *
 * Mora aqui, ao lado de `COMPOSITIONS`, porque é a mesma pergunta vista de fora:
 * uma composição diz "este total já contém aquelas parcelas"; um escopo de
 * conjunto diz "este total já contém o *outro equipamento*". As duas existem
 * para a mesma finalidade — impedir que o mesmo real seja contado duas vezes —
 * e separá-las em pacotes diferentes fazia com que só quem passasse por
 * `@workspace/composition` enxergasse a segunda.
 *
 * `@workspace/composition` continua sendo quem aplica a regra na composição da
 * remuneração; ele importa esta lista em vez de manter uma cópia, pela mesma
 * razão que já importa `COMPOSITIONS`.
 */
export interface EscopoDeConjunto {
  code: string;
  /** O equipamento em cuja linha a coluna aparece. */
  entityType: string;
  /** O código do equipamento cujo valor está embutido neste total. */
  contem: string;
  /** A medição que sustenta a exclusão. Sem ela, isto seria um palpite. */
  evidence: string;
}

/**
 * As colunas da carreta que carregam o cavalo junto.
 *
 * Todas medidas cruzando cada carreta com o cavalo que a aponta em
 * `cavalo.placa_carreta`, nas 9 vigências do export real.
 */
export const ESCOPOS_DE_CONJUNTO: EscopoDeConjunto[] = [
  {
    code: "carreta.finame",
    entityType: "CARRETA",
    contem: "cavalo.finame_cavalo",
    evidence:
      "Medido em 14/08/2026: finame − finameImplemento é igual ao finameCavalo do cavalo " +
      "vinculado em 558 de 558 linhas (tolerância R$ 0,01, zero exceções). Nas 99 linhas de " +
      "carreta sem cavalo vinculado a diferença é exatamente zero, que é o que se espera " +
      "quando não há cavalo para somar. A coluna carrega o financiamento do cavalo somado " +
      "ao do implemento — é do conjunto, e somá-la aqui contaria o cavalo duas vezes.",
  },
  {
    code: "carreta.custo_fixo",
    entityType: "CARRETA",
    contem: "cavalo.finame_cavalo",
    evidence:
      "custoFixo = finame + lucroFixomodeloNovoCiclo em 657 de 657 linhas, e finame contém o " +
      "cavalo. Logo custoFixo é o custo fixo do conjunto cavalo + carreta — o número certo " +
      "para a visão de CONJUNTO e o número errado para a linha de uma carreta.",
  },
  {
    /*
      Achado em 16/08/2026, pela busca exaustiva de identidades que reproduziu
      as duas relações acima sem as conhecer. É a terceira coluna de conjunto, e
      a única que ainda não estava registrada.

      A ressalva é real e fica escrita: nas 99 linhas de carreta sem cavalo
      vinculado o resto **não** é zero — ao contrário do `finame`, onde é zero
      nas 99. Ou seja, uma carreta sem cavalo neste export ainda tem lucro
      variável previsto acima do que a parcela dela explica. Isso não enfraquece
      a identidade onde ela é verificável (558 de 558), mas impede afirmar que a
      decomposição é exaustiva — e é por isso que a frase está aqui em vez de um
      arredondamento para "fecha sempre".
    */
    code: "carreta.lucro_variavel_previsto",
    entityType: "CARRETA",
    contem: "cavalo.lucro_variavel_previsto_cavalo",
    evidence:
      "Medido em 16/08/2026: lucroVariavelPrevisto − lucroVariavelPrevistoCarreta é igual ao " +
      "lucroVariavelPrevistoCavalo do cavalo vinculado em 558 de 558 linhas (tolerância " +
      "R$ 0,01, zero exceções). A coluna é do conjunto: o lucro variável do cavalo já está " +
      "dentro dela, e somá-la à frota de cavalos contaria cada cavalo duas vezes. Ressalva: " +
      "nas 99 linhas sem cavalo vinculado o resto não é zero, então a decomposição é " +
      "comprovada onde há par, e não exaustiva.",
  },
  {
    /*
      Achado em 18/08/2026, e ele **corrige uma leitura anterior deste
      repositório**. O comentário de `regras.ts` afirmava que
      `lucroFixomodeloNovoCiclo` da carreta *não* era o lucro fixo do cavalo,
      apoiado numa contagem de coincidência de valor: 233 linhas iguais à
      parcela da carreta e apenas 15 iguais à do cavalo. Os números estavam
      certos e a conclusão estava errada. A pergunta que faltou fazer não era
      "de qual das duas ela copia o valor?", e sim "ela é a **soma** das duas?".

      É. E o que prova é justamente o terço que a contagem antiga não olhava:
      as 36 linhas em que as duas parcelas são não nulas **ao mesmo tempo**.
      Numa cópia elas seriam as exceções; numa soma são a confirmação, e a
      identidade fecha em todas.
    */
    code: "carreta.lucro_fixomodelo_novo_ciclo",
    entityType: "CARRETA",
    contem: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    evidence:
      "Medido em 18/08/2026 sobre as 9 vigências do export real: " +
      "lucroFixomodeloNovoCiclo = lucroFixomodeloNovoCicloCarreta + " +
      "lucroFixomodeloNovoCicloCavalo em 284 de 284 pares em que a coluna não é zero " +
      "(tolerância R$ 0,01, zero exceções). Em 36 desses pares as duas parcelas são não " +
      "nulas ao mesmo tempo, o que descarta a leitura de que a coluna fosse cópia de uma " +
      "delas; em 233 só a carreta tem valor e em 15 só o cavalo. A coluna é do conjunto, e " +
      "somá-la na linha da carreta contava o lucro fixo do cavalo duas vezes — R$ 34.793,84 " +
      "por mês em agosto/2026, 11,5% do total da frota de carretas.",
  },
];

const ESCOPO_POR_CODIGO = new Map(ESCOPOS_DE_CONJUNTO.map((e) => [e.code, e]));

/** Se este atributo já embute o valor do outro equipamento do conjunto. */
export function escopoDeConjunto(
  attributeCode: string | null,
): EscopoDeConjunto | null {
  return attributeCode === null
    ? null
    : (ESCOPO_POR_CODIGO.get(attributeCode) ?? null);
}

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
