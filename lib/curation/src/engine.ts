import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  factTable,
  gravarSemanticaConfirmada,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  semanticMeaningTable,
  snapshotTable,
  taxonomyNodeTable,
} from "@workspace/db";
import { coerenciaDaSemantica } from "./agregacao";
import {
  acharSignificado,
  ESCOPO_GLOBAL,
  listarSignificados,
  type Escopo,
} from "./catalogo";
import { derivarSemantica, significadoPara } from "./significado";
import {
  detectPeriodicityConflicts,
  proposeSemantics,
  type Aggregation,
  type AttributeEvidence,
  type PairRatioStats,
  type PeriodicityConflict,
  type Periodicity,
  type Unit,
} from "./semantics";

/**
 * The curation engine.
 *
 * It reads facts, proposes meaning, and records every edit it makes as a
 * CURATION_CHANGE. What it cannot do — structurally, not by policy — is
 * confirm anything: the `attribute_confirmed_requires_actor` constraint
 * rejects a CONFIRMED row that carries no human confirmer.
 */

/**
 * A mesma semântica, também na versão em vigor.
 *
 * `attribute` é a **projeção** da versão em vigor — está escrito assim no
 * schema, e a comparação leva a sério: ela resolve unidade, periodicidade e
 * agregação lendo `attribute_semantics` na data de cada vigência. Quem escreve
 * só a projeção cria duas verdades, e a que vale para o dinheiro é a que
 * ninguém escreveu.
 *
 * Isso ficou invisível enquanto a tabela versionada estava **vazia** em
 * produção: sem linha nenhuma, a comparação caía na projeção e acertava. No
 * momento em que todo atributo passou a nascer com a sua versão 1, uma
 * confirmação que só tocasse `attribute` viraria um atributo confirmado cuja
 * versão em vigor continua dizendo "não sei" — e o número sumiria da soma sem
 * uma linha de erro.
 *
 * Escreve na versão aberta (`effective_until IS NULL`), que é a única que
 * descreve o presente. As fechadas são o passado e não se corrigem por aqui:
 * para isso existe `correctSemantics`, que pede versão e justificativa.
 */
async function espelharNaVersaoEmVigor(
  tx: Database,
  attributeId: string,
  campos: {
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    isMonetary: boolean | null;
    meaningId?: string | null;
    taxonomyNodeId: string | null;
    semanticsStatus: string;
    rationale: string | null;
    confirmedBy?: string | null;
    confirmedAt?: Date | null;
  },
): Promise<void> {
  await tx
    .update(attributeSemanticsTable)
    .set(campos)
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, attributeId),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );
}

/** Snapshot used for the magnitude figures. The most recent live one. */
async function latestSnapshotId(db: Database): Promise<string | null> {
  const [snapshot] = await db
    .select({ id: snapshotTable.id })
    .from(snapshotTable)
    .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(1);
  return snapshot?.id ?? null;
}

/**
 * Gather what the data itself says about each attribute.
 *
 * `latestSum` is a raw, unaudited sum used only to order the queue by
 * magnitude. It is never presented as an audited amount — the semantics that
 * would make it one are exactly what is still missing.
 */
