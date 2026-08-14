import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { loadAttributeClassificationsAt, type AttributeClassification } from "./classification";
import { compareSnapshots, computeChangeSet, type ComputedChange } from "./engine";
import { periodLabel, loadChanges, type RawChange } from "./grouped";
import { contextFilter, type SeriesContext } from "./series";

/**
 * A resolução da comparação — o lugar único que responde "o que mudou entre
 * estes dois retratos".
 *
 * **A garantia estrutural que este módulo existe para dar:** se existem dois
 * snapshots válidos, a análise consegue comparar os dois. A ausência de uma
 * comparação gravada é um detalhe de armazenamento, e nunca uma ausência de
 * resposta.
 *
 * Antes não era assim, e o preço apareceu na tela. `getRangeAnalysis` lia
 * `change_set`; sem ele, a leitura de MOVIMENTOS devolvia zero — e zero, numa
 * tela de auditoria, se lê como "a Ambev não mexeu em nada". As duas formas de
 * ficar sem `change_set` são rotineiras:
 *
 * 1. **Ninguém mandou calcular.** A comparação nasce na importação
 *    (`computeMissingChangeSets`), e a única chamada automática vive no
 *    Panorama, disparada quando alguém abre aquela tela e com o erro engolido.
 *    Importar e ir direto ao cartão deixava a vigência sem comparação nenhuma.
 * 2. **A vigência foi reimportada.** `promote` marca o snapshot antigo como
 *    SUPERSEDED e grava um novo, com **id novo**. O `change_set` antigo continua
 *    apontando para o snapshot morto, é descartado por todo filtro de leitura, e
 *    o snapshot vivo fica sem comparação. Era o caso do print que abriu esta
 *    conversa: "o intervalo soma as 0 comparações".
 *
 * **Como se resolve.** Pede-se a comparação de um par de snapshots vivos; se
 * existir gravada *para aquele par exato* e concluída, ela é lida; se não,
 * calcula-se na hora com o mesmo `compareSnapshots` que a importação usa.
 * Repare que a resolução por *id do par* torna o obsoleto impossível por
 * construção: o snapshot reimportado tem id novo, logo nenhuma comparação
 * antiga casa com ele, logo ela nunca é usada em silêncio.
 *
 * **O que se materializa, e o que não se materializa.** Só o par consecutivo —
 * a vigência contra a imediatamente anterior da sua série — pode ser gravado,
 * porque é essa a comparação que o resto do produto lê pelo `snapshot_b`.
 * Gravar abril contra agosto faria a tela de agosto apanhar aquele par e somar
 * oito meses de movimento ao total de um mês. O salto ponta a ponta é sempre
 * calculado e nunca gravado.
 */

export interface SnapshotEnd {
  id: string;
  effectiveDate: string;
  sourceLabel: string;
  entityTypeSet: string;
  entityCount: number;
}

export interface TransitionPair {
  /** A ponta de partida. */
  from: SnapshotEnd;
  /** A ponta de chegada — é dela que saem a frota e o rótulo da vigência. */
  to: SnapshotEnd;
  /** A série (cobertura de equipamento) a que as duas pontas pertencem. */
  entityTypeSet: string;
  /**
   * `to` sucede `from` imediatamente na série.
   *
   * Só o par consecutivo é materializável: é o par que o resto do produto lê
   * pelo `snapshot_b`, e é o único cuja gravação não muda o significado de
   * nenhuma outra tela.
   */
  consecutive: boolean;
}

export interface ResolvedTransition extends TransitionPair {
  /**
   * A chave que ocupa o lugar do `change_set_id` no agrupamento.
   *
   * `buildGroup` consulta a frota por essa chave para dizer a cobertura do
   * grupo; o que a chave significa é "de qual comparação esta linha veio", e
   * uma comparação calculada na hora tem identidade tanto quanto uma gravada.
   */
  key: string;
  /** De onde veio o resultado. Diagnóstico e log — nunca vocabulário de tela. */
  origin: "MATERIALIZED" | "COMPUTED";
  rows: RawChange[];
  entitiesAdded: number;
  entitiesRemoved: number;
  /** Ativos presentes nas duas pontas — o denominador da comparação. */
  entitiesCompared: number;
}

/**
 * Uma vigência do intervalo que não tem com o que se comparar.
 *
 * Sobrou uma só razão para isto existir depois que a comparação passa a ser
 * calculada sob demanda: **não há vigência anterior** naquela série. É a
 * primeira entrega, e a primeira entrega não tem antes. Continua nomeada, nunca
 * contada como zero.
 */
export interface TransitionGap {
  period: string;
  label: string;
  entityTypeSet: string;
  reason: string;
}

