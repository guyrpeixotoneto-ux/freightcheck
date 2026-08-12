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
  | "SEM_SINAL";

export interface Anomaly {
  kind: string;
  sameInstant: boolean;
  differenceMs: number;
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
  semanticsStatus: string | null;
  semanticsLabel: string;
  unit: string | null;
  isMonetary: boolean | null;
  costClass: string | null;
  taxonomyName: string | null;
  inconclusiveReason: string | null;
  anomalies: Anomaly[];
  composition: { total: string; parts: string[]; evidence: string } | null;
  badge: Badge;
  badgeLabel: string;
}

export interface ImpactSummary {
  byPeriodicity: Record<string, number>;
  excludedByPeriodicity: Record<string, number>;
  excludedChanges: number;
  notCalculable: number;
  calculatedChanges: number;
}

export interface SeriesContext {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periods: number;
}

export interface GroupedView {
  /** De quem é esta vigência: unidade e canal. */
  context: SeriesContext;
  /** Os outros contextos no banco. Vazio enquanto houver uma unidade só. */
  otherContexts: SeriesContext[];
  period: string;
  periodLabel: string;
  periods: { date: string; label: string; series: string[] }[];
  series: {
    entityTypeSet: string;
    equipment: string;
    snapshotLabel: string;
    previousLabel: string | null;
    fleet: number;
    changeSetId: string | null;
    reason: string | null;
  }[];
  missingSeries: string[];
  complete: boolean;
  totals: {
    changes: number;
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
  excludedFromTotal: boolean;
  inconclusiveReason: string | null;
  anomaly: Omit<Anomaly, "vehicles"> | null;
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
