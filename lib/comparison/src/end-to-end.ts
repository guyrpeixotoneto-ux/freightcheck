import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { loadAttributeClassificationsAt } from "./classification";
import {
  criarDeduplicador,
  daLinhaDoBanco,
  type Deduplicador,
} from "./deduplicacao";
import { carregarVinculosDeConjunto } from "./vinculos";
import { diffSnapshots, type ComputedChange } from "./engine";
import { attributeLabel, equipmentLabel, periodLabel } from "./labels";
import { FAMILIES, placementOf, type FamilyCode } from "./families";
import type { ParameterRollup } from "./families-view";
import {
  buildGroup,
  chaveDaFrota,
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
  type RequestedContext,
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
  /**
   * A posição de cada atributo, no grão em que a tela publica.
   *
   * Ver `AtributoNaPonta`. É o irmão de `byParameter` num grão mais fino, e o
   * motivo de ele existir é que o parâmetro não serve de linha para uma tela
   * organizada por equipamento — `carreta.custo_aluguel` e
   * `cavalo.custo_aluguel` moram na mesma gaveta (`FROTA|Caminhão aluguel`), e
   * um rollup dela não cabe nem no bloco da carreta nem no do cavalo.
   */
  byAttribute: AtributoNaPonta[];
  /** O denominador de "X de Y mudaram", por equipamento. Ver `UniversoDoTipo`. */
  universo: UniversoDoTipo[];
}

/** Quantas vigências do intervalo mexeram num atributo, e em quantos ativos. */
export interface MovimentacaoNoPeriodo {
  /** Vigências do intervalo em que o atributo se mexeu. */
  vigencias: number;
  /** Ativos distintos que se mexeram nele, em qualquer ponto do caminho. */
  ativos: number;
}

/**
 * A posição de um atributo num equipamento — a linha da tela.
 *
 * **O grão é (atributo × tipo de entidade), e não o parâmetro.** Um `parameterKey`
 * é `família|parâmetro` e não carrega equipamento (`families.ts`), e há gavetas
 * que atravessam tipos. Numa tela cujos blocos são equipamentos, o parâmetro só
 * pode ser agrupador visual — a linha tem de ser o par.
 *
 * **O dinheiro não é somável a partir daqui, e não precisa de ser.** `impact` sai
 * de `summariseImpact` sobre as linhas cruas deste par, com o deduplicador da
 * leitura inteira — a mesma autoridade e o mesmo índice do total da análise. Uma
 * tela que somasse `impact.amount` de vários grupos produziria um número que a
 * autoridade não assinou: a exclusão é por ativo e olha para fora do grupo.
 *
 * **`posicao` separa duas notícias que o delta não distingue.** `DIFERENTE` é o
 * que continua diferente das pontas; `REVERTIDO` mexeu no caminho e voltou ao
 * valor inicial — delta zero, e movimento que houve. Sem esta separação a
 * segunda desapareceria da tela, que é precisamente o que a leitura de posição
 * faz sozinha.
 */
export interface AtributoNaPonta {
  key: string;
  attributeCode: string | null;
  entityType: string | null;
  equipment: string;
  title: string;
  parameterKey: string;
  parameterName: string;
  family: FamilyCode;
  unit: string | null;
  posicao: "DIFERENTE" | "REVERTIDO";
  /** Ativos cujo valor hoje difere da ponta inicial. Zero no revertido. */
  vehicles: number;
  fleet: number;
  /**
   * Quanto da frota este par pegou — `TOTAL`/`MAIORIA`/`PARCIAL`.
   *
   * **Não confundir com a cobertura de dados** (`@workspace/coverage`), que
   * responde "temos o dado?" e tem vocabulário próprio. Esta responde "quantos
   * ativos mexeram", e as duas nunca se substituem.
   */
  coverage: ChangeGroup["coverage"] | null;
  coverageLabel: string | null;
  /** Total antes e depois, quando o atributo é somável. Ver `buildGroup`. */
  aggregate: ChangeGroup["aggregate"] | null;
  /** O par antes→depois mais comum, para quem não é somável. */
  dominantPattern: ChangeGroup["dominantPattern"];
  patterns: number;
  /** O impacto oficial deste par. Da autoridade, por periodicidade. */
  impact: ImpactSummary;
  /**
   * O que saiu da soma neste par, e por qual regra.
   *
   * `ESCOPO_DE_CONJUNTO` é o selo de conjunto da tela: o valor cobre cavalo e
   * carreta juntos, e a linha de um deles não entra no total porque a do outro
   * já responde por ela. Vem da decisão do deduplicador, nunca de uma segunda
   * leitura da regra.
   */
  foraDaSoma: {
    motivo: string;
    explicacao: string;
    ativos: number;
    valor: number | null;
  } | null;
  movimentacoes: MovimentacaoNoPeriodo;
  inconclusiveReason: string | null;
  /** Os grupos que formam esta linha, para o detalhe abrir sem recompor nada. */
  groups: ChangeGroup[];
}

