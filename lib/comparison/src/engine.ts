import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  changeSetTable,
  changeTable,
  snapshotTable,
} from "@workspace/db";
import {
  loadAttributeClassifications,
  loadAttributeClassificationsAt,
  type AttributeClassification,
} from "./classification";
import { assessImpact } from "./impact";
import { channelOf, channelSql } from "./series";
import {
  criarDeduplicador,
  resumirImpacto,
  type LinhaDeMudanca,
  type RastroDaDeducao,
  type ResumoDeImpacto,
} from "./deduplicacao";
import { carregarVinculosDeConjunto } from "./vinculos";

/**
 * The comparison engine.
 *
 * Three axes, kept apart because conflating them hides both:
 *   SOURCE_CHANGE  — a value the Ambev sent changed, on an asset present in both
 *   FLEET_CHANGE   — an asset entered or left the fleet
 *   LAYOUT_CHANGE  — a column appeared in or vanished from the export
 *
 * Matching is always by `(entity_id, attribute_id)` — stable semantic identity,
 * never row position. A plate that moves from row 374 to row 436 between
 * exports is the same asset, and the engine says so.
 */

export interface ComputeOptions {
  computedBy?: string;
  /** Recompute even when a set already exists for this pair. */
  force?: boolean;
}

export interface ChangeSetSummary {
  id: string;
  snapshotAId: string;
  snapshotBId: string;
  snapshotALabel: string;
  snapshotBLabel: string;
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  unchanged: number;
  inconclusive: number;
  semanticsChanges: number;
  /**
   * O impacto, por periodicidade. Nunca um total único: mensal e anual não se
   * somam. Ver {@link ImpactoDoChangeSet}.
   */
  impacto: ImpactoDoChangeSet;
  impactNotCalculable: number;
}

/**
 * O impacto de uma comparação: **dois números e um rastro**.
 *
 * `oficial` é a verdade financeira, e é o único que uma tela, um consolidado ou
 * uma exportação pode publicar como "Impacto apurado". `bruto` é conferência
 * técnica. `rastro` explica a distância entre os dois — é texto de auditoria, e
 * não um terceiro valor: nenhum consumidor financeiro lê subtotal de dentro
 * dele.
 */
export interface ImpactoDoChangeSet {
  oficial: Record<string, number>;
  bruto: Record<string, number>;
  rastro: RastroDaDeducao;
  mudancasForaDoTotal: number;
}

/**
 * The snapshot a given one should be compared against: the most recent live
 * snapshot, of the same source, scope, **channel** and entity coverage, that
 * precedes it.
 *
 * Superseded revisions are excluded on purpose — comparing against a snapshot
 * that has itself been replaced would report differences that no longer stand.
 *
 * The channel joined the key when the label parser stopped being hard-coded to
 * `EMPURRADA`. Without it, the first vigência of a second channel would pick
 * the other channel's previous vigência as its baseline — same unit, same
 * coverage, a different remuneration — and every asset would look changed.
 */
export async function findPreviousSnapshot(
  db: Database,
  snapshotId: string,
): Promise<string | null> {
  const [target] = await db
    .select()
    .from(snapshotTable)
    .where(eq(snapshotTable.id, snapshotId));
  if (!target) throw new Error(`Snapshot ${snapshotId} não encontrado.`);

  const [previous] = await db
    .select({ id: snapshotTable.id })
    .from(snapshotTable)
    .where(
      and(
        eq(snapshotTable.sourceSystem, target.sourceSystem),
        eq(snapshotTable.scopeHash, target.scopeHash),
        eq(snapshotTable.entityTypeSet, target.entityTypeSet),
        sql`${channelSql("snapshot.source_label")} IS NOT DISTINCT FROM ${channelOf(target.sourceLabel)}::text`,
        sql`${snapshotTable.status} <> 'SUPERSEDED'`,
        sql`${snapshotTable.effectiveDate} < ${target.effectiveDate}`,
      ),
    )
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(1);

  return previous?.id ?? null;
}

interface PairedFact extends Record<string, unknown> {
  entity_id: string;
  attribute_id: string;
  entity_label: string | null;
  fact_a_id: number | null;
  fact_b_id: number | null;
  a_numeric: string | null;
  a_text: string | null;
  a_boolean: boolean | null;
  a_date: string | null;
  a_is_null: boolean | null;
  a_null_reason: string | null;
  b_numeric: string | null;
  b_text: string | null;
  b_boolean: boolean | null;
  b_date: string | null;
  b_is_null: boolean | null;
  b_null_reason: string | null;
}

