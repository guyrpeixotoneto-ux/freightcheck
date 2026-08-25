/**
 * O contrato de `GET /changes/grouped`, do lado da tela.
 *
 * Espelha `lib/comparison/src/grouped.ts`. Fica escrito aqui, e não importado
 * do pacote, porque a interface é servida como bundle próprio e não deve
 * arrastar o cliente de banco junto — mas os nomes são os mesmos de propósito,
 * para que uma divergência apareça na revisão em vez de em produção.
 */

export type Badge =
  | "DINHEIRO"
  | "RUPTURA"
  | "COBERTURA"
  | "MOVIMENTO"
  | "TRAVADO"
  | "FORMATO"
  | "SEM_SINAL";

export interface Anomaly {
  kind: string;
  sameInstant: boolean;
  differenceMs: number;
  /**
   * Se esta linha é só troca de formato — mesmo instante, ou diferença menor
   * que a precisão que o serial do Excel não carrega.
   *
   * Vem pronto do servidor de propósito. A tela já derivou isto sozinha uma
   * vez, com um `differenceMs < 1000` escrito à mão ao lado de um limiar que
   * mora em `anomalies.ts`; bastava um dos dois mudar para a linha contradizer
   * o cartão logo acima dela.
   */
  formatOnly: boolean;
  interpretation: string;
  explanation: string;
  vehicles: number;
}

export interface ChangeGroup {
  key: string;
  attributeCode: string | null;
  title: string;
  entityType: string | null;
  equipment: string;
  changeType: string;
  category: string;
  comparability: string;
  /** Linhas de alteração no grupo. Não confundir com `vehicles`. */
  changes: number;
  vehicles: number;
  fleet: number;
  coverage: "TOTAL" | "MAIORIA" | "PARCIAL";
  coverageLabel: string;
  patterns: number;
  dominantPattern: { before: string | null; after: string | null; vehicles: number } | null;
  aggregate: {
    summable: boolean;
    aggregation: string | null;
    totalBefore: number | null;
    totalAfter: number | null;
    rowsInTotal: number;
    perVehicle: {
      numeratorBefore: number | null;
      numeratorAfter: number | null;
      denominator: number;
      averageBefore: number | null;
      averageAfter: number | null;
    } | null;
    deltaPercent: number | null;
    minPercent: number | null;
    maxPercent: number | null;
  };
  impact: {
    confidence: string;
    amount: number | null;
    periodicity: string | null;
    reason: string | null;
    countedVehicles: number;
    excludedVehicles: number;
    excludedAmount: number | null;
    excludedReason: string | null;
  };
  natures: string[];
  /** As naturezas como o motor as registrou — `ZEROING`, `TYPE_CHANGE`… */
  natureCodes: string[];
  semanticsStatus: string | null;
  semanticsLabel: string;
  unit: string | null;
  isMonetary: boolean | null;
  costClass: string | null;
  taxonomyName: string | null;
  inconclusiveReason: string | null;
  anomalies: Anomaly[];
  /** Se todas as linhas do grupo são troca de formato e nada mais. */
  formatOnly: boolean;
  composition: { total: string; parts: string[]; evidence: string } | null;
  badge: Badge;
  badgeLabel: string;
}

/*
  O tipo é o do servidor, e não uma cópia dele.

  A cópia que morava aqui declarava `excludedByPeriodicity`, um campo que o
  servidor deixou de enviar oito commits antes — e a tela caiu inteira no
  primeiro clique, com a suíte verde, porque os mocks testavam a cópia. Um
  `import type` é apagado na compilação (nada do servidor entra no bundle), e o
  typecheck passa a acusar o drift no commit em que ele nasce.
*/
export type { ResumoDeImpacto as ImpactSummary } from "@workspace/comparison/deduplicacao";
import type { ResumoDeImpacto as ImpactSummary } from "@workspace/comparison/deduplicacao";

/**
 * A unidade e canal de uma série — o mesmo `Contexto` de `lib/contextos.ts`.
 *
 * Era uma terceira cópia da forma, ao lado das de `pages/unidades.tsx` e
 * `components/layout/sidebar.tsx`. Três declarações da mesma resposta é a versão
 * de tipos do defeito que este alias fecha do lado do dado: nada obrigava as
 * três a concordarem, e a consulta que as alimenta é uma só. O nome fica, porque
 * é como as views de `/changes/grouped` chamam o campo.
 */
export type { Contexto as SeriesContext } from "@/lib/contextos";
import type { Contexto as SeriesContext } from "@/lib/contextos";

/*
  A composição da vigência — o que ela tem, por tipo — também vem do servidor.

  Mesma razão da linha acima: uma cópia aqui concordaria com o servidor no dia
  em que fosse escrita. O import é de tipo, e some na compilação; nada de
  `drizzle` entra no bundle por causa dele.
*/
export type {
  ComposicaoDaVigencia,
  TipoNaVigencia,
  VigenciaComTipo,
} from "@workspace/comparison/tipos-da-vigencia";
import type { ComposicaoDaVigencia } from "@workspace/comparison/tipos-da-vigencia";