export async function gatherEvidence(db: Database): Promise<AttributeEvidence[]> {
  const snapshotId = await latestSnapshotId(db);

  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      entityType: attributeTable.entityType,
      dataType: attributeTable.dataType,
      valueCount: sql<number>`count(*) FILTER (WHERE NOT ${factTable.isNull})`.mapWith(Number),
      nullCount: sql<number>`count(*) FILTER (WHERE ${factTable.isNull})`.mapWith(Number),
      distinctCount: sql<number>`count(DISTINCT ${factTable.valueHash})`.mapWith(Number),
      min: sql<string | null>`min(${factTable.valueNumeric})`,
      max: sql<string | null>`max(${factTable.valueNumeric})`,
      mean: sql<string | null>`avg(${factTable.valueNumeric})`,
      zeroCount: sql<number>`count(*) FILTER (WHERE ${factTable.valueNumeric} = 0)`.mapWith(Number),
      negativeCount: sql<number>`count(*) FILTER (WHERE ${factTable.valueNumeric} < 0)`.mapWith(Number),
      latestSum: snapshotId
        ? sql<string | null>`sum(${factTable.valueNumeric}) FILTER (WHERE ${factTable.snapshotId} = ${snapshotId})`
        : sql<string | null>`NULL`,
    })
    .from(attributeTable)
    .leftJoin(factTable, eq(factTable.attributeId, attributeTable.id))
    .groupBy(
      attributeTable.code,
      attributeTable.sourceName,
      attributeTable.entityType,
      attributeTable.dataType,
    );

  const num = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    code: r.code,
    sourceName: r.sourceName,
    entityType: r.entityType,
    dataType: r.dataType,
    valueCount: r.valueCount,
    nullCount: r.nullCount,
    distinctCount: r.distinctCount,
    min: num(r.min),
    max: num(r.max),
    mean: num(r.mean),
    latestSum: num(r.latestSum),
    zeroCount: r.zeroCount,
    negativeCount: r.negativeCount,
  }));
}

/**
 * Per-asset ratio between each `X_mensal` column and its `X` counterpart, in
 * the latest snapshot.
 *
 * This is what tells homonymy from a real periodicity contradiction. Comparing
 * the fleet totals cannot: two unrelated columns can add up to any ratio at
 * all, while the same quantity measured twice tracks asset by asset.
 */
export async function gatherPairRatios(
  db: Database,
): Promise<Map<string, PairRatioStats>> {
  const snapshotId = await latestSnapshotId(db);
  if (!snapshotId) return new Map();

  const { rows } = await db.execute<{
    monthly_code: string;
    sample_size: string;
    mean_ratio: string;
    stddev_ratio: string | null;
    min_ratio: string;
    max_ratio: string;
  }>(sql`
    WITH paired AS (
      SELECT monthly.code AS monthly_code,
             f_month.value_numeric / f_base.value_numeric AS ratio
        FROM attribute monthly
        JOIN attribute base
          ON base.code = left(monthly.code, length(monthly.code) - length('_mensal'))
        JOIN fact f_month
          ON f_month.attribute_id = monthly.id
         AND f_month.snapshot_id = ${snapshotId}
         AND NOT f_month.is_null
        JOIN fact f_base
          ON f_base.attribute_id = base.id
         AND f_base.snapshot_id = ${snapshotId}
         AND f_base.entity_id = f_month.entity_id
         AND NOT f_base.is_null
       WHERE monthly.code LIKE '%\\_mensal'
         AND f_base.value_numeric <> 0
         AND f_month.value_numeric IS NOT NULL
    )
    SELECT monthly_code,
           count(*)        AS sample_size,
           avg(ratio)      AS mean_ratio,
           stddev(ratio)   AS stddev_ratio,
           min(ratio)      AS min_ratio,
           max(ratio)      AS max_ratio
      FROM paired
     GROUP BY monthly_code
  `);

  const stats = new Map<string, PairRatioStats>();
  for (const row of rows) {
    stats.set(row.monthly_code, {
      sampleSize: Number(row.sample_size),
      meanRatio: Number(row.mean_ratio),
      stddevRatio: Number(row.stddev_ratio ?? 0),
      minRatio: Number(row.min_ratio),
      maxRatio: Number(row.max_ratio),
    });
  }
  return stats;
}

export interface ProposeResult {
  examined: number;
  proposed: number;
  leftUnknown: number;
  conflicts: PeriodicityConflict[];
  blockedByConflict: string[];
}

/**
 * Run the proposal pass over every attribute that is not already CONFIRMED.
 *
 * Attributes caught in a periodicity conflict are deliberately left UNKNOWN
 * even where a unit could be proposed: presenting a tidy proposal for a column
 * whose own name contradicts its values would invite exactly the wrong
 * confirmation.
 */
