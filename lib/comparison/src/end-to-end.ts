import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { loadAttributeClassificationsAt } from "./classification";
import { indexChangedAttributesByEntity, isCoveredByParts } from "./composition";
import { diffSnapshots, type ComputedChange } from "./engine";
import { attributeLabel, equipmentLabel, periodLabel } from "./labels";
import { FAMILIES, placementOf, type FamilyCode } from "./families";
import type { ParameterRollup } from "./families-view";
import {
  buildGroup,
  compareGroups,
  groupKey,
  summariseImpact,
  type ChangeGroup,
  type ImpactSummary,
} from "./grouped";
import { listPeriods } from "./consolidated";
import {
  contextFilter,
  listContexts,
  resolveContext,
  type ContextInfo,
  type SeriesContext,
} from "./series";

/**
 * Ponta a ponta — o estado de uma vigência contra o de outra.
 *
 * A outra leitura da aba de análise soma os movimentos do caminho: abril, maio,
 * junho, julho, agosto. Esta pergunta outra coisa — *como agosto está diferente
 * de abril* — e as duas respostas divergem sempre que houve ida e volta. Um
 * valor que foi de 10 a 20 e voltou a 10 aparece lá como duas alterações e aqui
 * como nada, e as duas estão certas.
 *
 * **Por que não dá para derivar uma da outra.** Não é só a ida e volta. Na base
 * real, `cavalo.finame_cavalo` de dezembro a agosto soma −R$ 52.223,90 de
 * movimento, e o total da frota vai de R$ 887.408,65 para R$ 867.860,23 — uma
 * diferença de R$ 19.548,42. Os R$ 32.675 que sobram não são erro de nenhuma
 * das contas: **entraram dois cavalos na frota**, e eles chegaram com FINAME
 * junto. Frota maior não é preço maior.
 *
 * Daí as duas regras desta leitura, e nenhuma é negociável:
 *
 * 1. **Comparação é ativo a ativo, sobre quem está nas duas pontas.** Nunca
 *    total de frota contra total de frota.
 * 2. **Entrada e saída de ativo ficam num eixo próprio**, contadas e ditas,
 *    nunca dobradas no dinheiro.
 *
 * E uma regra de arquitetura: isto **não grava nada**. Reaproveita
 * `diffSnapshots` — a mesma função que a importação usa — sem persistir um
 * `change_set`. Gravar o par abril→agosto seria pior do que duplicar o cálculo:
 * a tela de agosto o apanharia pelo `snapshot_b` e somaria oito meses de
 * movimento ao total de um mês.
 */

export interface EndToEndEntry {
  key: string;
  parameterKey: string;
  parameterName: string;
  family: FamilyCode;
  attributeCode: string | null;
  title: string;
  equipment: string;
  entityType: string | null;
  /** Ativos cujo valor **hoje** está diferente do que era na ponta inicial. */
  vehicles: number;
  unit: string | null;
  amount: number | null;
  periodicity: string | null;
  confidence: string;
  reason: string | null;
  badge: string;
  badgeLabel: string;
  /** O grupo inteiro, para a tela abrir o mesmo cartão de detalhe de sempre. */
  group: ChangeGroup;
  /** Os ativos deste grupo. Vêm juntos porque não existe `change_set` para consultar depois. */
  vehiclesDetail: {
    plate: string | null;
    valueBefore: string | null;
    valueAfter: string | null;
    deltaPercent: number | null;
    impactAmount: number | null;
    impactPeriodicity: string | null;
    impactConfidence: string;
    inconclusiveReason: string | null;
  }[];
}

