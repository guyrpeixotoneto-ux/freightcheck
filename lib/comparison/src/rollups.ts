import { changeClassOf, type ChangeClass } from "./classify";
import { indexChangedAttributesByEntity, isCoveredByParts } from "./composition";
import { placementOf } from "./families";
import { attributeLabel, equipmentLabel } from "./labels";
import { summariseImpact, type ImpactSummary, type RawChange } from "./grouped";

/**
 * As agregações que as duas leituras compartilham.
 *
 * MOVIMENTOS e PONTA A PONTA respondem perguntas diferentes e por isso somam
 * conjuntos de linhas diferentes — mas **somam do mesmo jeito**. As contas que
 * este módulo faz (o resumo executivo, o rol por ativo, o rol por parâmetro)
 * são idênticas nas duas, e escrevê-las duas vezes é como se produzem duas
 * telas que discordam sobre o mesmo dado sem que ninguém saiba qual acreditar.
 *
 * Um motor de comparação, um conjunto de agregações, duas seleções de linhas.
 */

/* ------------------------------------------------------------------ */
/* Resumo executivo                                                    */
/* ------------------------------------------------------------------ */

export interface ExecutiveDigest {
  /** Ativos distintos com pelo menos uma alteração. */
  entitiesChanged: number;
  /** Linhas de alteração — "campos modificados". */
  fieldsChanged: number;
  /** Colunas distintas que se mexeram. */
  attributesChanged: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  /**
   * O dinheiro, sempre por periodicidade e sempre em três números.
   *
   * `increases` e `decreases` são o bruto de cada lado; `net` é a soma dos dois
   * **dentro de cada balde**. O líquido existe porque o gestor pede por ele, e
   * vem obrigatoriamente acompanhado de `withoutCalculatedImpact`: um líquido
   * calculado sobre metade das alterações é meia verdade, e a outra metade tem
   * de estar escrita ao lado dele.
   */
  increasesByPeriodicity: Record<string, number>;
  decreasesByPeriodicity: Record<string, number>;
  netByPeriodicity: Record<string, number>;
  /** Alterações que existem e cujo valor não é apurável. Nunca zero disfarçado. */
  withoutCalculatedImpact: number;
  /** Quantas alterações caem em cada classe — ver `classify.ts`. */
  byClass: Record<ChangeClass, number>;
}

const CLASSES_VAZIAS = (): Record<ChangeClass, number> => ({
  CUSTO_AUMENTOU: 0,
  CUSTO_REDUZIU: 0,
  RECEITA_AUMENTOU: 0,
  RECEITA_REDUZIU: 0,
  OPERACIONAL: 0,
  CADASTRAL: 0,
  SEM_IMPACTO_APURADO: 0,
  EQUIPAMENTO_NOVO: 0,
  EQUIPAMENTO_REMOVIDO: 0,
});

const arredondar = (v: number) => Number(v.toFixed(2));

export function executiveDigest(
  rows: RawChange[],
  changedByEntity: Map<string, Set<string>>,
  fleet: { added: number; removed: number },
): ExecutiveDigest {
  const increases: Record<string, number> = {};
  const decreases: Record<string, number> = {};
  const byClass = CLASSES_VAZIAS();
  const ativos = new Set<string>();
  const colunas = new Set<string>();
  let semImpacto = 0;

  for (const row of rows) {
    byClass[changeClassOf(row)]++;
    if (row.entity_id) ativos.add(row.entity_id);
    if (row.attribute_code) colunas.add(row.attribute_code);

    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) {
      semImpacto++;
      continue;
    }
    /*
      A dupla contagem sai daqui como sai de todo total do produto: um titular
      cuja parcela também mudou naquele ativo não entra na soma. Sem isto, o
      resumo executivo — que é o número que vai para a reunião — seria o único
      lugar do produto onde o mesmo dinheiro conta duas vezes.
    */
    if (isCoveredByParts(row.attribute_code, row.entity_id, changedByEntity)) continue;

    const balde = row.impact_periodicity ?? "SEM_PERIODICIDADE";
    const valor = Number(row.impact_amount);
    if (valor > 0) increases[balde] = (increases[balde] ?? 0) + valor;
    else if (valor < 0) decreases[balde] = (decreases[balde] ?? 0) + valor;
  }

  const net: Record<string, number> = {};
  for (const balde of new Set([...Object.keys(increases), ...Object.keys(decreases)])) {
    net[balde] = arredondar((increases[balde] ?? 0) + (decreases[balde] ?? 0));
  }

  return {
    entitiesChanged: ativos.size,
    fieldsChanged: rows.length,
    attributesChanged: colunas.size,
    entitiesAdded: fleet.added,
    entitiesRemoved: fleet.removed,
    increasesByPeriodicity: Object.fromEntries(
      Object.entries(increases).map(([k, v]) => [k, arredondar(v)]),
    ),
    decreasesByPeriodicity: Object.fromEntries(
      Object.entries(decreases).map(([k, v]) => [k, arredondar(v)]),
    ),
    netByPeriodicity: net,
    withoutCalculatedImpact: semImpacto,
    byClass,
  };
}