export async function runProposalPass(
  db: Database,
  actor: string,
): Promise<ProposeResult> {
  const evidence = await gatherEvidence(db);
  const ratios = await gatherPairRatios(db);
  const conflicts = detectPeriodicityConflicts(evidence, ratios);
  // Only a genuine contradiction withholds a proposal. Two different
  // quantities that merely share a name prefix are reported and then curated
  // normally — blocking them would punish the curator for the source's naming.
  const blocked = new Set<string>();
  for (const conflict of conflicts.filter((c) => c.blocks)) {
    blocked.add(conflict.annualCode);
    blocked.add(conflict.monthlyCode);
  }

  const nodes = await db.select().from(taxonomyNodeTable);
  const nodeByCode = new Map(nodes.map((n) => [n.code, n]));

  const significados = await listarSignificados(db);
  const significadosPorCodigo = new Map(significados.map((s) => [s.code, s.id]));

  const attributes = await db
    .select()
    .from(attributeTable)
    .where(sql`${attributeTable.semanticsStatus} <> 'CONFIRMED'`);
  const byCode = new Map(attributes.map((a) => [a.code, a]));

  let proposed = 0;
  let leftUnknown = 0;

  for (const item of evidence) {
    const attribute = byCode.get(item.code);
    if (!attribute) continue;

    const proposal = proposeSemantics(item);
    const conflict = conflicts.find(
      (c) => c.blocks && (c.annualCode === item.code || c.monthlyCode === item.code),
    );

    const node = nodeByCode.get(proposal.taxonomyCode) ?? nodeByCode.get("nao_classificado");

    const nextStatus = conflict ? "UNKNOWN" : proposal.status;
    const note = conflicts.find(
      (c) => !c.blocks && (c.annualCode === item.code || c.monthlyCode === item.code),
    );
    const rationale = conflict
      ? `CONFLITO DE PERIODICIDADE. ${conflict.message} Proposta suspensa: ${proposal.rationale}`
      : note
        ? `ATENÇÃO — NOMES HOMÔNIMOS. ${note.message} ${proposal.rationale}`
        : proposal.rationale;

    const changes: { field: string; before: string | null; after: string | null }[] = [];
    const record = (field: string, before: unknown, after: unknown) => {
      const b = before === null || before === undefined ? null : String(before);
      const a = after === null || after === undefined ? null : String(after);
      if (b !== a) changes.push({ field, before: b, after: a });
    };

    record("unit", attribute.unit, conflict ? null : proposal.unit);
    record("aggregation", attribute.aggregation, conflict ? null : proposal.aggregation);
    record("is_monetary", attribute.isMonetary, conflict ? null : proposal.isMonetary);
    record("taxonomy_node_id", attribute.taxonomyNodeId, node?.id ?? null);
    record("semantics_status", attribute.semanticsStatus, nextStatus);

    if (changes.length === 0) {
      if (attribute.semanticsStatus === "UNKNOWN") leftUnknown++;
      continue;
    }

    /*
      O significado que corresponde à proposta, lido de volta pela autoridade.

      Não é uma afirmação a mais: são os mesmos campos que a proposta acabou de
      escrever, ditos na língua da tela. Escrevê-lo aqui é o que faz a tela nova
      abrir já mostrando "a IA leu isto como R$ por km" em vez de dois campos
      vazios — e o status continua PRESUMED, que é quem diz que ninguém
      confirmou nada.
    */
    const significadoProposto = conflict
      ? null
      : significadoPara({
          unit: proposal.unit,
          periodicity: attribute.periodicity,
          aggregation: proposal.aggregation,
          isMonetary: proposal.isMonetary,
        });

    const proposto = {
      unit: conflict ? null : proposal.unit,
      // Periodicity is never proposed. It is the one field only a human can
      // fill, and the one the export's naming actively misleads about.
      periodicity: attribute.periodicity,
      aggregation: conflict ? null : proposal.aggregation,
      isMonetary: conflict ? null : proposal.isMonetary,
      meaningId: significadoProposto
        ? (significadosPorCodigo.get(significadoProposto.code) ?? attribute.meaningId)
        : attribute.meaningId,
      taxonomyNodeId: node?.id ?? null,
      semanticsStatus: nextStatus,
    };

    await db
      .update(attributeTable)
      .set({ ...proposto, semanticsRationale: rationale } as never)
      .where(eq(attributeTable.id, attribute.id));

    // A proposta vale para o presente, e o presente é a versão em vigor.
    await espelharNaVersaoEmVigor(db, attribute.id, {
      ...proposto,
      rationale,
    });

    await db.insert(curationEventTable).values(
      changes.map((c) => ({
        targetKind: "ATTRIBUTE",
        targetId: attribute.id,
        targetLabel: attribute.code,
        field: c.field,
        valueBefore: c.before,
        valueAfter: c.after,
        actor,
        reason: rationale,
      })),
    );

    if (nextStatus === "PRESUMED") proposed++;
    else leftUnknown++;
  }

  return {
    examined: evidence.length,
    proposed,
    leftUnknown,
    conflicts,
    blockedByConflict: [...blocked].sort(),
  };
}