/**
 * O universo de um equipamento no recorte — o denominador honesto de "X de Y".
 *
 * `atributos` conta o **universo canônico**: atributos distintos com valor na
 * vigência final daquele tipo. Não é o catálogo do Freightech nem o número de
 * linhas da tela — é o que o modelo canônico de facto tem para aquele
 * equipamento, que é a única contagem contra a qual "34 mudaram" quer dizer
 * alguma coisa.
 *
 * Fato nulo não entra. Uma coluna que chegou vazia para a frota inteira não é
 * uma variável da remuneração daquela vigência; é assunto de Cobertura de
 * dados, e contá-la aqui inflaria o denominador com colunas que não carregam
 * nada.
 *
 * As pontas vêm por tipo porque elas **são** por tipo: QLP vive noutra família
 * de dados, com identidade e calendário próprios, e pode ter sido comparado
 * entre duas vigências diferentes das do equipamento.
 */
export interface UniversoDoTipo {
  entityType: string;
  equipment: string;
  /** As duas vigências comparadas para este tipo. `null` quando não houve. */
  from: string | null;
  fromLabel: string | null;
  to: string | null;
  toLabel: string | null;
  /**
   * As vigências **deste tipo** dentro do período, comparadas ou não.
   *
   * Vem por tipo porque é por tipo que ela existe: QLP vive noutra família de
   * dados, com identidade própria, e publica no calendário dele. Um bloco que
   * herdasse as datas do equipamento anunciaria uma comparação que não houve.
   */
  vigencias: { date: string; label: string }[];
  /** Por que este tipo não foi comparado. `null` quando foi. */
  reason: string | null;
  fleet: number;
  /** Atributos com valor na vigência mais recente deste tipo no período. */
  atributos: number;
  /** Destes, quantos continuam diferentes da ponta inicial. */
  alterados: number;
  /** E quantos se mexeram no caminho e voltaram ao valor inicial. */
  revertidos: number;
}

const round = (v: number) => Number(v.toFixed(2));

/**
 * Quantos ativos de cada tipo a vigência trouxe — a frota de um grupo.
 *
 * A mesma contagem de `getGroupedView`: entidades distintas com fato naquele
 * snapshot, por `entity_type`. Não é `snapshot.entity_count`, que soma os tipos
 * todos de uma vigência `CARRETA+CAVALO` e faria um grupo de cavalo medir-se
 * contra uma frota que inclui as carretas.
 */
async function frotaPorTipo(
  db: Database,
  snapshotId: string,
): Promise<Record<string, number>> {
  const { rows } = await db.execute<{ entity_type: string; fleet: number }>(sql`
    SELECT e.entity_type, count(DISTINCT f.entity_id)::int AS fleet
      FROM fact f
      JOIN entity e ON e.id = f.entity_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
     GROUP BY e.entity_type
  `);
  return Object.fromEntries(rows.map((r) => [r.entity_type, r.fleet]));
}

/**
 * O universo canônico do recorte, por equipamento.
 *
 * É o denominador de "X de Y mudaram", e a escolha dele é o que separa um
 * número honesto de um número decorativo. Três recusas:
 *
 * 1. **Não é o catálogo do Freightech.** O catálogo diz o que a fonte publica; o
 *    denominador tem de dizer o que este recorte tem. Contar contra o catálogo
 *    faria uma unidade que recebe metade das colunas parecer metade auditada.
 * 2. **Não é o número de linhas da tela.** "34 de 34" não informa nada.
 * 3. **Fato nulo não conta.** Uma coluna que chegou vazia para a frota inteira
 *    não é uma variável da remuneração daquela vigência — é assunto de Cobertura
 *    de dados —, e contá-la inflaria o denominador com colunas sem valor.
 *
 * Os tipos que existem no período **e não foram comparados** entram na lista com
 * `reason` preenchido e as vigências próprias à vista. É o caso do QLP, que vive
 * noutra família de dados e publica no calendário dele: o bloco tem de dizer que
 * não houve comparação, em vez de herdar as datas do equipamento e anunciar uma
 * que não houve.
 */
