import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { snapshotTable } from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import { periodLabel } from "./labels";
import { getChangeSetForPair } from "./query";
import {
  contextFilter,
  resolveContext,
  seriesKey,
  type ContextInfo,
  type JanelaDeVigencias,
  type RequestedContext,
  type SeriesContext,
} from "./series";

/**
 * The consolidated view — a projection, not an entity.
 *
 * Carretas and cavalos are ingested, snapshotted and compared as independent
 * series, and nothing here changes that: no series waits for the other, and no
 * "complete vigência" is invented in the database. What this module does is
 * read the series that exist for a given period and add them up for the
 * business question "what happened to the fleet".
 *
 * Two rules keep the sum honest:
 *
 * 1. **Impacts are added within a periodicity, never across.** R$/mês and
 *    R$/ano are different quantities in one series and stay different in ten.
 * 2. **A missing series is named, never assumed to be zero.** If only carretas
 *    arrived for a period, the analysis is shown in full and labelled partial,
 *    saying which series is absent. Absence of data is not data.
 */

export interface SeriesAtPeriod {
  entityTypeSet: string;
  /**
   * A vigência a que esta entrada se refere.
   *
   * Existe desde que a leitura passou a poder cobrir mais de uma: sem ela, uma
   * lista com oito transições da mesma série seria oito entradas indistinguíveis,
   * e a tela não teria como dizer qual é qual.
   */
  effectiveDate: string;
  snapshotId: string;
  sourceLabel: string;
  /** The comparison against this series' own previous vigência. */
  changeSetId: string | null;
  previousLabel: string | null;
  /** Null when this is the first vigência of the series. */
  reason: string | null;
}

export interface ConsolidatedView {
  /**
   * A unidade e o canal a que tudo abaixo se refere.
   *
   * Existe para que escolher por padrão não seja escolher em silêncio: a
   * resposta diz de quem é o período que ela está descrevendo.
   */
  context: ContextInfo;
  /**
   * A vigência mais recente da leitura.
   *
   * Sem recorte é *a* vigência — a leitura é de uma só. Com recorte é a ponta
   * de cima dele, e quem escreve a procedência na tela precisa de
   * {@link ConsolidatedView.periodos} para dizer a frase inteira.
   */
  period: string;
  /**
   * `agosto/2026` — a vigência dita como as outras telas a dizem.
   *
   * Vem do servidor, e da mesma função que `GroupedView.periodLabel`, para que
   * a Visão geral e as Alterações não escrevam o mesmo mês de dois jeitos.
   * Formatar a data no navegador seria uma segunda regra de rótulo, e duas
   * regras é uma a mais do que se consegue manter iguais.
   */
  periodLabel: string;
  /** Series that delivered a vigência for this period. */
  present: SeriesAtPeriod[];
  /**
   * Series known to the system that did not deliver for this period. Named so
   * the reader knows exactly what the consolidated figure is missing.
   */
  missing: string[];
  complete: boolean;
  totals: {
    valueChanges: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    attributesAdded: number;
    attributesRemoved: number;
    unchanged: number;
    inconclusive: number;
    impactNotCalculable: number;
  };
  /** Summed per periodicity, across the series present. Never one number. */
  impactByPeriodicity: Record<string, number>;
  /** The change sets behind the numbers, for the listing to read. */
  changeSetIds: string[];
  /**
   * O recorte De/Até aplicado, quando houve. Null é a leitura de uma vigência.
   *
   * Vem do contexto resolvido, e não do pedido: quem manda meia janela — "de
   * março para cá" — recebe aqui as duas pontas de fato usadas.
   */
  janela: JanelaDeVigencias | null;
  /**
   * As vigências que a leitura cobre, da mais antiga à mais recente.
   *
   * Sem recorte é uma só. Existe porque a tela precisa dizer *quantas* e
   * *quais* — e uma faixa que dissesse só as pontas esconderia que a série tem
   * buracos no meio do intervalo.
   */
  periodos: string[];
  /**
   * Quantas transições entraram na soma.
   *
   * **Não é `periodos.length`, e a diferença é o ponto.** Uma transição precisa
   * das duas pontas dentro do recorte: a vigência mais antiga do intervalo não
   * tem par aqui dentro, e a comparação dela com a de fora pertence ao
   * intervalo anterior. Somá-la aqui contaria a mesma alteração duas vezes para
   * quem lê dois recortes vizinhos.
   */
  transicoes: number;
  /**
   * `2025-12-02` → `EMPURRADA_2_12_2025`, para **todas** as vigências do
   * contexto — não só as do recorte.
   *
   * Deliberadamente sem o recorte: quem monta os seletores de De e Até precisa
   * nomear as opções que estão fora do intervalo atual, que são justamente as
   * que a pessoa vai escolher em seguida. Uma opção sem nome apareceria como
   * uma data solta ao lado de oito rótulos da fonte.
   */
  rotulos: Record<string, string>;
}