/**
 * Compare two snapshots and persist the result.
 *
 * Idempotent by construction: a change set for a pair is dropped and rebuilt,
 * so recomputing never accumulates. Comparing a snapshot with an identical
 * twin — the same vigência re-imported as a new revision — yields zero
 * changes, which is the property that keeps a re-import from inventing news.
 */
export async function computeChangeSet(
  db: Database,
  snapshotAId: string,
  snapshotBId: string,
  options: ComputeOptions = {},
): Promise<ChangeSetSummary> {
  const [a] = await db.select().from(snapshotTable).where(eq(snapshotTable.id, snapshotAId));
  const [b] = await db.select().from(snapshotTable).where(eq(snapshotTable.id, snapshotBId));
  if (!a) throw new Error(`Snapshot A (${snapshotAId}) não encontrado.`);
  if (!b) throw new Error(`Snapshot B (${snapshotBId}) não encontrado.`);
  if (a.id === b.id) throw new Error("Um snapshot não se compara consigo mesmo.");

  // Comparing across different scopes or different equipment coverage would
  // produce differences that mean nothing — every asset would look added or
  // removed. Refuse rather than emit noise.
  if (a.scopeHash !== b.scopeHash) {
    throw new Error(
      `Escopos diferentes: "${a.sourceLabel}" e "${b.sourceLabel}" cobrem unidades/operadores distintos e não são comparáveis.`,
    );
  }
  if (a.entityTypeSet !== b.entityTypeSet) {
    throw new Error(
      `Coberturas diferentes: "${a.sourceLabel}" cobre ${a.entityTypeSet} e "${b.sourceLabel}" cobre ${b.entityTypeSet}.`,
    );
  }
  // O canal é parte do rótulo da vigência, não do escopo: duas vigências da
  // mesma unidade podem vir de canais diferentes e descrever remunerações que
  // não se sucedem. Comparar as duas produziria uma diferença sem significado.
  const channelA = channelOf(a.sourceLabel);
  const channelB = channelOf(b.sourceLabel);
  if (channelA !== channelB) {
    throw new Error(
      `Canais diferentes: "${a.sourceLabel}" é do canal ${channelA ?? "não identificado"} e ` +
        `"${b.sourceLabel}" é do canal ${channelB ?? "não identificado"}. ` +
        `Uma vigência só se compara com outra do mesmo canal.`,
    );
  }

  const existing = await db
    .select()
    .from(changeSetTable)
    .where(
      and(
        eq(changeSetTable.snapshotAId, snapshotAId),
        eq(changeSetTable.snapshotBId, snapshotBId),
      ),
    );
  /*
    `status === "DONE"` e não só "existe": a migração 0032 marcou como `STALE`
    toda comparação gravada antes de o impacto oficial existir. Sem esta
    condição elas ficariam com `impacto_oficial_by_periodicity = {}` para
    sempre, e as telas leriam zero — que é pior do que o número inflado que
    esta mudança veio corrigir.
  */
  if (existing.length > 0 && existing[0].status === "DONE" && !options.force) {
    return toSummary(existing[0], a.sourceLabel, b.sourceLabel);
  }

  // Each side is read with the semantics that were in force on its own
  // vigência. Comparing Dez/2025 against Jan/2026 must use what those columns
  // meant then, not what they mean today.
  const semanticsA = await loadAttributeClassificationsAt(db, a.effectiveDate);
  const semanticsB = await loadAttributeClassificationsAt(db, b.effectiveDate);
  const classifications = semanticsB;

  return db.transaction(async (tx) => {
    if (existing.length > 0) {
      // Derived data: replaced wholesale rather than patched.
      await tx.delete(changeSetTable).where(eq(changeSetTable.id, existing[0].id));
    }

    const [set] = await tx
      .insert(changeSetTable)
      .values({
        snapshotAId,
        snapshotBId,
        status: "PENDING",
        computedBy: options.computedBy ?? null,
      })
      .returning();

    /*
      Os eixos 1 e 2 são calculados fora daqui, por `diffSnapshots`, e só então
      gravados. A extração não mudou uma vírgula do cálculo — mudou quem pode
      chamá-lo: a leitura ponta a ponta compara duas vigências que **não** se
      sucedem e precisa exatamente desta conta, sem gravar nada. Gravar um
      `change_set` de abril contra agosto seria pior do que duplicar código: a
      tela de agosto o apanharia pelo `snapshot_b` e somaria oito meses de
      movimento ao total de um mês.
    */
    const diff = await diffSnapshots(tx, a, b, semanticsA, semanticsB);
    const rows: (typeof changeTable.$inferInsert)[] = diff.changes.map((linha) => ({
      ...linha,
      changeSetId: set.id,
    }));
    const { unchanged, inconclusive, entitiesAdded, entitiesRemoved, impacto } = diff;
    let impactNotCalculable = diff.impactNotCalculable;

    // ---------------------------------------------------------------------
    // Axis 3b — the source changed what a column means
    //
    // One row per attribute, not one per asset. Only versions born of a
    // SOURCE_SEMANTICS_CHANGE surface here: a curation correction is us fixing
    // our own understanding, and reporting it as an Ambev change would
    // announce a contract change that never happened.
    // ---------------------------------------------------------------------
    const { rows: semanticsChanges } = await tx.execute<{
      attribute_id: string;
      version_before: number;
      version_after: number;
      field: string;
      value_before: string | null;
      value_after: string | null;
      reason: string | null;
    }>(sql`
      WITH was AS (
        SELECT * FROM attribute_semantics
         WHERE effective_from <= ${a.effectiveDate}::date
           AND (effective_until IS NULL OR ${a.effectiveDate}::date < effective_until)
      ),
      is_now AS (
        SELECT * FROM attribute_semantics
         WHERE effective_from <= ${b.effectiveDate}::date
           AND (effective_until IS NULL OR ${b.effectiveDate}::date < effective_until)
      )
      SELECT was.attribute_id,
             was.version    AS version_before,
             is_now.version AS version_after,
             field.name     AS field,
             field.before   AS value_before,
             field.after    AS value_after,
             is_now.supersede_reason AS reason
        FROM was
        JOIN is_now ON is_now.attribute_id = was.attribute_id
        CROSS JOIN LATERAL (
          VALUES
            ('unit', was.unit, is_now.unit),
            ('periodicity', was.periodicity, is_now.periodicity),
            ('aggregation', was.aggregation, is_now.aggregation),
            ('is_monetary', was.is_monetary::text, is_now.is_monetary::text),
            ('calculation_basis', was.calculation_basis, is_now.calculation_basis)
        ) AS field(name, before, after)
       WHERE was.version <> is_now.version
         AND is_now.change_origin = 'SOURCE_SEMANTICS_CHANGE'
         AND field.before IS DISTINCT FROM field.after
    `);

    let semanticsChanged = 0;
    for (const row of semanticsChanges) {
      const classification = classifications.get(row.attribute_id);
      semanticsChanged++;
      impactNotCalculable++;
      rows.push({
        changeSetId: set.id,
        category: "SEMANTICS_CHANGE",
        changeType: "SEMANTICS_CHANGED",
        nature: row.field.toUpperCase(),
        attributeId: row.attribute_id,
        valueBefore: row.value_before,
        valueAfter: row.value_after,
        semanticsVersionA: row.version_before,
        semanticsVersionB: row.version_after,
        comparability: "COMPARABLE",
        impactConfidence: "NOT_CALCULABLE",
        impactReason:
          "Mudança de significado, não de valor. O que ela custa depende de reinterpretar " +
          "a série inteira, e isso não se resolve como diferença entre dois números.",
        inconclusiveReason: row.reason,
        ...(classification ? classificationColumns(classification) : {}),
      });
    }

    // ---------------------------------------------------------------------
    // Axis 4 — layout: a column that appeared or vanished
    // ---------------------------------------------------------------------
    const { rows: layout } = await tx.execute<{
      attribute_id: string;
      direction: string;
    }>(sql`
      WITH la AS (SELECT attribute_id FROM snapshot_attribute WHERE snapshot_id = ${snapshotAId}),
           lb AS (SELECT attribute_id FROM snapshot_attribute WHERE snapshot_id = ${snapshotBId})
      SELECT COALESCE(la.attribute_id, lb.attribute_id) AS attribute_id,
             CASE WHEN la.attribute_id IS NULL THEN 'ADDED' ELSE 'REMOVED' END AS direction
        FROM la
        FULL OUTER JOIN lb ON lb.attribute_id = la.attribute_id
       WHERE la.attribute_id IS NULL OR lb.attribute_id IS NULL
    `);

    let attributesAdded = 0;
    let attributesRemoved = 0;
    for (const row of layout) {
      const classification = classifications.get(row.attribute_id);
      if (row.direction === "ADDED") attributesAdded++;
      else attributesRemoved++;
      impactNotCalculable++;
      rows.push({
        changeSetId: set.id,
        category: "LAYOUT_CHANGE",
        changeType: row.direction === "ADDED" ? "ATTRIBUTE_ADDED" : "ATTRIBUTE_REMOVED",
        nature: row.direction === "ADDED" ? "APPEARED" : "DISAPPEARED",
        attributeId: row.attribute_id,
        valueBefore: row.direction === "ADDED" ? null : "no layout",
        valueAfter: row.direction === "ADDED" ? "no layout" : null,
        comparability: "COMPARABLE",
        impactConfidence: "NOT_CALCULABLE",
        impactReason:
          row.direction === "ADDED"
            ? "Coluna nova: não há valor anterior com que comparar."
            : "Coluna deixou de vir no export: não há valor novo com que comparar.",
        ...(classification ? classificationColumns(classification) : {}),
      });
    }

    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(changeTable).values(rows.slice(i, i + 1000));
    }

    const [updated] = await tx
      .update(changeSetTable)
      .set({
        status: "DONE",
        valueChanges: rows.filter((r) => r.category === "SOURCE_CHANGE").length,
        entitiesAdded,
        entitiesRemoved,
        attributesAdded,
        attributesRemoved,
        unchanged,
        inconclusive,
        semanticsChanges: semanticsChanged,
        /*
          Dois números no domínio, e um rastro que explica a distância.
          `impacto_oficial_by_periodicity` é o que as telas publicam;
          `impacto_bruto_by_periodicity` é conferência técnica e não aparece
          rotulado como "Impacto apurado" em lugar nenhum. Os subtotais
          intermediários vivem em `deducao_rastro` — são explicação, não valor.
        */
        impactoBrutoByPeriodicity: roundBuckets(impacto.brutoByPeriodicity),
        impactoOficialByPeriodicity: roundBuckets(impacto.byPeriodicity),
        /*
          O cast é a fronteira entre os pacotes, e não uma folga de tipo:
          `@workspace/db` não pode importar `@workspace/comparison` (a
          dependência é ao contrário), então a coluna é declarada como jsonb
          genérico e a forma real — `RastroDaDeducao` — é garantida aqui, no
          único lugar que escreve nela.
        */
        deducaoRastro: impacto.rastro as unknown as Record<string, unknown>,
        mudancasForaDoTotal: impacto.excludedChanges,
        impactNotCalculable,
      })
      .where(eq(changeSetTable.id, set.id))
      .returning();

    return toSummary(updated, a.sourceLabel, b.sourceLabel);
  });
}