/**
 * Os snapshots vivos do contexto, cada um já sabendo qual é o seu anterior.
 *
 * Uma consulta só, com `lag` sobre a série — e não uma consulta por vigência.
 * A série é a partição: mesma origem, mesmo escopo, mesmo canal, mesma
 * cobertura de equipamento. É a mesma chave de `findPreviousSnapshot` e de
 * `computeMissingChangeSets`; escrevê-la de um jeito diferente aqui produziria
 * um "anterior" que discorda do que a importação comparou.
 */
async function liveSnapshots(
  db: Database,
  context: SeriesContext,
): Promise<
  (SnapshotEnd & { previousId: string | null; previousDate: string | null })[]
> {
  const { rows } = await db.execute<{
    id: string;
    effective_date: string;
    source_label: string;
    entity_type_set: string;
    entity_count: number;
    previous_id: string | null;
    previous_date: string | null;
  }>(sql`
    SELECT s.id::text                    AS id,
           s.effective_date::text        AS effective_date,
           s.source_label,
           s.entity_type_set,
           s.entity_count,
           lag(s.id::text)             OVER serie AS previous_id,
           lag(s.effective_date::text) OVER serie AS previous_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
    WINDOW serie AS (
      PARTITION BY s.source_system, s.scope_hash, s.entity_type_set
      -- created_at desempata duas entregas na mesma data: sem ele a ordem
      -- ficaria por conta do Postgres, e o anterior mudaria de execucao para
      -- execucao.
      ORDER BY s.effective_date, s.created_at
    )
    ORDER BY s.effective_date, s.entity_type_set
  `);

  return rows.map((row) => ({
    id: row.id,
    effectiveDate: row.effective_date,
    sourceLabel: row.source_label,
    entityTypeSet: row.entity_type_set,
    entityCount: Number(row.entity_count),
    previousId: row.previous_id,
    previousDate: row.previous_date,
  }));
}

/**
 * As transições que a leitura de **movimentos** soma: cada vigência do
 * intervalo contra a anterior da sua série.
 *
 * O intervalo são as transições que **chegam** em `(inicio, fim]` — a ponta
 * inicial é o ponto de partida e não um período cujo movimento se soma. Julho →
 * agosto é uma comparação.
 */
export async function movementTransitions(
  db: Database,
  context: SeriesContext,
  inicio: string,
  fim: string,
): Promise<{ pairs: TransitionPair[]; gaps: TransitionGap[] }> {
  const vivos = await liveSnapshots(db, context);
  const porId = new Map(vivos.map((s) => [s.id, s]));

  const pairs: TransitionPair[] = [];
  const gaps: TransitionGap[] = [];

  for (const snapshot of vivos) {
    if (!(snapshot.effectiveDate > inicio && snapshot.effectiveDate <= fim)) continue;
    const anterior = snapshot.previousId ? porId.get(snapshot.previousId) : undefined;
    if (!anterior) {
      gaps.push({
        period: snapshot.effectiveDate,
        label: periodLabel(snapshot.effectiveDate),
        entityTypeSet: snapshot.entityTypeSet,
        reason:
          "É a primeira vigência desta série: não há entrega anterior com que " +
          "comparar. O que houve aqui não está somado — e não está contado como zero.",
      });
      continue;
    }
    pairs.push({
      from: anterior,
      to: snapshot,
      entityTypeSet: snapshot.entityTypeSet,
      consecutive: true,
    });
  }

  return { pairs, gaps };
}

/**
 * A transição única que a leitura **ponta a ponta** faz: o retrato de `inicio`
 * contra o de `fim`, por série.
 *
 * Uma série que existe numa ponta só não vira zero nem some: é dita, e o motivo
 * é o que manda importar o arquivo que falta.
 */
export async function endToEndTransitions(
  db: Database,
  context: SeriesContext,
  inicio: string,
  fim: string,
): Promise<{
  pairs: TransitionPair[];
  missingSeries: { entityTypeSet: string; reason: string }[];
}> {
  const vivos = await liveSnapshots(db, context);
  const naPonta = (data: string) =>
    new Map(vivos.filter((s) => s.effectiveDate === data).map((s) => [s.entityTypeSet, s]));
  const deA = naPonta(inicio);
  const deB = naPonta(fim);

  const pairs: TransitionPair[] = [...deB.keys()]
    .filter((serie) => deA.has(serie))
    .sort()
    .map((serie) => {
      const from = deA.get(serie)!;
      const to = deB.get(serie)!;
      return {
        from,
        to,
        entityTypeSet: serie,
        // Consecutivo só quando as duas pontas se sucedem de fato — e aí a
        // comparação gravada da importação é exatamente este par.
        consecutive: to.effectiveDate > from.effectiveDate && vivos
          .filter((s) => s.entityTypeSet === serie)
          .every(
            (s) => !(s.effectiveDate > from.effectiveDate && s.effectiveDate < to.effectiveDate),
          ),
      };
    });

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

  return { pairs, missingSeries };
}