/**
 * Every period on record, with which series delivered for it.
 *
 * **Sempre dentro de um contexto.** Uma vigência de agosto da unidade A e uma
 * vigência de agosto da unidade B são dois períodos, não um: agrupar só por
 * data somaria as duas frotas num total que nenhuma das duas reconheceria.
 * Sem contexto, responde pelo mais recente — e quem chama tem a obrigação de
 * dizer qual escolheu (ver `resolveContext`).
 */
export async function listPeriods(db: Database, context?: SeriesContext) {
  const resolved = context ?? (await resolveContext(db));
  if (!resolved) return [];

  const { rows } = await db.execute<{
    effective_date: string;
    series: string[];
  }>(sql`
    -- Uma série é um **componente** da vigência, não o conjunto que ela cobre.
    -- Desde que CAVALO e CARRETA passaram a ser componentes de uma mesma
    -- identidade canônica, uma vigência completa guarda entity_type_set =
    -- "CARRETA+CAVALO"; ler isso como uma série faria as duas sumirem da tela e
    -- aparecer uma terceira, que não existe. O unnest devolve os componentes,
    -- que é o que a tela sempre mostrou.
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT t ORDER BY t) AS series
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", resolved)}
     GROUP BY s.effective_date
     ORDER BY s.effective_date DESC
  `);
  return rows;
}

/**
 * O nome de cada vigência do contexto — **sem o recorte**.
 *
 * `listPeriods` passa pelo `contextFilter`, e portanto some com as vigências
 * fora da janela. É o que se quer de uma leitura; é o oposto do que se quer de
 * um seletor, que existe justamente para escolher uma das que estão de fora.
 * Por isso esta consulta larga a janela de propósito, e é a única do módulo que
 * o faz.
 *
 * Uma data pode ter mais de um snapshot (cavalo e carreta), e nada obriga os
 * rótulos a serem iguais. `min` escolhe um de forma determinística: o rótulo é
 * legenda de uma data, e uma legenda que mudasse de render em render seria pior
 * do que a menos bonita das duas.
 */
export async function listPeriodLabels(
  db: Database,
  context: SeriesContext,
): Promise<Record<string, string>> {
  const { rows } = await db.execute<{ effective_date: string; label: string }>(sql`
    SELECT s.effective_date::text AS effective_date,
           min(s.source_label)    AS label
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", { ...context, janela: null })}
     GROUP BY s.effective_date
     ORDER BY s.effective_date
  `);
  return Object.fromEntries(rows.map((r) => [r.effective_date, r.label]));
}

/**
 * Series the system knows about, in one context.
 *
 * Derived from what has actually been delivered, never declared. A series is
 * "expected" for a period only because it existed before — which is evidence,
 * not an assumption about what the Ambev owes. And "before" is before *in this
 * unit and this channel*: a série que a unidade A entrega não é dívida da
 * unidade B.
 */
