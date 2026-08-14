import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { loadAttributeClassificationsAt } from "./classification";
import { indexChangedAttributesByEntity, isCoveredByParts } from "./composition";
import { attributeLabel, equipmentLabel } from "./labels";
import { FAMILIES, placementOf, scopeFilter, type FamilyCode } from "./families";
import type { ParameterRollup } from "./families-view";
import {
  buildGroup,
  compareGroups,
  groupKey,
  periodLabel,
  summariseImpact,
  type ChangeGroup,
  type ImpactSummary,
} from "./grouped";
import { listPeriods } from "./consolidated";
import { endToEndTransitions, movementTransitions, resolveTransitions } from "./transitions";
import {
  executiveDigest,
  rollupByEntity,
  topChanges,
  type EntityRollup,
  type ExecutiveDigest,
  type TopChange,
} from "./rollups";
import {
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
  /** O resumo executivo — ver `rollups.ts`. As duas leituras usam o mesmo. */
  digest: ExecutiveDigest;
  /** O que continua diferente em cada ativo, com o drill-down campo a campo. */
  byEntity: EntityRollup[];
  /** As maiores diferenças, ativo a ativo e campo a campo. */
  top: TopChange[];
  /** Transições calculadas na hora. Diagnóstico; nunca vocabulário de tela. */
  computedOnRead: number;
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
  /**
   * Recorte do cartão pela **coluna**, quando o cartão é uma tabela — CAVALO e
   * CARRETA são inventários, e o escopo deles é a lista de colunas da tela de
   * lá. Soma-se ao recorte por parâmetro; nunca o substitui.
   */
  attributeCodes?: string[],
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

  /*
    As pontas, resolvidas pelo mesmo caminho que os movimentos.

    Esta leitura sempre soube comparar dois retratos que não se sucedem — era a
    única do produto que não dependia de `change_set`. O que mudou é que ela
    deixou de ter caminho próprio: pede a comparação à resolução de transições
    (`transitions.ts`), que aproveita a comparação gravada quando as duas pontas
    são consecutivas e calcula quando não. Um motor, duas agregações.
  */
  const { pairs, missingSeries } = await endToEndTransitions(db, context, inicio, fim);

  /*
    O caminho percorrido, resolvido **antes** das pontas.

    Ele é preciso de todo jeito — é dele que sai "mexeu e voltou", a única
    pergunta desta tela que exige as transições intermediárias —, e resolvê-lo
    primeiro permite reaproveitar a transição quando as duas pontas são
    consecutivas. Julho contra agosto é o caso mais comum da aba, e nele a
    comparação é feita uma vez, não duas.
  */
  const { pairs: doCaminho } = await movementTransitions(db, context, inicio, fim);
  const percurso = await resolveTransitions(db, doCaminho, {
    materialize: true,
    materializedBy: "api:analise-ponta-a-ponta",
  });

  const jaResolvidas = new Map(percurso.map((t) => [`${t.from.id}|${t.to.id}`, t]));
  const aResolver = pairs.filter((par) => !jaResolvidas.has(`${par.from.id}|${par.to.id}`));
  const novas = await resolveTransitions(db, aResolver);
  const transicoes = pairs.map(
    (par) =>
      jaResolvidas.get(`${par.from.id}|${par.to.id}`) ??
      novas.find((t) => t.from.id === par.from.id && t.to.id === par.to.id)!,
  );

  const entitiesAdded = transicoes.reduce((soma, t) => soma + t.entitiesAdded, 0);
  const entitiesRemoved = transicoes.reduce((soma, t) => soma + t.entitiesRemoved, 0);
  const entitiesCompared = transicoes.reduce((soma, t) => soma + t.entitiesCompared, 0);
  /*
    `buildGroup` usa a frota da ponta de chegada para dizer a cobertura do
    grupo, e a chave que ele consulta é a da transição.
  */
  const fleetByChangeSet = new Map(transicoes.map((t) => [t.key, t.to.entityCount]));

  const deA = new Map(pairs.map((p) => [p.entityTypeSet, p.from]));
  const deB = new Map(pairs.map((p) => [p.entityTypeSet, p.to]));

  /*
    Só o eixo do valor entra nesta leitura.

    Entrada e saída de frota têm eixo próprio, fora do dinheiro; coluna nova e
    mudança de significado são fatos da série inteira e não do salto entre duas
    pontas. As linhas existem no resultado da comparação e são filtradas aqui —
    e não deixadas de calcular — para que as duas leituras continuem saindo do
    mesmo conjunto.
  */
  const linhas: LinhaCrua[] = transicoes
    .flatMap((t) => t.rows)
    .filter((linha) => linha.category === "SOURCE_CHANGE");

  const noEscopo = scopeFilter(parameterKeys, attributeCodes);
  const doCartao = noEscopo ? linhas.filter((l) => noEscopo(l.attribute_code)) : linhas;

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

  /*
    O caminho percorrido (resolvido lá em cima) é quem responde "mexeu e voltou",
    e não mais um SELECT em `change`.

    A consulta antiga lia a tabela de alterações gravadas: sem comparação
    materializada ela devolvia vazio, e "mexeu e voltou" virava "nada voltou" —
    uma afirmação, e falsa.
  */
  const mexeram = new Map<
    string,
    { ativos: Set<string>; periodos: Set<string>; nome: string | null; equipamento: string | null }
  >();
  for (const transicao of percurso) {
    for (const linha of transicao.rows) {
      if (linha.change_type !== "VALUE_CHANGED") continue;
      if (!linha.entity_id || !linha.attribute_code) continue;
      if (noEscopo && !noEscopo(linha.attribute_code)) continue;
      const atual = mexeram.get(linha.attribute_code) ?? {
        ativos: new Set<string>(),
        periodos: new Set<string>(),
        nome: linha.attribute_source_name,
        equipamento: linha.entity_type,
      };
      atual.ativos.add(linha.entity_id);
      atual.periodos.add(transicao.to.effectiveDate);
      mexeram.set(linha.attribute_code, atual);
    }
  }

  const reverted = [...mexeram.entries()]
    .map(([attributeCode, dados]) => {
      const voltaram = [...dados.ativos].filter(
        (entityId) => !diferentesAgora.has(`${entityId}|${attributeCode}`),
      );
      return {
        attributeCode,
        title: attributeLabel(attributeCode, dados.nome ?? attributeCode),
        equipment: equipmentLabel(dados.equipamento ?? ""),
        parameterKey: placementOf(attributeCode).parameterKey,
        entities: voltaram.length,
        periods: dados.periodos.size,
      };
    })
    .filter((linha) => linha.entities > 0)
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
    series: pairs.map((par) => ({
      entityTypeSet: par.entityTypeSet,
      equipment: deB.get(par.entityTypeSet)!.entityTypeSet,
      fromLabel: deA.get(par.entityTypeSet)!.sourceLabel,
      toLabel: deB.get(par.entityTypeSet)!.sourceLabel,
      fleetFrom: deA.get(par.entityTypeSet)!.entityCount,
      fleetTo: deB.get(par.entityTypeSet)!.entityCount,
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
    digest: executiveDigest(doCartao as never, changedByEntity, {
      added: entitiesAdded,
      removed: entitiesRemoved,
    }),
    byEntity: rollupByEntity(doCartao as never, changedByEntity),
    top: topChanges(doCartao as never, changedByEntity),
    computedOnRead: transicoes.filter((t) => t.origin === "COMPUTED").length,
    byParameter,
    entries,
  };
}