export interface ConfirmInput {
  code: string;
  /**
   * O significado econômico afirmado por quem confirma — o caminho novo, e o
   * único que a tela usa.
   *
   * Quando ele vem, `unit`, `aggregation` e `isMonetary` **não são lidos do
   * pedido**: a autoridade os deriva, e aceitar os quatro juntos seria abrir de
   * novo a porta que este desenho fechou (alguém mandando `R$ por litro` com
   * `aggregation: SUM` e o servidor obedecendo).
   *
   * `periodicity` é a exceção, e só para o significado que deixa o período em
   * aberto — `R$ por veículo`. Ver `periodoEmAberto`.
   */
  meaningCode?: string | null;
  /** O escopo do cadastro de significados. Global enquanto houver um cliente. */
  escopo?: Escopo;
  unit?: Unit | null;
  periodicity?: Periodicity | null;
  aggregation?: Aggregation | null;
  isMonetary?: boolean | null;
  taxonomyCode?: string;
  /*
    Não há `displayName` aqui de propósito. O nome de leitura é descrição, e
    descrição se grava por `saveMeaning` — sem justificativa e sem mexer no
    status. Deixar a confirmação também escrever nele daria duas portas com
    regras diferentes para a mesma coluna, que é exatamente a solda que o card
    "Significado" veio desfazer.
  */
  actor: string;
  reason: string;
}

/**
 * Promote an attribute to CONFIRMED.
 *
 * The only path to CONFIRMED in the whole codebase. Every guard below is
 * duplicated as a database constraint — this function produces a readable
 * error, the constraint makes the rule unavoidable.
 */