/**
 * Os dois eixos que comparam duas vigências: valores e movimento de frota.
 *
 * Isto era o miolo de `computeChangeSet` e continua sendo — a extração não
 * mexeu no cálculo, só o desamarrou da gravação. Existem dois leitores agora:
 *
 * - `computeChangeSet`, que grava o resultado como `change_set` da vigência —
 *   comparar continua sendo ato de importação;
 * - a leitura **ponta a ponta**, que compara duas vigências que não se sucedem
 *   (abril contra agosto) e **não grava nada**. Gravar aquele par seria pior do
 *   que duplicar esta função: a tela de agosto o apanharia pelo `snapshot_b` e
 *   somaria oito meses de movimento ao total de um mês.
 *
 * Uma função, dois usos, uma verdade só. Reescrever a comparação para a
 * segunda tela é como se produzem dois números que discordam sem que ninguém
 * saiba qual está certo.
 */
export type ComputedChange = Omit<typeof changeTable.$inferInsert, "changeSetId">;

export interface SnapshotDiff {
  changes: ComputedChange[];
  unchanged: number;
  inconclusive: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  /**
   * O impacto nas três leituras, já deduplicado.
   *
   * Não é mais um acumulador do laço. As duas regras de dupla contagem são por
   * ativo — "as parcelas deste total mudaram neste veículo?", "o cavalo
   * vinculado mexeu na coluna que esta embute?" — e nenhuma das duas tem
   * resposta enquanto o laço ainda está descobrindo o que mudou. Era essa a
   * causa raiz: o motor somava cedo demais para poder aplicar a regra, e por
   * isso não aplicava nenhuma.
   */
  impacto: ResumoDeImpacto;
  impactNotCalculable: number;
}