/* ------------------------------------------------------------------ */
/* Por ativo                                                           */
/* ------------------------------------------------------------------ */

/** Uma alteração de um campo daquele ativo — a linha do drill-down. */
export interface EntityAttributeChange {
  attributeCode: string | null;
  title: string;
  parameterKey: string;
  parameterName: string;
  unit: string | null;
  isMonetary: boolean | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaPercent: number | null;
  /** Em quantas transições do intervalo este campo se mexeu neste ativo. */
  movements: number;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactConfidence: string;
  /** Por que não há valor, quando não há. Nunca vazio junto de um "—". */
  reason: string | null;
  classification: ChangeClass;
  /** Titular cuja parcela também mudou: fora da soma, e dito. */
  coveredByParts: boolean;
}

export interface EntityRollup {
  entityId: string;
  /** A placa. `null` só quando o ativo nunca teve identificador corrente. */
  plate: string | null;
  entityType: string | null;
  equipment: string;
  status: "ALTERADO" | "NOVO" | "REMOVIDO";
  changes: number;
  impact: ImpactSummary;
  /** Maior valor absoluto dentro de uma periodicidade — a ordem da lista. */
  weight: number;
  attributes: EntityAttributeChange[];
}

/**
 * O que mudou **em cada cavalo**.
 *
 * É a leitura que faltava e a que o gestor pede primeiro: a tela sabia dizer
 * "a manutenção subiu em 31 ativos" e não sabia dizer "no ABC1D23 subiu R$
 * 1.620, o FINAME caiu R$ 450 e o consumo caiu 0,13 km/l". As duas perguntas
 * saem das mesmas linhas; só a chave de agrupamento muda.
 *
 * **A identidade é a canônica**, sempre: `entity_id`, que o motor de comparação
 * já parea por chave semântica e nunca por posição de linha. A placa é rótulo,
 * e um rótulo pode até faltar sem que o ativo se perca.
 *
 * Num intervalo com várias transições o mesmo campo do mesmo ativo aparece uma
 * vez por transição. A linha do drill-down é uma só, com `movements` dizendo
 * quantas vezes mexeu, o `valueBefore` da primeira e o `valueAfter` da última —
 * e o impacto **somado**, porque é isso que a leitura de movimentos mede.
 */
export function rollupByEntity(
  rows: RawChange[],
  changedByEntity: Map<string, Set<string>>,
  /** Ordem cronológica das transições, para o "antes" e o "depois" certos. */
  orderOfKey: Map<string, number> = new Map(),
): EntityRollup[] {
  const porAtivo = new Map<string, RawChange[]>();
  for (const row of rows) {
    if (!row.entity_id) continue;
    const lista = porAtivo.get(row.entity_id) ?? [];
    lista.push(row);
    porAtivo.set(row.entity_id, lista);
  }

  const ordem = (row: RawChange) => orderOfKey.get(row.change_set_id) ?? 0;

  const rollups: EntityRollup[] = [];
  for (const [entityId, linhas] of porAtivo) {
    const entrada = linhas.find((l) => l.change_type === "ENTITY_ADDED");
    const saida = linhas.find((l) => l.change_type === "ENTITY_REMOVED");
    const doValor = linhas.filter((l) => l.category === "SOURCE_CHANGE");

    const porAtributo = new Map<string, RawChange[]>();
    for (const linha of doValor) {
      const chave = `${linha.attribute_code ?? "(sem atributo)"}`;
      const lista = porAtributo.get(chave) ?? [];
      lista.push(linha);
      porAtributo.set(chave, lista);
    }

    const attributes: EntityAttributeChange[] = [...porAtributo.values()].map((doCampo) => {
      const cronologica = [...doCampo].sort((a, b) => ordem(a) - ordem(b));
      const primeira = cronologica[0];
      const ultima = cronologica[cronologica.length - 1];
      const placement = placementOf(primeira.attribute_code);

      /*
        O impacto do campo é a **soma** das transições em que ele mexeu, e não
        o da última. Num intervalo de oito meses, um valor que subiu R$ 100 em
        maio e mais R$ 100 em julho movimentou R$ 200 — que é a resposta da
        leitura de movimentos. A leitura ponta a ponta chega aqui com uma
        transição só, e a soma de um elemento é ele mesmo.
      */
      let amount: number | null = null;
      let periodicity: string | null = null;
      let confidence = "NOT_CALCULABLE";
      const coberto = isCoveredByParts(
        primeira.attribute_code,
        entityId,
        changedByEntity,
      );
      for (const linha of cronologica) {
        if (linha.impact_confidence !== "CALCULATED" || linha.impact_amount === null) continue;
        confidence = "CALCULATED";
        periodicity = linha.impact_periodicity;
        amount = (amount ?? 0) + Number(linha.impact_amount);
      }

      return {
        attributeCode: primeira.attribute_code,
        title: attributeLabel(
          primeira.attribute_code,
          primeira.attribute_source_name ?? primeira.attribute_code ?? "(sem atributo)",
        ),
        parameterKey: placement.parameterKey,
        parameterName: placement.parameter,
        unit: primeira.unit,
        isMonetary: primeira.is_monetary,
        valueBefore: primeira.value_before,
        valueAfter: ultima.value_after,
        deltaPercent:
          cronologica.length === 1 && ultima.delta_percent !== null
            ? Number(ultima.delta_percent)
            : null,
        movements: cronologica.length,
        impactAmount: amount === null ? null : arredondar(amount),
        impactPeriodicity: periodicity,
        impactConfidence: confidence,
        reason:
          confidence === "CALCULATED"
            ? null
            : (ultima.impact_reason ?? ultima.inconclusive_reason ?? null),
        classification: changeClassOf(ultima),
        coveredByParts: coberto,
      };
    });

    attributes.sort((a, b) => {
      const peso = (x: EntityAttributeChange) => Math.abs(x.impactAmount ?? 0);
      const diferenca = peso(b) - peso(a);
      return diferenca !== 0 ? diferenca : a.title.localeCompare(b.title, "pt-BR");
    });

    const impact = summariseImpact(linhas, changedByEntity);
    const referencia = linhas[0];
    rollups.push({
      entityId,
      plate: referencia.entity_label,
      entityType: referencia.entity_type,
      equipment: equipmentLabel(referencia.entity_type ?? ""),
      status: entrada ? "NOVO" : saida ? "REMOVIDO" : "ALTERADO",
      changes: linhas.length,
      impact,
      weight: maiorAbsoluto(impact.byPeriodicity),
      attributes,
    });
  }

  return rollups.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.changes !== a.changes) return b.changes - a.changes;
    return (a.plate ?? a.entityId).localeCompare(b.plate ?? b.entityId, "pt-BR");
  });
}

