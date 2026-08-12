import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { indexChangedAttributesByEntity, isCoveredByParts } from "./composition";
import {
  FAMILIES,
  FAMILY_ORDER,
  placementOf,
  type FamilyCode,
} from "./families";
import {
  getGroupedView,
  loadChanges,
  summariseImpact,
  type ChangeGroup,
  type GroupedView,
  type ImpactSummary,
} from "./grouped";
import type { SeriesContext } from "./series";

/**
 * A vigência lida como o usuário do Freightech pensa: por família e parâmetro.
 *
 * Isto é **projeção**, e nada além disso. Não calcula comparação, não toca no
 * canônico, não reclassifica atributo nenhum: pega os grupos que a visão
 * agrupada já produz e os arruma nas gavetas que o cliente já conhece.
 *
 * Três regras herdadas, e nenhuma delas afrouxa aqui:
 *
 * 1. **Nunca somar entre periodicidades.** Uma família com R$/mês e R$/ano tem
 *    dois números, sempre.
 * 2. **Nunca ressuscitar a dupla contagem.** O índice de composição é montado
 *    sobre o conjunto **inteiro** da vigência e passado para cada fatia — ver
 *    `summariseImpact`.
 * 3. **Nada some.** Família sem alteração aparece dizendo "sem alterações";
 *    atributo que o mapa não conhece aparece em "Sem família".
 *
 * E uma regra nova, que é a razão de a tela existir: **a soma das famílias tem
 * de bater com o total da vigência, dentro de cada periodicidade.** Um
 * agrupamento cujas partes não fecham com o todo passa confiança falsa; há
 * teste para isso.
 */

export interface ParameterView {
  key: string;
  name: string;
  family: FamilyCode;
  /** Aviso quando a gaveta ainda depende de resposta do cliente. */
  pending: string | null;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  /** Os cartões de grupo — o nível 3, reaproveitado como está. */
  groups: ChangeGroup[];
}

export interface FamilyView {
  code: FamilyCode;
  name: string;
  origin: "FREIGHTECH" | "FREIGHTCHECK";
  note: string;
  /** Parâmetros desta família que o dicionário conhece, tenham mudado ou não. */
  parametersWithData: number;
  /** Destes, quantos mudaram nesta vigência. */
  parametersChanged: number;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  /** Grupos com selo DINHEIRO ou RUPTURA — o que a tela chama de crítico. */
  critical: number;
  /** Grupos monetários e somáveis travados por semântica não confirmada. */
  locked: number;
  parameters: ParameterView[];
}

export interface ExecutiveSummary {
  /** Já sem dupla contagem, e separado por periodicidade. */
  impact: ImpactSummary;
  /** Só o que reduz a remuneração, por periodicidade. Nunca somado ao ganho. */
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  changes: number;
  groups: number;
  critical: number;
  locked: number;
  notCalculable: number;
  vehiclesTouched: number;
  /** Parâmetros ordenados pelo maior impacto absoluto numa só periodicidade. */
  topParameters: {
    key: string;
    name: string;
    family: FamilyCode;
    familyName: string;
    changes: number;
    byPeriodicity: Record<string, number>;
  }[];
  /**
   * Veículos ordenados pelo mesmo critério.
   *
   * A ordenação usa o **maior valor absoluto dentro de uma periodicidade**, e
   * não uma soma entre elas — somar R$/mês com R$/ano para produzir um ranking
   * daria uma ordem que nenhuma das duas grandezas justifica.
   */
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
}

const round = (v: number) => Number(v.toFixed(2));

function emptyImpact(): ImpactSummary {
  return {
    byPeriodicity: {},
    excludedByPeriodicity: {},
    excludedChanges: 0,
    notCalculable: 0,
    calculatedChanges: 0,
  };
}

/**
 * Quantos parâmetros cada família tem **com atributo no dicionário**.
 *
 * É o denominador de "4 de 10 parâmetros", e é o que impede uma família vazia
 * de virar cartão: se o export não traz nenhum atributo dela, ela não existe
 * nesta tela — a nota de rodapé (`FREIGHTECH_SEM_DADO`) é onde ela é dita.
 */