export async function confirmAttribute(
  db: Database,
  input: ConfirmInput,
): Promise<void> {
  if (!input.actor?.trim()) {
    throw new Error("A confirmação exige um responsável identificado.");
  }
  if (!input.reason?.trim()) {
    throw new Error(
      "A confirmação exige uma justificativa — é o que um revisor vai querer ler depois.",
    );
  }

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, input.code));
  if (!attribute) throw new Error(`Atributo "${input.code}" não encontrado.`);

  /*
    Dois caminhos, e a diferença entre eles é de quem é a caneta.

    **Com significado** é o caminho da tela. A pessoa afirma o que o valor
    representa e a autoridade deriva unidade, agregação e natureza monetária —
    o pedido não tem voto sobre os três, e é por isso que eles não são lidos
    aqui. Aceitar `meaningCode: "taxa_litro"` junto de `aggregation: "SUM"` e
    obedecer ao segundo seria reabrir, pela API, exatamente a porta que a tela
    fechou.

    **Sem significado** é o caminho histórico: o registro de confirmações
    (`CONFIRMED_SEMANTICS`), a CLI, as correções de versão. Ele continua
    funcionando campo a campo, sem uma linha alterada nos chamadores — e ainda
    assim passa a gravar o significado, pela leitura de volta lá embaixo. É o
    que faz uma confirmação de 10/08/2026 aparecer na tela nova como
    "R$ por mês" sem que ninguém tenha reescrito nada.
  */
  const escopo = input.escopo ?? ESCOPO_GLOBAL;
  const significado =
    input.meaningCode != null
      ? await acharSignificado(db, input.meaningCode, escopo)
      : null;
  if (input.meaningCode != null && !significado) {
    throw new Error(
      `O significado "${input.meaningCode}" não está no cadastro. ` +
        `Escolha um da lista ou cadastre-o antes de confirmar.`,
    );
  }

  const derivada = significado ? derivarSemantica(significado) : null;

  const unit = derivada
    ? derivada.unit
    : input.unit !== undefined
      ? input.unit
      : attribute.unit;
  /*
    A periodicidade derivada manda quando existe. Quando o significado a deixa
    em aberto — `R$ por veículo`, que é dinheiro somável sem período declarado —
    ela vem do pedido, que é a única pergunta que a tela ainda faz além das
    duas. E quando nem uma nem outra respondem, a exigência abaixo recusa.
  */
  const periodicity = derivada
    ? (derivada.periodicity ??
      (input.periodicity !== undefined ? input.periodicity : attribute.periodicity))
    : input.periodicity !== undefined
      ? input.periodicity
      : attribute.periodicity;
  const aggregation = derivada
    ? derivada.aggregation
    : input.aggregation !== undefined
      ? input.aggregation
      : attribute.aggregation;
  const isMonetary = derivada
    ? derivada.isMonetary
    : input.isMonetary !== undefined
      ? input.isMonetary
      : attribute.isMonetary;

  if (isMonetary === true && (!unit || !periodicity || !aggregation)) {
    throw new Error(
      significado
        ? `"${input.code}": "${significado.label}" é dinheiro que se acumula, e não diz de que período. ` +
            `Diga se o valor é de cada mês, de cada ano ou único da aquisição — sem isso não há em que total colocá-lo.`
        : `"${input.code}" é monetário: unidade, periodicidade e forma de agregação precisam estar definidas antes de confirmar. ` +
            `Sem isso, somar este atributo é adivinhação.`,
    );
  }

  /*
    A coerência entre unidade, tipo e agregação, na mesma redação que a tela
    mostra. A constraint no banco recusa o mesmo estado — este erro existe para
    que o curador leia uma frase em vez de um nome de constraint, e não para
    substituir a guarda: o padrão de todo este módulo é a regra escrita duas
    vezes, uma legível e uma inescapável.
  */
  const coerente = coerenciaDaSemantica({
    unit,
    aggregation,
    isMonetary,
    semanticsStatus: "CONFIRMED",
    dataType: attribute.dataType,
  });
  if (!coerente.ok) throw new Error(`"${input.code}": ${coerente.motivo}`);

  /*
    O ponteiro para o significado, resolvido nos dois caminhos.

    Pelo caminho histórico ele vem da leitura de volta — `significadoPara` sobre
    os campos que acabaram de ser resolvidos —, e ela não afirma nada de novo:
    deduz de valores que já estavam ali. Quando a combinação não corresponde a
    significado nenhum do cadastro, fica nulo, que é honesto. O que estava
    gravado antes nunca é apagado por essa via.
  */
  let meaningId = significado?.id ?? attribute.meaningId ?? null;
  if (!significado) {
    const lido = significadoPara({ unit, periodicity, aggregation, isMonetary });
    if (lido) {
      const doCadastro = await acharSignificado(db, lido.code, escopo);
      if (doCadastro) meaningId = doCadastro.id;
    }
  }

  let taxonomyNodeId = attribute.taxonomyNodeId;
  if (input.taxonomyCode) {
    const [node] = await db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, input.taxonomyCode));
    if (!node) throw new Error(`Nó de taxonomia "${input.taxonomyCode}" não existe.`);
    taxonomyNodeId = node.id;
  }

  /*
    Daqui para baixo é escrita, e a escrita não mora mais aqui.

    `gravarSemanticaConfirmada`, em `@workspace/db`, toca os três lugares que
    uma confirmação toca — a projeção em `attribute`, a versão em vigor em
    `attribute_semantics`, e um `curation_event` por campo que mudou — e é a
    mesma função que a importação usa ao replicar o registro canônico. Duas
    cópias desta escrita divergiriam no primeiro campo novo, e a confirmação
    feita na tela passaria a produzir um estado diferente da confirmação
    replicada, sobre o mesmo atributo.

    A confirmação vale para a vigência em curso, que é a versão aberta. Um
    atributo com duas versões — porque a fonte mudou a regra em junho — tem a
    de junho confirmada e a anterior intocada: ela foi verdade no trecho dela,
    e confirmar hoje não é afirmar nada sobre o passado.

    O que continua sendo desta função são as **guardas** acima: ator
    identificado, justificativa escrita e semântica coerente. É o que separa a
    confirmação humana da replicação de uma decisão já tomada.
  */
  await db.transaction(async (tx) => {
    await gravarSemanticaConfirmada(
      tx as unknown as Database,
      { id: attribute.id, code: attribute.code },
      { unit, periodicity, aggregation, isMonetary, meaningId, taxonomyNodeId },
      /*
        Confirmar é um ato: deixa rastro mesmo quando a importação já havia
        replicado a mesma decisão e nenhum campo muda. Os campos são os que a
        pessoa afirmou — o significado, quando ela confirmou por ele, e sempre o
        estado, que é o que a palavra "confirmar" quer dizer.
      */
      {
        actor: input.actor,
        reason: input.reason,
        camposDoAto:
          input.meaningCode != null
            ? ["semantics_status", "meaning_id"]
            : ["semantics_status"],
      },
    );
  });
}