async function montarUniverso(
  db: Database,
  entrada: {
    context: SeriesContext;
    inicio: string;
    fim: string;
    comparados: Set<string>;
    byAttribute: AtributoNaPonta[];
  },
): Promise<UniversoDoTipo[]> {
  const { context, inicio, fim, comparados, byAttribute } = entrada;

  const { rows: vigencias } = await db.execute<{
    entity_type: string;
    effective_date: string;
    entity_type_set: string;
  }>(sql`
    SELECT t AS entity_type,
           s.effective_date::text AS effective_date,
           s.entity_type_set
      FROM snapshot s
      CROSS JOIN LATERAL unnest(string_to_array(s.entity_type_set, '+')) AS t
     WHERE s.effective_date >= ${inicio}::date
       AND s.effective_date <= ${fim}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2, 3
     ORDER BY 1, 2
  `);

  if (vigencias.length === 0) return [];

  /*
    O universo sai da vigência **mais recente** de cada tipo dentro do período,
    e não da ponta final da análise: um tipo que publicou pela última vez em
    maio não tem snapshot na ponta de agosto, e medir o universo dele lá daria
    zero — que se leria como "esta unidade não tem trechos".
  */
  const { rows: contagens } = await db.execute<{
    entity_type: string;
    atributos: number;
    fleet: number;
  }>(sql`
    WITH ultima AS (
      SELECT DISTINCT ON (t) t AS entity_type, s.id AS snapshot_id
        FROM snapshot s
        CROSS JOIN LATERAL unnest(string_to_array(s.entity_type_set, '+')) AS t
       WHERE s.effective_date >= ${inicio}::date
         AND s.effective_date <= ${fim}::date
         AND s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
       ORDER BY t, s.effective_date DESC, s.revision DESC
    )
    SELECT u.entity_type,
           count(DISTINCT f.attribute_id)::int AS atributos,
           count(DISTINCT f.entity_id)::int    AS fleet
      FROM ultima u
      JOIN fact f   ON f.snapshot_id = u.snapshot_id
      JOIN entity e ON e.id = f.entity_id AND e.entity_type = u.entity_type
     WHERE f.is_null = false
     GROUP BY 1
  `);
  const porTipo = new Map(contagens.map((c) => [c.entity_type, c]));

  const datasPorTipo = new Map<string, string[]>();
  const setsPorTipo = new Map<string, Set<string>>();
  for (const v of vigencias) {
    datasPorTipo.set(v.entity_type, [
      ...(datasPorTipo.get(v.entity_type) ?? []),
      v.effective_date,
    ]);
    setsPorTipo.set(
      v.entity_type,
      (setsPorTipo.get(v.entity_type) ?? new Set()).add(v.entity_type_set),
    );
  }

  return [...datasPorTipo.keys()].sort().map((entityType) => {
    const datas = datasPorTipo.get(entityType)!;
    const doTipo = byAttribute.filter((a) => a.entityType === entityType);
    const comparado = [...(setsPorTipo.get(entityType) ?? [])].some((s) =>
      comparados.has(s),
    );
    /*
      Comparado quer dizer: existe snapshot deste tipo nas **duas** pontas da
      análise. `comparados` já é o resultado dessa interseção — o que sobra aqui
      é dizer por que não, com as datas que o tipo de facto tem.
    */
    const temPontas = datas.includes(inicio) && datas.includes(fim);
    const reason =
      comparado && temPontas
        ? null
        : `Este equipamento não tem vigência nas duas pontas do período (${periodLabel(inicio)} e ${periodLabel(fim)}). ` +
          (datas.length === 0
            ? "Não há vigência dele no período."
            : `As vigências dele no período são ${datas.map(periodLabel).join(", ")}. Sem as duas pontas não há posição a comparar.`);

    return {
      entityType,
      equipment: equipmentLabel(entityType),
      from: reason === null ? inicio : null,
      fromLabel: reason === null ? periodLabel(inicio) : null,
      to: reason === null ? fim : null,
      toLabel: reason === null ? periodLabel(fim) : null,
      vigencias: datas.map((date) => ({ date, label: periodLabel(date) })),
      reason,
      fleet: porTipo.get(entityType)?.fleet ?? 0,
      atributos: porTipo.get(entityType)?.atributos ?? 0,
      alterados: doTipo.filter((a) => a.posicao === "DIFERENTE").length,
      revertidos: doTipo.filter((a) => a.posicao === "REVERTIDO").length,
    };
  });
}

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
  requestedContext?: RequestedContext,
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
      `buildGroup` usa a frota para dizer a cobertura do grupo, e a chave que ele
      consulta é (comparação, equipamento). Aqui não existe `change_set` — o nome
      da série ocupa o lugar da comparação, que é o que a chave significa nesta
      leitura: de qual arquivo aquele grupo veio.

      O equipamento é a outra metade, e ele **não** é dispensável. A série pode
      cobrir mais de um tipo (`CARRETA+CAVALO` é o caso real), e
      `snapshot.entity_count` conta os dois juntos: indexar só pela série faria a
      busca de `buildGroup` errar, cair no `?? 0`, e a frota desabar para o
      número de ativos do próprio grupo — cobertura `TOTAL` em tudo.
    */
    for (const [tipo, frota] of Object.entries(await frotaPorTipo(db, b.id))) {
      fleetByChangeSet.set(chaveDaFrota(serie, tipo), frota);
    }
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
        attribute_display_name: semantica?.attributeDisplayName ?? null,
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
  /*
    Os vínculos saem das pontas **finais** de cada série: é nelas que a leitura
    ponta a ponta pergunta quem puxa quem. Esta leitura não tem `change_set` —
    ela compara duas vigências que não se sucedem, sem gravar nada —, então os
    snapshots vêm de `deB` em vez de `snapshotsDosChangeSets`.
  */
  const dedup = criarDeduplicador(
    linhas.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(
      db,
      paresComparaveis.map((serie) => deB.get(serie)!.id),
    ),
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
      const group = buildGroup(bucket as never, fleetByChangeSet, dedup);
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

  /*
    As movimentações do caminho, por atributo.

    A consulta acima conta por (ativo, atributo), que é o grão de que a reversão
    precisa — e é grão errado para publicar "mexeu em N vigências": tomar o
    máximo por ativo devolve o maior número de vigências de **um** ativo, e não
    as vigências em que o atributo se mexeu. Se o ativo A mexeu em janeiro e o B
    em março, o máximo diz uma vigência e a resposta certa é duas.

    Daí a segunda agregação, no grão do atributo. É a contagem que a tela
    publica na coluna "no caminho", e ela sai daqui pronta: a interface não
    reconstrói contagem nenhuma.
  */
  const { rows: movimentos } = await db.execute<{
    attribute_code: string;
    vigencias: number;
    ativos: number;
  }>(sql`
    SELECT c.attribute_code,
           count(DISTINCT sb.effective_date)::int AS vigencias,
           count(DISTINCT c.entity_id)::int       AS ativos
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
     GROUP BY 1
  `);

  const movimentacaoPorAtributo = new Map<string, MovimentacaoNoPeriodo>(
    movimentos.map((m) => [
      m.attribute_code,
      { vigencias: m.vigencias, ativos: m.ativos },
    ]),
  );
  const semMovimento: MovimentacaoNoPeriodo = { vigencias: 0, ativos: 0 };

  const reverted = [...revertidoPorAtributo.entries()]
    .map(([attributeCode, dados]) => {
      const semantica = [...semanticsB.values()].find((c) => c.attributeCode === attributeCode);
      return {
        attributeCode,
        title: attributeLabel(
          attributeCode,
          semantica?.attributeName ?? attributeCode,
          semantica?.attributeDisplayName,
        ),
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
      const impact = summariseImpact(linhas as never, dedup);
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

  /*
    ---- a posição por (atributo × tipo) — o grão da tela ---------------------

    Duas autoridades, e nenhuma reescrita aqui:

    - **os valores e a abrangência** saem de `buildGroup` sobre a união das
      linhas do par. `groupKey` parte um atributo em mais de um grupo quando a
      comparabilidade ou a confiança do preço diferem, e a linha da tela é a
      união deles — recompor os totais somando grupos daria outro número;
    - **o dinheiro** sai de `summariseImpact` com o deduplicador da leitura
      inteira, exactamente como `byParameter`. É por periodicidade, porque um
      par pode ter mensal e anual, e um escalar afirmaria que se somam.
  */
  const linhasPorAtributo = new Map<string, LinhaCrua[]>();
  for (const linha of doCartao) {
    const chave = `${linha.attribute_code}|${linha.entity_type}`;
    const lista = linhasPorAtributo.get(chave) ?? [];
    lista.push(linha);
    linhasPorAtributo.set(chave, lista);
  }

  const gruposPorAtributo = new Map<string, ChangeGroup[]>();
  for (const entrada of entries) {
    const chave = `${entrada.attributeCode}|${entrada.entityType}`;
    gruposPorAtributo.set(chave, [
      ...(gruposPorAtributo.get(chave) ?? []),
      entrada.group,
    ]);
  }

  const diferentes: AtributoNaPonta[] = [...linhasPorAtributo.entries()].map(
    ([chave, linhas]) => {
      const grupo = buildGroup(linhas as never, fleetByChangeSet, dedup);
      const placement = placementOf(grupo.attributeCode);
      return {
        key: chave,
        attributeCode: grupo.attributeCode,
        entityType: grupo.entityType,
        equipment: grupo.equipment,
        title: grupo.title,
        parameterKey: placement.parameterKey,
        parameterName: placement.parameter,
        family: placement.family,
        unit: grupo.unit,
        posicao: "DIFERENTE" as const,
        vehicles: grupo.vehicles,
        fleet: grupo.fleet,
        coverage: grupo.coverage,
        coverageLabel: grupo.coverageLabel,
        aggregate: grupo.aggregate,
        dominantPattern: grupo.dominantPattern,
        patterns: grupo.patterns,
        impact: summariseImpact(linhas as never, dedup),
        foraDaSoma:
          grupo.impact.excludedMotivo === null
            ? null
            : {
                motivo: grupo.impact.excludedMotivo,
                explicacao: grupo.impact.excludedReason ?? "",
                ativos: grupo.impact.excludedVehicles,
                valor: grupo.impact.excludedAmount,
              },
        movimentacoes:
          (grupo.attributeCode === null
            ? undefined
            : movimentacaoPorAtributo.get(grupo.attributeCode)) ?? semMovimento,
        inconclusiveReason: grupo.inconclusiveReason,
        groups: gruposPorAtributo.get(chave) ?? [grupo],
      };
    },
  );

  /*
    O revertido é linha da tela, e não nota de rodapé.

    Ele não aparece em `entries` por definição — não está diferente das pontas —,
    e é precisamente o caso que a leitura de posição esconde sozinha: delta zero
    sobre um atributo que se mexeu quatro vezes no caminho. Sem linha própria, a
    tela diria "não mudou" de algo que mudou e voltou.
  */
  const revertidos: AtributoNaPonta[] = reverted.map((r) => {
    const semantica = [...semanticsB.values()].find(
      (c) => c.attributeCode === r.attributeCode,
    );
    const placement = placementOf(r.attributeCode);
    return {
      key: `${r.attributeCode}|${semantica?.entityType ?? null}`,
      attributeCode: r.attributeCode,
      entityType: semantica?.entityType ?? null,
      equipment: r.equipment,
      title: r.title,
      parameterKey: placement.parameterKey,
      parameterName: placement.parameter,
      family: placement.family,
      unit: semantica?.unit ?? null,
      posicao: "REVERTIDO" as const,
      // Zero ativos diferentes **hoje** — que é o que a coluna mede.
      vehicles: 0,
      fleet: 0,
      coverage: null,
      coverageLabel: null,
      aggregate: null,
      dominantPattern: null,
      patterns: 0,
      impact: summariseImpact([], dedup),
      foraDaSoma: null,
      movimentacoes: movimentacaoPorAtributo.get(r.attributeCode) ?? {
        vigencias: r.periods,
        ativos: r.entities,
      },
      inconclusiveReason: null,
      groups: [],
    };
  });

  const byAttribute = [...diferentes, ...revertidos].sort((a, b) => {
    const peso = (r: AtributoNaPonta) => {
      const valores = Object.values(r.impact.byPeriodicity).map(Math.abs);
      return valores.length === 0 ? 0 : Math.max(...valores);
    };
    const diferenca = peso(b) - peso(a);
    if (diferenca !== 0) return diferenca;
    if (b.vehicles !== a.vehicles) return b.vehicles - a.vehicles;
    return a.title.localeCompare(b.title, "pt-BR");
  });

  const universo = await montarUniverso(db, {
    context,
    inicio,
    fim,
    comparados: new Set(paresComparaveis),
    byAttribute,
  });

  const losses: Record<string, number> = {};
  const gains: Record<string, number> = {};
  for (const linha of doCartao) {
    if (linha.impact_confidence !== "CALCULATED" || linha.impact_amount === null) continue;
    if (dedup.foraDoTotal(daLinhaDoBanco(linha)) !== null) continue;
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
    impact: summariseImpact(doCartao as never, dedup),
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
    byAttribute,
    universo,
  };
}