export interface ResolveOptions {
  /**
   * Gravar o que for calculado, para a próxima leitura não repetir a conta.
   *
   * Só tem efeito sobre par consecutivo — ver a nota do módulo. Falhar ao
   * gravar **não** invalida a leitura: o número já está calculado e correto, e
   * uma tela que quebrasse porque o cache não pôde ser escrito seria pior do
   * que uma que recalcula na próxima vez.
   */
  materialize?: boolean;
  materializedBy?: string;
}

/**
 * Resolve um lote de transições: lê as gravadas, calcula as que faltam.
 *
 * O lote importa para o custo. As gravadas saem numa consulta só — a mesma
 * `loadChanges` de sempre —, de modo que o caminho normal (tudo materializado)
 * não paga nada pela existência do caminho alternativo. Só a transição que
 * realmente falta é calculada, e só ela.
 */
export async function resolveTransitions(
  db: Database,
  pairs: TransitionPair[],
  options: ResolveOptions = {},
): Promise<ResolvedTransition[]> {
  if (pairs.length === 0) return [];

  const gravadas = await materializedSets(db, pairs);

  const idsParaLer = pairs
    .map((par) => gravadas.get(chaveDoPar(par)))
    .filter((id): id is string => id !== undefined);
  const linhasGravadas = await loadChanges(db, idsParaLer);
  const porChangeSet = new Map<string, RawChange[]>();
  for (const linha of linhasGravadas) {
    const lista = porChangeSet.get(linha.change_set_id) ?? [];
    lista.push(linha);
    porChangeSet.set(linha.change_set_id, lista);
  }

  /*
    A semântica é lida por data, e cada data uma vez só. Num intervalo de oito
    meses são nove leituras em vez de dezoito, e num intervalo já materializado,
    nenhuma.
  */
  const cacheDeSemantica = new Map<string, Map<string, AttributeClassification>>();
  const semanticaEm = async (data: string) => {
    const existente = cacheDeSemantica.get(data);
    if (existente) return existente;
    const carregada = await loadAttributeClassificationsAt(db, data);
    cacheDeSemantica.set(data, carregada);
    return carregada;
  };

  const resolvidas: ResolvedTransition[] = [];
  for (const par of pairs) {
    const changeSetId = gravadas.get(chaveDoPar(par));
    if (changeSetId) {
      const rows = porChangeSet.get(changeSetId) ?? [];
      resolvidas.push({
        ...par,
        key: changeSetId,
        origin: "MATERIALIZED",
        rows,
        entitiesAdded: rows.filter((r) => r.change_type === "ENTITY_ADDED").length,
        entitiesRemoved: rows.filter((r) => r.change_type === "ENTITY_REMOVED").length,
        entitiesCompared:
          par.to.entityCount - rows.filter((r) => r.change_type === "ENTITY_ADDED").length,
      });
      continue;
    }

    const semanticsA = await semanticaEm(par.from.effectiveDate);
    const semanticsB = await semanticaEm(par.to.effectiveDate);
    const comparison = await compareSnapshots(
      db,
      { id: par.from.id, effectiveDate: par.from.effectiveDate },
      { id: par.to.id, effectiveDate: par.to.effectiveDate },
      semanticsA,
      semanticsB,
    );

    const key = `${par.from.id}->${par.to.id}`;
    resolvidas.push({
      ...par,
      key,
      origin: "COMPUTED",
      rows: asRawChanges(comparison.changes, key, semanticsB),
      entitiesAdded: comparison.entitiesAdded,
      entitiesRemoved: comparison.entitiesRemoved,
      entitiesCompared: par.to.entityCount - comparison.entitiesAdded,
    });

    if (options.materialize && par.consecutive) {
      await materialize(db, par, options.materializedBy);
    }
  }

  return resolvidas;
}

const chaveDoPar = (par: TransitionPair) => `${par.from.id}|${par.to.id}`;

/**
 * As comparações já gravadas para estes pares exatos.
 *
 * Por **id do par**, e concluídas. É esta consulta que torna impossível usar
 * uma comparação obsoleta: o snapshot reimportado tem id novo, e nenhuma
 * comparação antiga casa com ele. Uma que ficou em PENDING — o processo morreu
 * no meio — também não casa, e é recalculada em vez de lida pela metade.
 */