export interface QueueItem {
  code: string;
  sourceName: string;
  displayName: string | null;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  semanticsRationale: string | null;
  /** What a curator wrote this column is. Independent of `semanticsStatus`. */
  definition: string | null;
  /** How the source produces it, from the version in force. */
  calculationBasis: string | null;
  /**
   * O significado econômico gravado, quando há um. `null` em tudo que foi
   * curado antes da autoridade semântica — e a tela o resolve de volta pelos
   * quatro campos técnicos, que continuam sendo a verdade nesses casos.
   */
  meaningCode: string | null;
  meaningLabel: string | null;
  /** O código da categoria, para a tela pré-selecionar sem casar por caminho. */
  taxonomyCode: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
  costClass: string | null;
  valueCount: number;
  nullCount: number;
  /** Raw unaudited sum over the latest snapshot. Ordering only, never a result. */
  magnitude: number | null;
}

/**
 * The work queue, ordered by how much is riding on each answer.
 *
 * Ordering is by raw magnitude, which is honest for prioritising and useless
 * as a result: an attribute whose periodicity is unknown might be a monthly
 * figure or an annual one, and until that is settled the number means nothing.
 * The UI labels it accordingly.
 */
export async function getCurationQueue(
  db: Database,
  options: { includeConfirmed?: boolean } = {},
): Promise<QueueItem[]> {
  const evidence = await gatherEvidence(db);
  const evidenceByCode = new Map(evidence.map((e) => [e.code, e]));

  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      displayName: attributeTable.displayName,
      entityType: attributeTable.entityType,
      dataType: attributeTable.dataType,
      unit: attributeTable.unit,
      periodicity: attributeTable.periodicity,
      aggregation: attributeTable.aggregation,
      isMonetary: attributeTable.isMonetary,
      semanticsStatus: attributeTable.semanticsStatus,
      semanticsRationale: attributeTable.semanticsRationale,
      definition: attributeTable.definition,
      calculationBasis: attributeSemanticsTable.calculationBasis,
      meaningCode: semanticMeaningTable.code,
      meaningLabel: semanticMeaningTable.label,
      taxonomyCode: taxonomyNodeTable.code,
      taxonomyPath: taxonomyNodeTable.path,
      taxonomyName: taxonomyNodeTable.name,
      costClass: taxonomyNodeTable.costClass,
    })
    .from(attributeTable)
    .leftJoin(
      taxonomyNodeTable,
      eq(attributeTable.taxonomyNodeId, taxonomyNodeTable.id),
    )
    // Left join pelo mesmo motivo do de cima: um atributo sem significado
    // gravado é precisamente o que a fila existe para mostrar.
    .leftJoin(
      semanticMeaningTable,
      eq(attributeTable.meaningId, semanticMeaningTable.id),
    )
    // The version in force, for its `calculation_basis`. Left-joined and
    // filtered on `effective_until IS NULL` inside the join: an attribute with
    // no version yet must still appear in the queue — it is precisely the one
    // nobody has looked at.
    .leftJoin(
      attributeSemanticsTable,
      and(
        eq(attributeSemanticsTable.attributeId, attributeTable.id),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    )
    .where(
      options.includeConfirmed
        ? sql`true`
        : sql`${attributeTable.semanticsStatus} <> 'CONFIRMED'`,
    );

  const items: QueueItem[] = rows.map((r) => {
    const e = evidenceByCode.get(r.code);
    return {
      ...r,
      valueCount: e?.valueCount ?? 0,
      nullCount: e?.nullCount ?? 0,
      magnitude: e?.latestSum ?? null,
    };
  });

  // Monetary first, then by magnitude: the ~20 attributes that carry the money
  // rise to the top, which is where the curator's time is worth most.
  return items.sort((a, b) => {
    const aMoney = a.isMonetary === true ? 1 : 0;
    const bMoney = b.isMonetary === true ? 1 : 0;
    if (aMoney !== bMoney) return bMoney - aMoney;
    return Math.abs(b.magnitude ?? 0) - Math.abs(a.magnitude ?? 0);
  });
}