export interface EndToEndAnalysis {
  context: ContextInfo;
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  periods: { date: string; label: string }[];
  /** As séries comparadas, com o rótulo do arquivo de cada ponta. */
  series: {
    entityTypeSet: string;
    equipment: string;
    fromLabel: string;
    toLabel: string;
    fleetFrom: number;
    fleetTo: number;
  }[];
  /** Séries presentes numa ponta só — não comparáveis, e ditas. */
  missingSeries: { entityTypeSet: string; reason: string }[];
  /** O eixo da frota. Fora do dinheiro, sempre. */
  fleet: { added: number; removed: number };
  /**
   * O que mexeu depois da ponta inicial e voltou ao ponto de partida.
   *
   * Não é heurística: é a subtração entre as duas leituras. O que aparece nos
   * movimentos e não aparece aqui foi revertido — e essa é a única pergunta da
   * tela que exige ter as duas contas, e não uma delas duas vezes.
   */
  reverted: {
    attributeCode: string;
    title: string;
    /** CARRETA e CAVALO têm colunas de mesmo nome; sem isto viram três linhas iguais. */
    equipment: string;
    parameterKey: string;
    /** Ativos que mexeram no caminho e hoje estão como estavam. */
    entities: number;
    /** Em quantas vigências aquele atributo se mexeu no intervalo. */
    periods: number;
  }[];
  /** Ativos presentes nas duas pontas — o denominador desta leitura. */
  entitiesCompared: number;
  impact: ImpactSummary;
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  totals: { changes: number; vehiclesTouched: number };
  /**
   * O que **permanece alterado**, somado por parâmetro.
   *
   * O irmão do `byParameter` dos movimentos, e a outra metade da pergunta
   * executiva: lá é "no que a Ambev mexeu no caminho", aqui é "o que continua
   * diferente hoje". Mesma função de soma, mesmo índice de composição — as
   * partes fecham com o todo dentro de cada periodicidade.
   */
  byParameter: ParameterRollup[];
  entries: EndToEndEntry[];
}

const round = (v: number) => Number(v.toFixed(2));

/** A forma que `buildGroup` lê — a mesma que sai do SQL de `loadChanges`. */
interface LinhaCrua extends Record<string, unknown> {
  id: number;
  change_set_id: string;
  category: string;
  change_type: string;
  nature: string | null;
  entity_id: string | null;
  entity_label: string | null;
  entity_type: string | null;
  attribute_code: string | null;
  attribute_source_name: string | null;
  value_before: string | null;
  value_after: string | null;
  numeric_before: string | null;
  numeric_after: string | null;
  delta_percent: string | null;
  comparability: string;
  inconclusive_reason: string | null;
  impact_confidence: string;
  impact_amount: string | null;
  impact_periodicity: string | null;
  impact_reason: string | null;
  cost_class: string | null;
  taxonomy_name: string | null;
  semantics_status: string | null;
  aggregation: string | null;
  is_monetary: boolean | null;
  unit: string | null;
}