export interface GroupedView {
  /** De quem é esta vigência: unidade e canal. */
  context: SeriesContext;
  /** Os outros contextos no banco. Vazio enquanto houver uma unidade só. */
  otherContexts: SeriesContext[];
  period: string;
  /** O rótulo já desambiguado dentro do contexto — ver `labels.ts` no servidor. */
  periodLabel: string;
  periods: {
    date: string;
    label: string;
    series: string[];
    /** O que aquela vigência contém, para o seletor não oferecer no escuro. */
    tipos: { code: string; rotulo: string; entidades: number }[];
  }[];
  /** O eixo "o quê": o que esta vigência tem, o que não tem, e onde o que falta está. */
  composicao: ComposicaoDaVigencia;
  series: {
    entityTypeSet: string;
    equipment: string;
    snapshotLabel: string;
    previousLabel: string | null;
    /** A vigência com que esta série foi comparada — a data, não o arquivo. */
    previousPeriod: string | null;
    previousPeriodLabel: string | null;
    fleet: number;
    changeSetId: string | null;
    reason: string | null;
  }[];
  missingSeries: string[];
  complete: boolean;
  totals: {
    changes: number;
    /** Quantas das `changes` são só troca de formato. Parcela, não subtração. */
    formatOnlyChanges: number;
    groups: number;
    vehiclesTouched: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    unchanged: number;
    inconclusive: number;
  };
  impact: ImpactSummary;
  accumulated: ImpactSummary & {
    comparisons: number;
    from: string | null;
    to: string | null;
  };
  groups: ChangeGroup[];
  /** A leitura executiva sobre estes mesmos grupos — espelha `lib/comparison/src/cockpit.ts`. */
  cockpit: CockpitView;
}

// ---------------------------------------------------------------------------
// Cockpit — espelho de `lib/comparison/src/cockpit.ts`
// ---------------------------------------------------------------------------

export type Severity = "CRITICO" | "ALTO" | "MEDIO" | "BAIXO";

export interface PriorityReason {
  label: string;
  points: number;
}

export interface PriorityItem {
  rank: number;
  /** A chave do grupo correspondente em `GroupedView.groups`. */
  key: string;
  severity: Severity;
  score: number;
  reasons: PriorityReason[];
  diagnosis: string;
  patternsSummary: string | null;
  sharePercent: number | null;
  shareLabel: string;
  hasImpact: boolean;
  hasAnomaly: boolean;
}

export interface SeverityBucket {
  severity: Severity;
  label: string;
  groups: number;
  changes: number;
}

export interface BadgeBucket {
  badge: Badge;
  label: string;
  groups: number;
  changes: number;
}

export interface EquipmentBucket {
  entityType: string | null;
  equipment: string;
  groups: number;
  changes: number;
  fleet: number | null;
}

export interface PricingSummary {
  calculatedChanges: number;
  excludedChanges: number;
  notCalculableChanges: number;
  lockedGroups: number;
  reasons: { reason: string; groups: number; changes: number }[];
}

export interface CockpitView {
  kpis: {
    changes: number;
    parameters: number;
    attention: number;
    vehicles: number;
    fleet: number;
    impact: ImpactSummary;
    hasImpact: boolean;
    anomalies: {
      groups: number;
      changes: number;
      formatOnlyGroups: number;
      formatOnlyChanges: number;
    };
  };
  /** Se esta vigência tem anterior com que comparar. */
  baseline: { hasBaseline: boolean; seriesWithoutBaseline: string[] };
  narrative: { headline: string; sentences: string[] };
  panorama: {
    bySeverity: SeverityBucket[];
    byBadge: BadgeBucket[];
    byEquipment: EquipmentBucket[];
    pricing: PricingSummary;
  };
  priorities: PriorityItem[];
  history: {
    comparisons: number;
    from: string | null;
    to: string | null;
    byPeriodicity: Record<string, number>;
    sufficient: boolean;
  };
}

/**
 * `GET /changes/families` — a vigência arrumada como o Freightech arruma.
 *
 * Estende `GroupedView`: os mesmos grupos, as mesmas regras de soma, mais o
 * resumo executivo e a árvore de famílias.
 */
export interface ParameterView {
  key: string;
  name: string;
  family: string;
  /** Aviso quando a gaveta depende de resposta do cliente. */
  pending: string | null;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  groups: ChangeGroup[];
}

export interface FamilyView {
  code: string;
  name: string;
  origin: "FREIGHTECH" | "FREIGHTCHECK";
  note: string;
  parametersWithData: number;
  parametersChanged: number;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  critical: number;
  locked: number;
  parameters: ParameterView[];
}