export interface AttributeDetail extends QueueItem {
  /** Real values with full provenance, so a decision is made against evidence. */
  samples: {
    snapshotLabel: string;
    effectiveDate: string;
    plate: string | null;
    value: string | null;
    isNull: boolean;
    nullReason: string | null;
    sheet: string;
    row: number;
    column: string;
    columnHeader: string | null;
    originalValue: string | null;
    originalType: string;
  }[];
  /** Value across vigências, for the shape of the series. */
  history: { snapshotLabel: string; effectiveDate: string; sum: number | null; count: number }[];
  events: {
    field: string;
    valueBefore: string | null;
    valueAfter: string | null;
    actor: string;
    reason: string | null;
    createdAt: Date;
  }[];
}

export async function getAttributeDetail(
  db: Database,
  code: string,
): Promise<AttributeDetail | null> {
  const [queueItem] = await getCurationQueue(db, { includeConfirmed: true }).then((q) =>
    q.filter((i) => i.code === code),
  );
  if (!queueItem) return null;

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));

  const samples = await db
    .select({
      snapshotLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      value: factTable.valueNumeric,
      valueText: factTable.valueText,
      isNull: factTable.isNull,
      nullReason: factTable.nullReason,
      sheet: rawSheetTable.sheetName,
      row: rawRowTable.rowIndex,
      column: rawCellTable.columnLetter,
      columnHeader: rawCellTable.columnHeader,
      originalValue: rawCellTable.rawValue,
      originalType: rawCellTable.sourceType,
    })
    .from(factTable)
    .innerJoin(snapshotTable, eq(factTable.snapshotId, snapshotTable.id))
    .innerJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(factTable.attributeId, attribute.id))
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(12);

  const history = await db
    .select({
      snapshotLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      sum: sql<string | null>`sum(${factTable.valueNumeric})`,
      count: sql<number>`count(*) FILTER (WHERE NOT ${factTable.isNull})`.mapWith(Number),
    })
    .from(factTable)
    .innerJoin(snapshotTable, eq(factTable.snapshotId, snapshotTable.id))
    .where(eq(factTable.attributeId, attribute.id))
    .groupBy(snapshotTable.sourceLabel, snapshotTable.effectiveDate)
    .orderBy(snapshotTable.effectiveDate);

  const events = await db
    .select({
      field: curationEventTable.field,
      valueBefore: curationEventTable.valueBefore,
      valueAfter: curationEventTable.valueAfter,
      actor: curationEventTable.actor,
      reason: curationEventTable.reason,
      createdAt: curationEventTable.createdAt,
    })
    .from(curationEventTable)
    .where(
      and(
        eq(curationEventTable.targetKind, "ATTRIBUTE"),
        eq(curationEventTable.targetId, attribute.id),
      ),
    )
    .orderBy(desc(curationEventTable.createdAt))
    .limit(50);

  return {
    ...queueItem,
    samples: samples.map((s) => ({
      snapshotLabel: s.snapshotLabel,
      effectiveDate: s.effectiveDate,
      plate: null,
      value: s.value ?? s.valueText,
      isNull: s.isNull,
      nullReason: s.nullReason,
      sheet: s.sheet,
      row: s.row,
      column: s.column,
      columnHeader: s.columnHeader,
      originalValue: s.originalValue,
      originalType: s.originalType,
    })),
    history: history.map((h) => ({
      snapshotLabel: h.snapshotLabel,
      effectiveDate: h.effectiveDate,
      sum: h.sum === null ? null : Number(h.sum),
      count: h.count,
    })),
    events,
  };
}