export async function getEndToEndAnalysis(
  db: Database,
  from?: string,
  to?: string,
  requestedContext?: Partial<SeriesContext>,
  /** Recorte do cartão: só estes parâmetros. Vazio = tudo. */
  parameterKeys?: string[],
): Promise<EndToEndAnalysis | null> {
  const contexts = await listContexts(db);
  const context = await resolveContext(db, requestedContext, contexts);
  if (!context) return null;

  const periods = await listPeriods(db, context);
  if (periods.length === 0) return null;
  const datas = periods.map((p) => p.effective_date);

  const alvoFim = to && datas.includes(to) ? to : datas[0];
  /*
    Sem `from` escolhido, a ponta inicial é a vigência **imediatamente anterior
    à final** — e não a segunda mais recente do histórico.

    A diferença aparece quando a ponta final não é a mais recente: com `to` em
    junho, "a segunda do histórico" é julho, que vem *depois*. O intervalo
    acabava invertido, o código dava a volta com um swap, e a tela mostrava
    junho → julho para quem tinha pedido junho. O padrão certo é o mais curto
    que ainda mostra movimento a partir da ponta escolhida.
  */
  const anteriorAoFim = datas.find((d) => d < alvoFim);
  const alvoInicio =
    from && datas.includes(from) ? from : (anteriorAoFim ?? alvoFim);
  const [inicio, fim] =
    alvoInicio <= alvoFim ? [alvoInicio, alvoFim] : [alvoFim, alvoInicio];

  const { rows: snapshots } = await db.execute<{
    id: string;
    effective_date: string;
    entity_type_set: string;
    source_label: string;
    entity_count: number;
  }>(sql`
    SELECT s.id::text AS id, s.effective_date::text AS effective_date,
           s.entity_type_set, s.source_label, s.entity_count
      FROM snapshot s
     WHERE s.effective_date IN (${inicio}::date, ${fim}::date)
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
  `);

  const naPonta = (data: string) =>
    new Map(snapshots.filter((s) => s.effective_date === data).map((s) => [s.entity_type_set, s]));
  const deA = naPonta(inicio);
  const deB = naPonta(fim);

  /*
    Só se compara série com série do mesmo equipamento. Uma que exista só numa
    das pontas não vira zero nem entra na conta: é dita, e o motivo é o que
    manda importar o arquivo que falta.
  */
  const paresComparaveis = [...deB.keys()].filter((serie) => deA.has(serie)).sort();
  const missingSeries = [
    ...[...deB.keys()].filter((s) => !deA.has(s)).map((s) => ({
      entityTypeSet: s,
      reason: `A série existe em ${periodLabel(fim)} e não em ${periodLabel(inicio)}: não há ponta inicial com que comparar.`,
    })),
    ...[...deA.keys()].filter((s) => !deB.has(s)).map((s) => ({
      entityTypeSet: s,
      reason: `A série existe em ${periodLabel(inicio)} e não em ${periodLabel(fim)}: não há ponta final com que comparar.`,
    })),
  ];

  const semanticsA = await loadAttributeClassificationsAt(db, inicio);
  const semanticsB = await loadAttributeClassificationsAt(db, fim);

  const todas: { serie: string; linha: ComputedChange }[] = [];
  let entitiesAdded = 0;
  let entitiesRemoved = 0;
  let entitiesCompared = 0;
  const fleetByChangeSet = new Map<string, number>();

  for (const serie of paresComparaveis) {
    const a = deA.get(serie)!;
    const b = deB.get(serie)!;
    const diff = await diffSnapshots(
      db,
      { id: a.id, effectiveDate: a.effective_date },
      { id: b.id, effectiveDate: b.effective_date },
      semanticsA,
      semanticsB,
    );
    for (const linha of diff.changes) todas.push({ serie, linha });
    entitiesAdded += diff.entitiesAdded;
    entitiesRemoved += diff.entitiesRemoved;
    entitiesCompared += b.entity_count - diff.entitiesAdded;
    /*
      `buildGroup` usa a frota da série para dizer a cobertura do grupo, e a
      chave que ele consulta é o `change_set_id` da linha. Aqui não existe
      `change_set` — o nome da série ocupa esse lugar, que é o que a chave
      significa nesta leitura: de qual arquivo aquele grupo veio.
    */
    fleetByChangeSet.set(serie, b.entity_count);
  }

  // ---- traduz para a forma que o agrupamento já sabe ler --------------------
  const porId = new Map(
    [...semanticsB.values()].map((c) => [c.attributeId, c] as const),
  );
  const linhas: LinhaCrua[] = todas
    .filter(({ linha }) => linha.category === "SOURCE_CHANGE")
    .map(({ serie, linha }, indice) => {
      const semantica = linha.attributeId ? porId.get(linha.attributeId) : undefined;
      return {
        id: indice,
        change_set_id: serie,
        category: linha.category,
        change_type: linha.changeType,
        nature: linha.nature ?? null,
        entity_id: linha.entityId ?? null,
        entity_label: linha.entityLabel ?? null,
        entity_type: linha.entityType ?? semantica?.entityType ?? null,
        attribute_code: semantica?.attributeCode ?? null,
        attribute_source_name: semantica?.attributeName ?? null,
        value_before: linha.valueBefore ?? null,
        value_after: linha.valueAfter ?? null,
        numeric_before: linha.numericBefore === undefined ? null : (linha.numericBefore as string | null),
        numeric_after: linha.numericAfter === undefined ? null : (linha.numericAfter as string | null),
        delta_percent: linha.deltaPercent === undefined ? null : (linha.deltaPercent as string | null),
        comparability: linha.comparability,
        inconclusive_reason: linha.inconclusiveReason ?? null,
        impact_confidence: linha.impactConfidence,
        impact_amount: linha.impactAmount === undefined ? null : (linha.impactAmount as string | null),
        impact_periodicity: linha.impactPeriodicity ?? null,
        impact_reason: linha.impactReason ?? null,
        cost_class: linha.costClass ?? null,
        taxonomy_name: linha.taxonomyName ?? null,
        semantics_status: linha.semanticsStatus ?? null,
        aggregation: semantica?.aggregation ?? null,
        is_monetary: semantica?.isMonetary ?? null,
        unit: semantica?.unit ?? null,
      };
    });

  const doCartao =
    parameterKeys && parameterKeys.length > 0
      ? linhas.filter((l) => parameterKeys.includes(placementOf(l.attribute_code).parameterKey))
      : linhas;

  /*
    O índice de composição é montado sobre **todas** as linhas, e não sobre o
    recorte do cartão: `carreta.custo_fixo` mora num cartão e a sua parcela
    `lucro_fixomodelo_novo_ciclo` mora noutro. Um índice só do recorte não veria
    a parcela mudar, o titular voltaria para dentro da soma, e o cartão
    mostraria o mesmo dinheiro duas vezes.
  */
  const changedByEntity = indexChangedAttributesByEntity(
    linhas.map((l) => ({ entityId: l.entity_id, attributeCode: l.attribute_code })),
  );

  const baldes = new Map<string, LinhaCrua[]>();
  for (const linha of doCartao) {
    const chave = groupKey(linha as never);
    const balde = baldes.get(chave);
    if (balde) balde.push(linha);
    else baldes.set(chave, [linha]);
  }

  const entries: EndToEndEntry[] = [...baldes.entries()]
    .map(([chave, bucket]) => {
      const group = buildGroup(bucket as never, fleetByChangeSet, changedByEntity);
      const placement = placementOf(group.attributeCode);
      return {
        key: chave,
        parameterKey: placement.parameterKey,
        parameterName: placement.parameterKey.split("|").slice(1).join("|"),
        family: placement.family,
        attributeCode: group.attributeCode,
        title: group.title,
        equipment: group.equipment,
        entityType: group.entityType,
        vehicles: group.vehicles,
        unit: group.unit,
        amount: group.impact.amount,
        periodicity: group.impact.periodicity,
        confidence: group.impact.confidence,
        reason: group.impact.reason,
        badge: group.badge,
        badgeLabel: group.badgeLabel,
        group,
        vehiclesDetail: bucket
          .map((l) => ({
            plate: l.entity_label,
            valueBefore: l.value_before,
            valueAfter: l.value_after,
            deltaPercent: l.delta_percent === null ? null : Number(l.delta_percent),
            impactAmount: l.impact_amount === null ? null : Number(l.impact_amount),
            impactPeriodicity: l.impact_periodicity,
            impactConfidence: l.impact_confidence,
            inconclusiveReason: l.inconclusive_reason,
          }))
          .sort((x, y) => Math.abs(y.impactAmount ?? 0) - Math.abs(x.impactAmount ?? 0)),
      };
    })
    .sort((a, b) => compareGroups(a.group, b.group));

  /*
    A reversão.

    As linhas que se mexeram **depois** da ponta inicial — `> inicio`, e não
    `>= inicio`: a transição que produziu a própria ponta inicial aconteceu
    antes dela, e contá-la faria passar por revertido o que nunca se mexeu no
    intervalo. Delas, as que hoje não estão diferentes voltaram ao ponto de
    partida.
  */
  const diferentesAgora = new Set(
    doCartao.map((l) => `${l.entity_id}|${l.attribute_code}`),
  );
  const { rows: mexeram } = await db.execute<{
    entity_id: string;
    attribute_code: string;
    periodos: number;
  }>(sql`
    SELECT c.entity_id::text AS entity_id, c.attribute_code, count(DISTINCT sb.effective_date)::int AS periodos
      FROM "change" c
      JOIN change_set cs ON cs.id = c.change_set_id
      JOIN snapshot sb   ON sb.id = cs.snapshot_b_id
     WHERE sb.effective_date > ${inicio}::date
       AND sb.effective_date <= ${fim}::date
       AND sb.status <> 'SUPERSEDED'
       AND c.change_type = 'VALUE_CHANGED'
       AND c.entity_id IS NOT NULL
       AND c.attribute_code IS NOT NULL
       AND ${contextFilter("sb", context)}
     GROUP BY 1, 2
  `);

  const revertidoPorAtributo = new Map<
    string,
    { entities: number; periods: number }
  >();
  for (const linha of mexeram) {
    const chave = placementOf(linha.attribute_code).parameterKey;
    if (parameterKeys && parameterKeys.length > 0 && !parameterKeys.includes(chave)) continue;
    if (diferentesAgora.has(`${linha.entity_id}|${linha.attribute_code}`)) continue;
    const atual = revertidoPorAtributo.get(linha.attribute_code) ?? { entities: 0, periods: 0 };
    atual.entities += 1;
    atual.periods = Math.max(atual.periods, linha.periodos);
    revertidoPorAtributo.set(linha.attribute_code, atual);
  }

  const reverted = [...revertidoPorAtributo.entries()]
    .map(([attributeCode, dados]) => {
      const semantica = [...semanticsB.values()].find((c) => c.attributeCode === attributeCode);
      return {
        attributeCode,
        title: attributeLabel(attributeCode, semantica?.attributeName ?? attributeCode),
        equipment: equipmentLabel(semantica?.entityType ?? ""),
        parameterKey: placementOf(attributeCode).parameterKey,
        entities: dados.entities,
        periods: dados.periods,
      };
    })
    .sort((a, b) => b.entities - a.entities);

  const linhasPorParametro = new Map<string, LinhaCrua[]>();
  for (const linha of doCartao) {
    const chave = placementOf(linha.attribute_code).parameterKey;
    const lista = linhasPorParametro.get(chave) ?? [];
    lista.push(linha);
    linhasPorParametro.set(chave, lista);
  }

  const byParameter: ParameterRollup[] = [...linhasPorParametro.entries()]
    .map(([chave, linhas]) => {
      const impact = summariseImpact(linhas as never, changedByEntity);
      const family = placementOf(linhas[0]?.attribute_code ?? null).family;
      return {
        parameterKey: chave,
        parameterName: chave.split("|").slice(1).join("|"),
        family,
        familyName: FAMILIES[family]?.name ?? family,
        changes: linhas.length,
        vehicles: new Set(
          linhas.map((l) => l.entity_id).filter((v): v is string => v !== null),
        ).size,
        impact,
        // Nesta leitura não há vigências intermediárias: é um salto só.
        periods: 1,
        notCalculable: impact.notCalculable,
      };
    })
    .sort((a, b) => {
      const peso = (r: ParameterRollup) => {
        const valores = Object.values(r.impact.byPeriodicity).map(Math.abs);
        return valores.length === 0 ? 0 : Math.max(...valores);
      };
      const diferenca = peso(b) - peso(a);
      if (diferenca !== 0) return diferenca;
      if (b.changes !== a.changes) return b.changes - a.changes;
      return a.parameterName.localeCompare(b.parameterName, "pt-BR");
    });

  const losses: Record<string, number> = {};
  const gains: Record<string, number> = {};
  for (const linha of doCartao) {
    if (linha.impact_confidence !== "CALCULATED" || linha.impact_amount === null) continue;
    if (isCoveredByParts(linha.attribute_code, linha.entity_id, changedByEntity)) continue;
    const balde = linha.impact_periodicity ?? "SEM_PERIODICIDADE";
    const valor = Number(linha.impact_amount);
    if (valor < 0) losses[balde] = (losses[balde] ?? 0) + valor;
    else if (valor > 0) gains[balde] = (gains[balde] ?? 0) + valor;
  }

  return {
    context,
    from: inicio,
    fromLabel: periodLabel(inicio),
    to: fim,
    toLabel: periodLabel(fim),
    periods: datas.map((d) => ({ date: d, label: periodLabel(d) })),
    series: paresComparaveis.map((serie) => ({
      entityTypeSet: serie,
      equipment: deB.get(serie)!.entity_type_set,
      fromLabel: deA.get(serie)!.source_label,
      toLabel: deB.get(serie)!.source_label,
      fleetFrom: deA.get(serie)!.entity_count,
      fleetTo: deB.get(serie)!.entity_count,
    })),
    missingSeries,
    fleet: { added: entitiesAdded, removed: entitiesRemoved },
    reverted,
    entitiesCompared,
    impact: summariseImpact(doCartao as never, changedByEntity),
    lossesByPeriodicity: Object.fromEntries(
      Object.entries(losses).map(([k, v]) => [k, round(v)]),
    ),
    gainsByPeriodicity: Object.fromEntries(
      Object.entries(gains).map(([k, v]) => [k, round(v)]),
    ),
    totals: {
      changes: doCartao.length,
      vehiclesTouched: new Set(
        doCartao.map((l) => l.entity_id).filter((v): v is string => v !== null),
      ).size,
    },
    byParameter,
    entries,
  };
}