/**
 * Um parâmetro dentro de um dos dois lados do impacto — espelha
 * `ImpactContributor` em `lib/comparison/src/families-view.ts`.
 *
 * `amount` é a soma das linhas **daquele sinal**, e não o líquido do parâmetro:
 * o que subiu em oito ativos e caiu em dois aparece nos dois lados, com o
 * número de cada um.
 */
export interface ImpactContributor {
  key: string;
  name: string;
  family: string;
  familyName: string;
  changes: number;
  vehicles: number;
  amount: number;
}

export interface ImpactSide {
  /** Positivo no ganho, negativo na perda. */
  total: number;
  changes: number;
  vehicles: number;
  parameters: ImpactContributor[];
}

/** `net = gains.total + losses.total`, e cada total é a soma dos parâmetros dele. */
export interface ImpactSides {
  periodicity: string;
  net: number;
  gains: ImpactSide;
  losses: ImpactSide;
}

export interface ExecutiveSummary {
  impact: ImpactSummary;
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  /** Os dois lados abertos por parâmetro — a fonte dos dois campos acima. */
  sides: ImpactSides[];
  changes: number;
  groups: number;
  critical: number;
  locked: number;
  notCalculable: number;
  vehiclesTouched: number;
  topParameters: {
    key: string;
    name: string;
    family: string;
    familyName: string;
    changes: number;
    byPeriodicity: Record<string, number>;
  }[];
  topVehicles: {
    plate: string;
    entityType: string | null;
    changes: number;
    byPeriodicity: Record<string, number>;
  }[];
}

export interface FamiliesView extends GroupedView {
  summary: ExecutiveSummary;
  families: FamilyView[];
  /** O que o Freightech publica e este export não traz. Nota de rodapé. */
  freightechSemDado: { family: string; parameters: string[] }[];
}

/**
 * `GET /changes/families/overview` — a Visão Geral: soma de todas as
 * unidades com dado na competência pedida. Espelha `FamiliesOverview` em
 * `lib/comparison/src/families-view-overview.ts`.
 *
 * Não é um `FamiliesView`: não tem `families`/`groups`/`series` (a v1 não
 * mescla drill-down entre unidades), só o resumo executivo já somado e a
 * lista de quem entrou e quem ficou fora.
 */
export type MotivoExclusaoDaVisaoGeral =
  | "sem_vigencia_na_competencia"
  | "contextos_sobrepostos_ambiguos"
  | "vigencia_indisponivel_na_leitura";

export interface OverviewContextRef {
  scopeHash: string;
  channel: string | null;
  latestPeriod: string;
}

export interface OverviewUnitIncluded {
  unidade: string;
  label: string;
  contexts: OverviewContextRef[];
  /** Presente quando algum contexto elegível não pôde ser lido — nunca cobertura completa quando preenchido. */
  coberturaParcial?: {
    scopeHash: string;
    channel: string | null;
    motivo: "vigencia_indisponivel_na_leitura";
  }[];
}

export interface OverviewUnitExcluded {
  unidade: string;
  label: string;
  reason: MotivoExclusaoDaVisaoGeral;
  contexts: OverviewContextRef[];
  conflito?: { scopeHash: string; entradas: string[] }[];
}

export interface FamiliesOverview {
  period: string;
  summary: ExecutiveSummary;
  unitsIncluded: OverviewUnitIncluded[];
  unitsExcluded: OverviewUnitExcluded[];
}

export interface GroupVehicle {
  changeId: number;
  plate: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  numericBefore: number | null;
  numericAfter: number | null;
  deltaPercent: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactConfidence: string;
  /**
   * Por que este ativo ficou fora da soma — `null` quando ele entra.
   *
   * A linha **continua na lista**: o que ela perde é o lugar no total, não a
   * visibilidade. O motivo viaja junto para que o selo diga onde o dinheiro foi
   * contado, em vez de deixar quem confere procurando um valor que sumiu.
   */
  foraDoTotal: {
    motivo: "COBERTO_POR_PARCELAS" | "ESCOPO_DE_CONJUNTO";
    representadoPor: string;
    explicacao: string;
  } | null;
  inconclusiveReason: string | null;
  anomaly: Omit<Anomaly, "vehicles"> | null;
  /**
   * De qual vigência veio cada lado desta linha.
   *
   * Por linha porque a comparação é da série: cavalo e carreta terminam na
   * mesma vigência e podem ter começado em vigências diferentes.
   */
  periodBefore: string;
  periodAfter: string;
  periodBeforeLabel: string;
  periodAfterLabel: string;
}

export interface AttributeSeries {
  attributeCode: string;
  title: string;
  aggregation: string | null;
  summable: boolean;
  averageable: boolean;
  unit: string | null;
  periodicity: string | null;
  semanticsStatus: string;
  note: string;
  points: {
    effectiveDate: string;
    periodLabel: string;
    sourceLabel: string;
    vehicles: number;
    numericVehicles: number;
    total: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  }[];
}