/**
 * Counts for the curation dashboard header — as a whole and per equipment.
 *
 * The per-equipment cut exists because the screen is read one equipment at a
 * time: the queue has tabs for CAVALO, CARRETA and whatever else was imported,
 * and header tiles that kept counting the whole base while the list below
 * showed a single tab would contradict the list — 73 pending over a list of
 * 41. Counting here rather than in the browser is what keeps the confirmed
 * tally right while the queue is showing only the pending ones.
 *
 * `byStatus` and `unclassified` stay exactly as they were: they are the totals
 * of every equipment, which is what the "Todos" tab and the sidebar counter
 * read.
 */
export async function getCurationSummary(db: Database) {
  const rows = await db
    .select({
      entityType: attributeTable.entityType,
      status: attributeTable.semanticsStatus,
      count: sql<number>`count(*)`.mapWith(Number),
      monetary: sql<number>`count(*) FILTER (WHERE ${attributeTable.isMonetary})`.mapWith(Number),
    })
    .from(attributeTable)
    .groupBy(attributeTable.entityType, attributeTable.semanticsStatus)
    // Deterministic order: a grouped result has none by default, and a caller
    // that reads "the first row" would otherwise get a different answer per
    // request.
    .orderBy(attributeTable.entityType, attributeTable.semanticsStatus);

  const unclassifiedRows = await db
    .select({
      entityType: attributeTable.entityType,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(attributeTable)
    .leftJoin(taxonomyNodeTable, eq(attributeTable.taxonomyNodeId, taxonomyNodeTable.id))
    .where(
      sql`${taxonomyNodeTable.id} IS NULL OR ${taxonomyNodeTable.code} = 'nao_classificado'`,
    )
    .groupBy(attributeTable.entityType)
    .orderBy(attributeTable.entityType);

  const byEntity = [...new Set(rows.map((r) => r.entityType))].map((entityType) => ({
    entityType,
    byStatus: rows
      .filter((r) => r.entityType === entityType)
      .map(({ status, count, monetary }) => ({ status, count, monetary })),
    unclassified:
      unclassifiedRows.find((r) => r.entityType === entityType)?.count ?? 0,
  }));

  // Somado das linhas já lidas, e não numa segunda consulta: dois `count(*)`
  // sobre a mesma tabela em transações diferentes podem discordar, e a soma das
  // abas tem de bater com o total exibido ao lado delas.
  const byStatus = [...new Set(rows.map((r) => r.status))]
    .sort()
    .map((status) => {
      const doStatus = rows.filter((r) => r.status === status);
      return {
        status,
        count: doStatus.reduce((sum, r) => sum + r.count, 0),
        monetary: doStatus.reduce((sum, r) => sum + r.monetary, 0),
      };
    });

  return {
    byStatus,
    unclassified: unclassifiedRows.reduce((sum, r) => sum + r.count, 0),
    byEntity,
  };
}