export async function diffSnapshots(
  /** `db` ou a transação de `computeChangeSet` — as duas sabem executar SQL. */
  executor: Pick<Database, "execute">,
  a: { id: string; effectiveDate: string },
  b: { id: string; effectiveDate: string },
  /** A semântica vigente em cada ponta, lida na data de cada uma. */
  semanticsA: Map<string, AttributeClassification>,
  semanticsB: Map<string, AttributeClassification>,
): Promise<SnapshotDiff> {
  const rows: ComputedChange[] = [];
  let unchanged = 0;
  let inconclusive = 0;
  /*
    As linhas com preço, guardadas com o **código** do atributo, para o segundo
    passo. O `ComputedChange` carrega `attributeId` (uuid) porque é o que a
    tabela grava; a regra de composição fala em códigos (`carreta.custo_fixo`),
    e a tradução existe aqui dentro do laço, onde a classificação está à mão.
  */
  const paraDeduplicar: LinhaDeMudanca[] = [];
  let impactNotCalculable = 0;

  // ---------------------------------------------------------------------
  // Axis 1 — values, on assets present in both snapshots
  // ---------------------------------------------------------------------
  const { rows: paired } = await executor.execute<PairedFact>(sql`
    WITH fa AS (
      SELECT f.*, i.identifier_value AS entity_label
        FROM fact f
        LEFT JOIN entity_identifier i
          ON i.entity_id = f.entity_id
         AND i.identifier_type = 'PLACA'
         AND i.is_current
       WHERE f.snapshot_id = ${a.id}
    ),
    fb AS (
      SELECT f.*, i.identifier_value AS entity_label
        FROM fact f
        LEFT JOIN entity_identifier i
          ON i.entity_id = f.entity_id
         AND i.identifier_type = 'PLACA'
         AND i.is_current
       WHERE f.snapshot_id = ${b.id}
    )
    SELECT COALESCE(fa.entity_id, fb.entity_id)       AS entity_id,
           COALESCE(fa.attribute_id, fb.attribute_id) AS attribute_id,
           COALESCE(fa.entity_label, fb.entity_label) AS entity_label,
           fa.id AS fact_a_id, fb.id AS fact_b_id,
           fa.value_numeric AS a_numeric, fa.value_text AS a_text,
           fa.value_boolean AS a_boolean, fa.value_date::text AS a_date,
           fa.is_null AS a_is_null, fa.null_reason AS a_null_reason,
           fb.value_numeric AS b_numeric, fb.value_text AS b_text,
           fb.value_boolean AS b_boolean, fb.value_date::text AS b_date,
           fb.is_null AS b_is_null, fb.null_reason AS b_null_reason
      FROM fa
      FULL OUTER JOIN fb
        ON fb.entity_id = fa.entity_id
       AND fb.attribute_id = fa.attribute_id
  `);

  for (const row of paired) {
    const classification = semanticsB.get(row.attribute_id);
    if (!classification) continue;

    // An asset present on only one side is a fleet movement, reported once
    // on its own axis below — not as ~70 value changes.
    if (row.fact_a_id === null || row.fact_b_id === null) continue;

    const before = describeSide(row, "a");
    const after = describeSide(row, "b");

    if (before.hash === after.hash) {
      unchanged++;
      continue;
    }

    const wasSemantics = semanticsA.get(row.attribute_id);
    const isSemantics = semanticsB.get(row.attribute_id);
    const drift = detectSemanticsDrift(wasSemantics, isSemantics);

    // A drift that changes what the number *is* makes the two sides
    // incomparable, whatever the values say. Without this, a column that
    // turns annual reads as an 1.100% rise across the whole fleet.
    const verdict = drift
      ? {
          nature: "SEMANTICS_DRIFT",
          delta: null,
          deltaPercent: null,
          comparability: "INCONCLUSIVE" as const,
          inconclusiveReason: drift,
        }
      : classifyChange(before, after, classification);
    if (verdict.comparability === "INCONCLUSIVE") inconclusive++;

    const impact = assessImpact({
      classification,
      numericBefore: before.numeric,
      numericAfter: after.numeric,
      comparable: verdict.comparability === "COMPARABLE",
    });
    if (impact.confidence !== "CALCULATED" || impact.amount === null) impactNotCalculable++;
    paraDeduplicar.push({
      attributeCode: classification.attributeCode,
      entityId: row.entity_id,
      impactConfidence: impact.confidence,
      impactAmount: impact.amount,
      impactPeriodicity: impact.periodicity,
    });

    rows.push({
      category: "SOURCE_CHANGE",
      changeType: "VALUE_CHANGED",
      nature: verdict.nature,
      entityId: row.entity_id,
      attributeId: row.attribute_id,
      factAId: row.fact_a_id,
      factBId: row.fact_b_id,
      valueBefore: before.display,
      valueAfter: after.display,
      numericBefore: before.numeric === null ? null : String(before.numeric),
      numericAfter: after.numeric === null ? null : String(after.numeric),
      isNullBefore: before.isNull,
      isNullAfter: after.isNull,
      nullReasonBefore: before.nullReason,
      nullReasonAfter: after.nullReason,
      deltaAbsolute: verdict.delta === null ? null : String(verdict.delta),
      deltaPercent: verdict.deltaPercent === null ? null : String(verdict.deltaPercent),
      comparability: verdict.comparability,
      inconclusiveReason: verdict.inconclusiveReason,
      impactConfidence: impact.confidence,
      impactAmount: impact.amount === null ? null : String(impact.amount),
      impactPeriodicity: impact.periodicity,
      impactReason: impact.reason,
      ...classificationColumns(classification),
      semanticsVersionA: wasSemantics?.semanticsVersion ?? null,
      semanticsVersionB: isSemantics?.semanticsVersion ?? null,
      entityLabel: row.entity_label,
    });
  }

  // ---------------------------------------------------------------------
  // Axis 2 — fleet movement
  // ---------------------------------------------------------------------
  const { rows: fleet } = await executor.execute<{
    entity_id: string;
    entity_label: string | null;
    entity_type: string;
    direction: string;
  }>(sql`
    WITH ea AS (SELECT DISTINCT entity_id FROM fact WHERE snapshot_id = ${a.id}),
         eb AS (SELECT DISTINCT entity_id FROM fact WHERE snapshot_id = ${b.id})
    SELECT COALESCE(ea.entity_id, eb.entity_id) AS entity_id,
           i.identifier_value AS entity_label,
           e.entity_type,
           CASE WHEN ea.entity_id IS NULL THEN 'ADDED' ELSE 'REMOVED' END AS direction
      FROM ea
      FULL OUTER JOIN eb ON eb.entity_id = ea.entity_id
      JOIN entity e ON e.id = COALESCE(ea.entity_id, eb.entity_id)
      LEFT JOIN entity_identifier i
        ON i.entity_id = e.id AND i.identifier_type = 'PLACA' AND i.is_current
     WHERE ea.entity_id IS NULL OR eb.entity_id IS NULL
  `);

  let entitiesAdded = 0;
  let entitiesRemoved = 0;
  for (const row of fleet) {
    if (row.direction === "ADDED") entitiesAdded++;
    else entitiesRemoved++;
    impactNotCalculable++;
    rows.push({
      category: "FLEET_CHANGE",
      changeType: row.direction === "ADDED" ? "ENTITY_ADDED" : "ENTITY_REMOVED",
      nature: row.direction === "ADDED" ? "APPEARED" : "DISAPPEARED",
      entityId: row.entity_id,
      valueBefore: row.direction === "ADDED" ? null : "presente",
      valueAfter: row.direction === "ADDED" ? "presente" : null,
      comparability: "COMPARABLE",
      impactConfidence: "NOT_CALCULABLE",
      impactReason:
        "Entrada e saída de ativo mudam a base da frota. O valor disso depende de " +
        "quais atributos são somáveis, o que ainda depende de curadoria.",
      entityLabel: row.entity_label,
      entityType: row.entity_type,
    });
  }

  /*
    O segundo passo — e a razão de ele existir.

    Aqui o laço já acabou, então já se sabe **tudo** o que mudou em cada ativo.
    É a informação que as duas regras de dupla contagem exigem e que não existia
    lá dentro. O vínculo do conjunto é lido na vigência B, e não do cadastro
    atual: uma carreta troca de cavalo entre um mês e outro, e deduplicar março
    com o par de hoje atribuiria o dinheiro ao conjunto errado.
  */
  const vinculos = await carregarVinculosDeConjunto(executor, [b.id]);
  const impacto = resumirImpacto(
    paraDeduplicar,
    criarDeduplicador(paraDeduplicar, vinculos),
  );

  return {
    changes: rows,
    unchanged,
    inconclusive,
    entitiesAdded,
    entitiesRemoved,
    impacto,
    impactNotCalculable,
  };
}