async function parametersWithData(
  db: Database,
): Promise<Map<FamilyCode, Set<string>>> {
  const { rows } = await db.execute<{ code: string }>(sql`
    SELECT code FROM attribute
  `);
  const byFamily = new Map<FamilyCode, Set<string>>();
  for (const row of rows) {
    const placement = placementOf(row.code);
    const set = byFamily.get(placement.family) ?? new Set<string>();
    set.add(placement.parameterKey);
    byFamily.set(placement.family, set);
  }
  return byFamily;
}

export async function getFamiliesView(
  db: Database,
  period?: string,
  requestedContext?: Partial<SeriesContext>,
): Promise<FamiliesView | null> {
  const view = await getGroupedView(db, period, requestedContext);
  if (!view) return null;

  const changeSetIds = view.series
    .map((s) => s.changeSetId)
    .filter((id): id is string => id !== null);
  const rows = await loadChanges(db, changeSetIds);

  // Sobre o conjunto inteiro, uma vez só. Cada fatia recebe este índice.
  const changedByEntity = indexChangedAttributesByEntity(
    rows.map((r) => ({ entityId: r.entity_id, attributeCode: r.attribute_code })),
  );

  const inventory = await parametersWithData(db);

  // ---- grupos e linhas, arrumados por parâmetro ----------------------------
  const groupsByParameter = new Map<string, ChangeGroup[]>();
  for (const group of view.groups) {
    const key = placementOf(group.attributeCode).parameterKey;
    const list = groupsByParameter.get(key) ?? [];
    list.push(group);
    groupsByParameter.set(key, list);
  }

  const rowsByParameter = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = placementOf(row.attribute_code).parameterKey;
    const list = rowsByParameter.get(key) ?? [];
    list.push(row);
    rowsByParameter.set(key, list);
  }

  // ---- famílias -------------------------------------------------------------
  const families: FamilyView[] = [];
  for (const code of FAMILY_ORDER) {
    const definition = FAMILIES[code];
    const known = inventory.get(code);
    const touchedKeys = [...groupsByParameter.keys()].filter((k) => k.startsWith(`${code}|`));

    // Família sem atributo nenhum no dicionário e sem alteração nesta vigência
    // não é exibida: seria um cartão que promete um assunto que este export não
    // cobre. O que o Freightech publica e não vem aqui está em FREIGHTECH_SEM_DADO.
    if (!known && touchedKeys.length === 0) continue;

    const parameters: ParameterView[] = touchedKeys
      .map((key) => {
        const groups = groupsByParameter.get(key) ?? [];
        const parameterRows = rowsByParameter.get(key) ?? [];
        const placement = placementOf(groups[0]?.attributeCode ?? null);
        const vehicles = new Set(
          parameterRows.map((r) => r.entity_id).filter((v): v is string => v !== null),
        ).size;
        return {
          key,
          name: key.split("|").slice(1).join("|"),
          family: code,
          pending: placement.pending,
          changes: parameterRows.length,
          vehicles,
          impact: summariseImpact(parameterRows, changedByEntity),
          groups,
        };
      })
      .sort(compareParameters);

    const familyRows = touchedKeys.flatMap((k) => rowsByParameter.get(k) ?? []);
    const familyGroups = parameters.flatMap((p) => p.groups);

    families.push({
      code,
      name: definition.name,
      origin: definition.origin,
      note: definition.note,
      parametersWithData: known?.size ?? 0,
      parametersChanged: parameters.length,
      changes: familyRows.length,
      vehicles: new Set(
        familyRows.map((r) => r.entity_id).filter((v): v is string => v !== null),
      ).size,
      impact: familyRows.length > 0 ? summariseImpact(familyRows, changedByEntity) : emptyImpact(),
      critical: familyGroups.filter((g) => g.badge === "DINHEIRO" || g.badge === "RUPTURA").length,
      locked: familyGroups.filter((g) => g.badge === "TRAVADO").length,
      parameters,
    });
  }

  return { ...view, summary: buildSummary(view, families, rows, changedByEntity), families };
}