export async function knownSeries(
  db: Database,
  context?: SeriesContext,
): Promise<string[]> {
  const resolved = context ?? (await resolveContext(db));
  if (!resolved) return [];

  const { rows } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT DISTINCT t AS entity_type_set
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", resolved)}
     ORDER BY t
  `);
  return rows.map((r) => r.entity_type_set);
}

export interface BackfillComparisonsResult {
  computed: number;
  existing: number;
  series: number;
}

/**
 * Compare every consecutive pair, in every series, that has not been compared.
 *
 * Change sets used to be computed only when a screen asked for one, which meant
 * the Painel showed the impact of whichever transition someone happened to open
 * — and nothing was ever going to compute the rest. After an import, the
 * product's whole promise is "here is what changed", so the comparisons are
 * made then, not on demand.
 *
 * Idempotent: a pair already compared is left alone, so this can run after
 * every promotion without recomputing the series each time.
 */
export async function computeMissingChangeSets(
  db: Database,
  computedBy = "api:after-import",
): Promise<BackfillComparisonsResult> {
  const all = await db
    .select({
      id: snapshotTable.id,
      scopeHash: snapshotTable.scopeHash,
      sourceLabel: snapshotTable.sourceLabel,
      entityTypeSet: snapshotTable.entityTypeSet,
      effectiveDate: snapshotTable.effectiveDate,
    })
    .from(snapshotTable)
    .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
    .orderBy(snapshotTable.effectiveDate);

  // A chave inclui o canal: sem ele, a vigência de agosto do canal ROTA seria
  // comparada contra a de julho do canal EMPURRADA — mesma unidade, mesma
  // cobertura, remunerações diferentes.
  const series = new Map<string, typeof all>();
  for (const snapshot of all) {
    const key = seriesKey(
      snapshot.scopeHash,
      snapshot.sourceLabel,
      snapshot.entityTypeSet,
    );
    if (!series.has(key)) series.set(key, []);
    series.get(key)!.push(snapshot);
  }

  let computed = 0;
  let existing = 0;
  for (const group of series.values()) {
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1];
      const b = group[i];
      if (await getChangeSetForPair(db, a.id, b.id)) {
        existing++;
        continue;
      }
      await computeChangeSet(db, a.id, b.id, { computedBy });
      computed++;
    }
  }
  return { computed, existing, series: series.size };
}

/**
 * A vigência, ou o intervalo delas, somando as séries que entregaram.
 *
 * São duas leituras na mesma função, e a segunda nasceu quando o recorte De/Até
 * — que já existia no Impacto — passou a valer também para a lista da planilha:
 *
 * - **Sem recorte**, é o que sempre foi: *uma* vigência (a pedida, ou a mais
 *   recente), comparada com a anterior de cada série. A anterior pode ser de
 *   qualquer data — é a série que manda —, e é isso que faz a leitura de um mês
 *   fechar sozinha.
 * - **Com recorte**, é o intervalo inteiro: toda transição cujas **duas** pontas
 *   caem dentro dele. A regra das duas pontas é o que impede a dupla contagem —
 *   a comparação que atravessa a borda pertence ao intervalo de baixo, e contá-la
 *   nos dois faria a mesma alteração aparecer em duas leituras vizinhas.
 *
 * A consequência é que a vigência mais antiga do recorte não traz transição
 * nenhuma, e a resposta diz isso em {@link ConsolidatedView.transicoes} em vez
 * de deixar quem lê subtrair um de `periodos.length` na cabeça.
 */
export async function getConsolidated(
  db: Database,
  period?: string,
  requestedContext?: RequestedContext,
): Promise<ConsolidatedView | null> {
  const context = await resolveContext(db, requestedContext);
  if (!context) return null;

  // Já recortado pela janela — `contextFilter` a aplica —, e da mais recente
  // para a mais antiga.
  const periods = await listPeriods(db, context);
  if (periods.length === 0) return null;

  /*
    Com recorte, a vigência pedida não manda: o intervalo é a leitura, e honrar
    um `period` dentro dele encolheria a resposta a uma coluna com o seletor
    dizendo nove. Os dois nunca chegam juntos pela tela — trocar de modo apaga o
    outro —, e a precedência escrita aqui é o que garante isso também para um
    endereço colado à mão.
  */
  const alvos = context.janela
    ? periods.map((p) => p.effective_date).reverse() // da mais antiga à mais recente
    : [(period ? periods.find((p) => p.effective_date === period) : periods[0])
        ?.effective_date];
  if (alvos[0] === undefined) return null;
  const datas = alvos as string[];

  const all = await knownSeries(db, context);
  const { rows: snapshots } = await db.execute<{
    id: string;
    effectiveDate: string;
    entityTypeSet: string;
    sourceLabel: string;
  }>(sql`
    SELECT s.id::text AS id,
           s.effective_date::text AS "effectiveDate",
           s.entity_type_set AS "entityTypeSet",
           s.source_label    AS "sourceLabel"
      FROM snapshot s
     WHERE s.effective_date::text IN (${sql.join(
       datas.map((d) => sql`${d}`),
       sql`, `,
     )})
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     ORDER BY s.effective_date, s.entity_type_set
  `);

  const present: SeriesAtPeriod[] = [];
  const totals = {
    valueChanges: 0,
    entitiesAdded: 0,
    entitiesRemoved: 0,
    attributesAdded: 0,
    attributesRemoved: 0,
    unchanged: 0,
    inconclusive: 0,
    impactNotCalculable: 0,
  };
  const impactByPeriodicity: Record<string, number> = {};
  const changeSetIds: string[] = [];

  for (const snapshot of snapshots) {
    // Each series compares against its own previous vigência. A series that
    // skipped a period compares against whatever it last delivered, which is
    // the truthful comparison for that series.
    // Uma vigência cobre mais de um equipamento desde que os dois passaram a ser
    // componentes da mesma identidade. A tela continua listando um por série;
    // os totais, abaixo, continuam somando **uma vez por comparação** — somá-los
    // por componente contaria a mesma alteração duas vezes.
    const componentes = snapshot.entityTypeSet
      .split("+")
      .filter((t) => t !== "")
      .sort();

    const semPar = (reason: string) => {
      for (const componente of componentes) {
        present.push({
          entityTypeSet: componente,
          effectiveDate: snapshot.effectiveDate,
          snapshotId: snapshot.id,
          sourceLabel: snapshot.sourceLabel,
          changeSetId: null,
          previousLabel: null,
          reason,
        });
      }
    };

    const previousId = await findPreviousSnapshot(db, snapshot.id);
    if (!previousId) {
      semPar("Primeira vigência desta série; não há anterior com que comparar.");
      continue;
    }

    const [previous] = await db
      .select({
        sourceLabel: snapshotTable.sourceLabel,
        effectiveDate: snapshotTable.effectiveDate,
      })
      .from(snapshotTable)
      .where(sql`${snapshotTable.id} = ${previousId}`);

    /*
      A borda de baixo do recorte.

      `findPreviousSnapshot` não conhece a janela — é a série que ela lê, e é
      isso que a torna a resposta certa para a leitura de uma vigência só. Aqui,
      porém, ela devolve uma vigência de fora do intervalo, e somar essa
      transição faria o recorte responder por uma alteração que aconteceu antes
      dele. É a regra das duas pontas, e é o que mantém dois recortes vizinhos
      somando cada alteração uma vez.
    */
    const de = context.janela?.de;
    if (de !== undefined && (previous?.effectiveDate ?? "") < de) {
      semPar(
        "A vigência anterior desta série está fora do recorte; a transição " +
          "pertence ao intervalo anterior.",
      );
      continue;
    }

    const existing = await getChangeSetForPair(db, previousId, snapshot.id);
    const set =
      existing ??
      (await computeChangeSet(db, previousId, snapshot.id, {
        computedBy: "api:consolidated",
      }).then(() => getChangeSetForPair(db, previousId, snapshot.id)));
    if (!set) continue;

    for (const componente of componentes) {
      present.push({
        entityTypeSet: componente,
        effectiveDate: snapshot.effectiveDate,
        snapshotId: snapshot.id,
        sourceLabel: snapshot.sourceLabel,
        changeSetId: set.id,
        previousLabel: previous?.sourceLabel ?? null,
        reason: null,
      });
    }
    changeSetIds.push(set.id);

    totals.valueChanges += set.valueChanges;
    totals.entitiesAdded += set.entitiesAdded;
    totals.entitiesRemoved += set.entitiesRemoved;
    totals.attributesAdded += set.attributesAdded;
    totals.attributesRemoved += set.attributesRemoved;
    totals.unchanged += set.unchanged;
    totals.inconclusive += set.inconclusive;
    totals.impactNotCalculable += set.impactNotCalculable;

    for (const [periodicity, amount] of Object.entries(
      set.calculatedImpactByPeriodicity ?? {},
    )) {
      impactByPeriodicity[periodicity] =
        (impactByPeriodicity[periodicity] ?? 0) + Number(amount);
    }
  }

  const presentTypes = new Set(present.map((p) => p.entityTypeSet));
  const missing = all.filter((s) => !presentTypes.has(s));

  // A ponta de cima da leitura: a vigência pedida quando é uma só, e o fim do
  // intervalo quando é um recorte.
  const ultima = datas[datas.length - 1];

  return {
    context,
    period: ultima,
    periodLabel: periodLabel(ultima),
    present,
    missing,
    complete: missing.length === 0,
    totals,
    impactByPeriodicity: Object.fromEntries(
      Object.entries(impactByPeriodicity).map(([k, v]) => [k, Number(v.toFixed(6))]),
    ),
    changeSetIds,
    janela: context.janela ?? null,
    periodos: datas,
    transicoes: changeSetIds.length,
    rotulos: await listPeriodLabels(db, context),
  };
}