/** Six decimals, matching the NUMERIC(18,6) the values came from. */
function roundBuckets(buckets: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(buckets)) {
    out[key] = Number(value.toFixed(6));
  }
  return out;
}

/**
 * Whether the meaning of a column moved between the two vigências, in a way
 * that makes the values incomparable.
 *
 * Unit, periodicity, monetary nature and calculation basis all change what the
 * number *is*. Aggregation and taxonomy change what we do with it afterwards,
 * so a difference there leaves the values comparable — the impact policy deals
 * with the rest.
 *
 * Returns the sentence to show, or null when nothing relevant moved.
 */
export function detectSemanticsDrift(
  before: AttributeClassification | undefined,
  after: AttributeClassification | undefined,
): string | null {
  if (!before || !after) return null;
  if (before.semanticsVersion == null || after.semanticsVersion == null) return null;
  if (before.semanticsVersion === after.semanticsVersion) return null;

  const say = (v: unknown) => (v === null || v === undefined ? "indefinido" : String(v));

  if (before.unit !== after.unit) {
    return (
      `A unidade mudou de ${say(before.unit)} para ${say(after.unit)} entre as duas vigências. ` +
      `A diferença numérica não representa variação real.`
    );
  }
  if (before.periodicity !== after.periodicity) {
    return (
      `A periodicidade mudou de ${say(before.periodicity)} para ${say(after.periodicity)} entre as ` +
      `duas vigências. Comparar os valores diretamente diria que o custo mudou quando mudou a base.`
    );
  }
  if (before.isMonetary !== after.isMonetary) {
    return (
      `A natureza mudou: ${before.isMonetary ? "era" : "não era"} montante financeiro e agora ` +
      `${after.isMonetary ? "é" : "não é"}. Não há variação a calcular entre naturezas diferentes.`
    );
  }
  if ((before.calculationBasis ?? null) !== (after.calculationBasis ?? null)) {
    return (
      `A base de cálculo mudou de "${say(before.calculationBasis)}" para ` +
      `"${say(after.calculationBasis)}". O valor continua na mesma unidade e periodicidade, mas ` +
      `é produzido por outra regra — a diferença mede a troca de fórmula, não o custo.`
    );
  }
  return null;
}