/** Maior impacto absoluto primeiro; sem impacto, mais alterações primeiro. */
function largestAbsolute(byPeriodicity: Record<string, number>): number {
  const values = Object.values(byPeriodicity).map(Math.abs);
  return values.length === 0 ? 0 : Math.max(...values);
}

function compareParameters(a: ParameterView, b: ParameterView): number {
  const impact =
    largestAbsolute(b.impact.byPeriodicity) - largestAbsolute(a.impact.byPeriodicity);
  if (impact !== 0) return impact;
  if (b.changes !== a.changes) return b.changes - a.changes;
  return a.name.localeCompare(b.name);
}

type Rows = Awaited<ReturnType<typeof loadChanges>>;

function buildSummary(
  view: GroupedView,
  families: FamilyView[],
  rows: Rows,
  changedByEntity: Map<string, Set<string>>,
): ExecutiveSummary {
  const losses: Record<string, number> = {};
  const gains: Record<string, number> = {};
  const byVehicle = new Map<
    string,
    { plate: string; entityType: string | null; changes: number; byPeriodicity: Record<string, number> }
  >();

  for (const row of rows) {
    const key = row.entity_id ?? `linha-${row.id}`;
    const entry =
      byVehicle.get(key) ??
      {
        plate: row.entity_label ?? "(sem placa)",
        entityType: row.entity_type,
        changes: 0,
        byPeriodicity: {} as Record<string, number>,
      };
    entry.changes++;
    byVehicle.set(key, entry);

    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) continue;
    // A mesma exclusão da soma da vigência: um total já contado nas parcelas
    // não entra em perdas, em ganhos, nem no ranking de veículos.
    if (isCoveredByParts(row.attribute_code, row.entity_id, changedByEntity)) continue;

    const bucket = row.impact_periodicity ?? "SEM_PERIODICIDADE";
    const amount = Number(row.impact_amount);
    if (amount < 0) losses[bucket] = (losses[bucket] ?? 0) + amount;
    else if (amount > 0) gains[bucket] = (gains[bucket] ?? 0) + amount;
    entry.byPeriodicity[bucket] = (entry.byPeriodicity[bucket] ?? 0) + amount;
  }

  const parameters = families.flatMap((f) =>
    f.parameters.map((p) => ({
      key: p.key,
      name: p.name,
      family: f.code,
      familyName: f.name,
      changes: p.changes,
      byPeriodicity: p.impact.byPeriodicity,
    })),
  );

  return {
    impact: view.impact,
    lossesByPeriodicity: Object.fromEntries(
      Object.entries(losses).map(([k, v]) => [k, round(v)]),
    ),
    gainsByPeriodicity: Object.fromEntries(
      Object.entries(gains).map(([k, v]) => [k, round(v)]),
    ),
    changes: view.totals.changes,
    groups: view.totals.groups,
    critical: families.reduce((sum, f) => sum + f.critical, 0),
    locked: families.reduce((sum, f) => sum + f.locked, 0),
    notCalculable: view.impact.notCalculable,
    vehiclesTouched: view.totals.vehiclesTouched,
    topParameters: parameters
      .filter((p) => largestAbsolute(p.byPeriodicity) > 0)
      .sort((a, b) => largestAbsolute(b.byPeriodicity) - largestAbsolute(a.byPeriodicity))
      .slice(0, 5),
    topVehicles: [...byVehicle.values()]
      .filter((v) => largestAbsolute(v.byPeriodicity) > 0)
      .sort((a, b) => largestAbsolute(b.byPeriodicity) - largestAbsolute(a.byPeriodicity))
      .slice(0, 5)
      .map((v) => ({
        ...v,
        byPeriodicity: Object.fromEntries(
          Object.entries(v.byPeriodicity).map(([k, amount]) => [k, round(amount)]),
        ),
      })),
  };
}