async function materializedSets(
  db: Database,
  pairs: TransitionPair[],
): Promise<Map<string, string>> {
  const { rows } = await db.execute<{
    id: string;
    snapshot_a_id: string;
    snapshot_b_id: string;
  }>(sql`
    SELECT cs.id::text AS id,
           cs.snapshot_a_id::text AS snapshot_a_id,
           cs.snapshot_b_id::text AS snapshot_b_id
      FROM change_set cs
     WHERE cs.status = 'DONE'
       AND (cs.snapshot_a_id, cs.snapshot_b_id) IN (${sql.join(
         pairs.map((par) => sql`(${par.from.id}::uuid, ${par.to.id}::uuid)`),
         sql`, `,
       )})
  `);

  return new Map(rows.map((row) => [`${row.snapshot_a_id}|${row.snapshot_b_id}`, row.id]));
}

/**
 * Grava a comparação recém-calculada, para a próxima leitura não repetir a conta.
 *
 * Chama `computeChangeSet`, que refaz o cálculo — sim, uma segunda vez. É de
 * propósito: gravar é uma transação com regras próprias (recusa escopos e canais
 * diferentes, substitui o conjunto inteiro em vez de remendá-lo) e duplicar
 * essas regras aqui para economizar uma passada seria trocar correção por
 * velocidade no lugar errado. A segunda passada acontece uma vez na vida
 * daquele par; a leitura seguinte já é a barata.
 *
 * O erro não sobe: quem pediu a análise já tem a resposta certa em mãos, e uma
 * tela que quebrasse porque o cache não pôde ser escrito seria pior do que uma
 * que recalcula na próxima vez. Fica no log de quem chamou.
 */
async function materialize(
  db: Database,
  par: TransitionPair,
  computedBy = "api:analise",
): Promise<void> {
  await computeChangeSet(db, par.from.id, par.to.id, { computedBy }).catch(() => undefined);
}

/**
 * Traduz o resultado do motor para a forma que o agrupamento já sabe ler.
 *
 * O agrupamento, o impacto, a composição e os rankings foram escritos sobre a
 * linha **gravada** — a que vem do banco com o código do atributo já resolvido.
 * Uma comparação calculada na hora tem `attribute_id`, que é o que o motor usa;
 * a tradução é aqui, uma vez, em vez de um segundo caminho de agregação que um
 * dia discordaria do primeiro.
 *
 * A semântica usada é a da **ponta de chegada**, que é a mesma com que o motor
 * avaliou o impacto daquela linha. Ler unidade e agregação da projeção atual do
 * atributo — como faz a linha gravada — daria, numa série cuja semântica mudou,
 * uma unidade que não é a que produziu aquele número.
 */
export function asRawChanges(
  changes: ComputedChange[],
  changeSetId: string,
  semanticsB: Map<string, AttributeClassification>,
): RawChange[] {
  const porId = new Map(
    [...semanticsB.values()].map((c) => [c.attributeId, c] as const),
  );

  return changes.map((linha, indice) => {
    const semantica = linha.attributeId ? porId.get(linha.attributeId) : undefined;
    return {
      id: indice,
      change_set_id: changeSetId,
      category: linha.category,
      change_type: linha.changeType,
      nature: linha.nature ?? null,
      entity_id: linha.entityId ?? null,
      entity_label: linha.entityLabel ?? null,
      entity_type: linha.entityType ?? semantica?.entityType ?? null,
      attribute_code: linha.attributeCode ?? semantica?.attributeCode ?? null,
      attribute_source_name: linha.attributeName ?? semantica?.attributeName ?? null,
      value_before: linha.valueBefore ?? null,
      value_after: linha.valueAfter ?? null,
      numeric_before:
        linha.numericBefore === undefined ? null : (linha.numericBefore as string | null),
      numeric_after:
        linha.numericAfter === undefined ? null : (linha.numericAfter as string | null),
      delta_percent:
        linha.deltaPercent === undefined ? null : (linha.deltaPercent as string | null),
      comparability: linha.comparability,
      inconclusive_reason: linha.inconclusiveReason ?? null,
      impact_confidence: linha.impactConfidence,
      impact_amount:
        linha.impactAmount === undefined ? null : (linha.impactAmount as string | null),
      impact_periodicity: linha.impactPeriodicity ?? null,
      impact_reason: linha.impactReason ?? null,
      cost_class: linha.costClass ?? semantica?.costClass ?? null,
      taxonomy_path: linha.taxonomyPath ?? semantica?.taxonomyPath ?? null,
      taxonomy_name: linha.taxonomyName ?? semantica?.taxonomyName ?? null,
      semantics_status: linha.semanticsStatus ?? semantica?.semanticsStatus ?? null,
      aggregation: semantica?.aggregation ?? null,
      is_monetary: semantica?.isMonetary ?? null,
      unit: semantica?.unit ?? null,
    };
  });
}