function classificationColumns(c: AttributeClassification) {
  return {
    costClass: c.costClass,
    taxonomyPath: c.taxonomyPath,
    taxonomyName: c.taxonomyName,
    semanticsStatus: c.semanticsStatus,
    attributeCode: c.attributeCode,
    attributeName: c.attributeName,
    entityType: c.entityType,
  };
}

interface Side {
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  date: string | null;
  isNull: boolean;
  nullReason: string | null;
  display: string | null;
  /** Exact tuple identity, independent of any stored hash. */
  hash: string;
}

/**
 * Read one side of the pair from typed columns rather than from the stored
 * `value_hash`.
 *
 * The stored hash is produced by the importer, so two snapshots read by
 * different parser versions could hash equal values differently. Comparing the
 * typed tuple is immune to that, and costs nothing extra given the join.
 */
function describeSide(row: PairedFact, side: "a" | "b"): Side {
  const numericRaw = side === "a" ? row.a_numeric : row.b_numeric;
  const text = side === "a" ? row.a_text : row.b_text;
  const bool = side === "a" ? row.a_boolean : row.b_boolean;
  const date = side === "a" ? row.a_date : row.b_date;
  const isNull = (side === "a" ? row.a_is_null : row.b_is_null) ?? false;
  const nullReason = side === "a" ? row.a_null_reason : row.b_null_reason;
  const numeric = numericRaw === null ? null : Number(numericRaw);

  let display: string | null = null;
  let hash: string;
  if (isNull) {
    display = null;
    hash = `0:${nullReason ?? "?"}`;
  } else if (numeric !== null) {
    display = trimNumber(numeric);
    hash = `n:${display}`;
  } else if (bool !== null) {
    display = bool ? "true" : "false";
    hash = `b:${display}`;
  } else if (date !== null) {
    display = date;
    hash = `d:${date}`;
  } else {
    display = text;
    hash = `s:${text ?? ""}`;
  }

  return { numeric, text, boolean: bool, date, isNull, nullReason, display, hash };
}