function maiorAbsoluto(byPeriodicity: Record<string, number>): number {
  const valores = Object.values(byPeriodicity).map(Math.abs);
  return valores.length === 0 ? 0 : Math.max(...valores);
}

/* ------------------------------------------------------------------ */
/* Maiores impactos, um a um                                           */
/* ------------------------------------------------------------------ */

/** Uma alteração de um campo de um ativo — a linha de "maiores impactos". */
export interface TopChange {
  key: string;
  entityId: string;
  plate: string | null;
  equipment: string;
  attributeCode: string | null;
  title: string;
  parameterKey: string;
  parameterName: string;
  unit: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  amount: number;
  periodicity: string;
  classification: ChangeClass;
}

/**
 * As maiores alterações do intervalo, ativo a ativo e campo a campo.
 *
 * Só entra o que tem dinheiro apurado — é uma lista ordenada por valor, e uma
 * lista ordenada por valor não pode ter linha sem valor. O que ficou de fora
 * está inteiro em `rollupByEntity` e no resumo, com o motivo.
 */
export function topChanges(
  rows: RawChange[],
  changedByEntity: Map<string, Set<string>>,
): TopChange[] {
  const porChave = new Map<string, TopChange>();

  for (const row of rows) {
    if (row.category !== "SOURCE_CHANGE") continue;
    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) continue;
    if (!row.entity_id) continue;
    if (isCoveredByParts(row.attribute_code, row.entity_id, changedByEntity)) continue;

    const chave = `${row.entity_id}|${row.attribute_code}|${row.impact_periodicity ?? "SEM_PERIODICIDADE"}`;
    const existente = porChave.get(chave);
    if (existente) {
      // O mesmo campo mexeu em mais de uma transição: soma, e o "depois" é o
      // da última — a mesma regra do drill-down por ativo.
      existente.amount = arredondar(existente.amount + Number(row.impact_amount));
      existente.valueAfter = row.value_after;
      continue;
    }

    const placement = placementOf(row.attribute_code);
    porChave.set(chave, {
      key: chave,
      entityId: row.entity_id,
      plate: row.entity_label,
      equipment: equipmentLabel(row.entity_type ?? ""),
      attributeCode: row.attribute_code,
      title: attributeLabel(
        row.attribute_code,
        row.attribute_source_name ?? row.attribute_code ?? "(sem atributo)",
      ),
      parameterKey: placement.parameterKey,
      parameterName: placement.parameter,
      unit: row.unit,
      valueBefore: row.value_before,
      valueAfter: row.value_after,
      amount: Number(row.impact_amount),
      periodicity: row.impact_periodicity ?? "SEM_PERIODICIDADE",
      classification: changeClassOf(row),
    });
  }

  return [...porChave.values()]
    .filter((linha) => linha.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** O índice de composição sobre o conjunto inteiro. Reexportado por conveniência. */
export { indexChangedAttributesByEntity };