function trimNumber(value: number): string {
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

interface ChangeVerdict {
  nature: string;
  delta: number | null;
  deltaPercent: number | null;
  comparability: "COMPARABLE" | "INCONCLUSIVE";
  inconclusiveReason: string | null;
}

/**
 * What kind of change this is, and whether the two sides can honestly be held
 * against each other.
 *
 * "Inconclusive" is a first-class outcome, not a failure: a column the source
 * types inconsistently, or a value that appears where none existed, genuinely
 * cannot yield a variation, and saying so beats printing a number.
 */
export function classifyChange(
  before: Side,
  after: Side,
  classification: AttributeClassification,
): ChangeVerdict {
  // Appearing or disappearing values: real, reportable, but no variation.
  if (before.isNull !== after.isNull) {
    return {
      nature: before.isNull ? "APPEARED" : "DISAPPEARED",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason: before.isNull
        ? `Antes não havia valor (${before.nullReason}); agora há. Não existe variação a calcular.`
        : `Antes havia valor; agora não há (${after.nullReason}). Não existe variação a calcular.`,
    };
  }

  // Both absent, but for different reasons — the source changed its mind about
  // *why* the value is missing, which is worth reporting and not a variation.
  if (before.isNull && after.isNull) {
    return {
      nature: "NULL_REASON",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason: `O motivo da ausência mudou: ${before.nullReason} → ${after.nullReason}.`,
    };
  }

  if (classification.dataType === "MIXED") {
    return {
      nature: "TEXT",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason:
        "A fonte entrega esta coluna com mais de um tipo no mesmo import; " +
        "comparar os dois lados como se fossem da mesma natureza seria arriscado.",
    };
  }

  if (before.numeric !== null && after.numeric !== null) {
    const delta = after.numeric - before.numeric;
    const deltaPercent =
      before.numeric === 0 ? null : (delta / Math.abs(before.numeric)) * 100;
    const nature =
      after.numeric === 0 && before.numeric !== 0
        ? "ZEROING"
        : before.numeric === 0 && after.numeric !== 0
          ? "FROM_ZERO"
          : "NUMERIC";
    return {
      nature,
      delta,
      deltaPercent,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.boolean !== null && after.boolean !== null) {
    return {
      nature: "BOOLEAN",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.date !== null && after.date !== null) {
    return {
      nature: "DATE",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.text !== null && after.text !== null) {
    return {
      nature: "TEXT",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  // The two sides landed in different typed columns: the source changed the
  // shape of this value, which is exactly the kind of thing not to smooth over.
  return {
    nature: "TYPE_CHANGE",
    delta: null,
    deltaPercent: null,
    comparability: "INCONCLUSIVE",
    inconclusiveReason:
      "O tipo do valor mudou entre os dois snapshots; não dá para comparar as duas naturezas com segurança.",
  };
}

function toSummary(
  set: typeof changeSetTable.$inferSelect,
  labelA: string,
  labelB: string,
): ChangeSetSummary {
  return {
    id: set.id,
    snapshotAId: set.snapshotAId,
    snapshotBId: set.snapshotBId,
    snapshotALabel: labelA,
    snapshotBLabel: labelB,
    valueChanges: set.valueChanges,
    entitiesAdded: set.entitiesAdded,
    entitiesRemoved: set.entitiesRemoved,
    attributesAdded: set.attributesAdded,
    attributesRemoved: set.attributesRemoved,
    unchanged: set.unchanged,
    inconclusive: set.inconclusive,
    semanticsChanges: set.semanticsChanges,
    impacto: {
      oficial: set.impactoOficialByPeriodicity ?? {},
      bruto: set.impactoBrutoByPeriodicity ?? {},
      rastro: (set.deducaoRastro ?? {
        brutoByPeriodicity: {},
        degraus: [],
        oficialByPeriodicity: {},
      }) as unknown as RastroDaDeducao,
      mudancasForaDoTotal: set.mudancasForaDoTotal ?? 0,
    },
    impactNotCalculable: set.impactNotCalculable,
  };
}
