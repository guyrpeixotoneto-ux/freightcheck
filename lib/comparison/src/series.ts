import { sql } from "drizzle-orm";
import { chaveDeEscopoSql } from "@workspace/availability";
import type { Database } from "@workspace/db";

/**
 * O contexto de uma leitura: **unidade e canal**.
 *
 * Uma vigência não é uma data. É uma data *de alguém*: da unidade X, no canal
 * Y. Enquanto houve uma unidade só e um canal só, essa distinção não custava
 * nada — e por isso as consultas de leitura foram escritas chaveando apenas por
 * `effective_date`. Duas unidades entregando a mesma vigência somariam num
 * total único, sem que nada na tela dissesse que somou; dois canais da mesma
 * unidade se comparariam um contra o outro, porque "a vigência anterior" seria
 * a do outro canal.
 *
 * Este módulo é o lugar único onde o contexto é derivado, resolvido e
 * comparado. Nenhuma consulta de leitura deve montar esse predicado por conta
 * própria.
 *
 * **O canal é a coluna `snapshot.canal`, e mais nada.**
 *
 * Não foi sempre assim, e a história importa porque ela é o defeito. Este
 * arquivo derivava o canal do rótulo por uma expressão regular, com um
 * comentário afirmando que "o canal não é coluna" — verdadeiro quando foi
 * escrito e falso desde a `0015`, que criou `snapshot.canal` como `NOT NULL`
 * com `CHECK` de não vazio, preenchida na promoção por `normalizeChannel`.
 *
 * O comentário venceu e ninguém o releu, de modo que o produto passou a ter
 * **duas** autoridades sobre o mesmo campo: a Cobertura lia a coluna, e
 * Alterações, Impacto, Composição e DRE liam o regex. As duas discordam sempre
 * que o rótulo chega escrito de outro jeito — `Transferencia_1_6_2026` dá
 * `Transferencia` no regex e `TRANSFERENCIA` na coluna —, e o efeito medido era
 * o pior possível: o mesmo canal virava dois contextos, e o Impacto abria
 * mostrando uma coluna em vez do histórico inteiro, sem dizer que havia mais.
 *
 * A derivação por rótulo continua existindo, e só onde ela pertence: na
 * importação (`lib/ingest/src/vigencia.ts`), que é onde o canal nasce. Ler é
 * ler a coluna.
 *
 * **O escopo é o escopo canônico, e não `snapshot.scope_hash`.**
 *
 * `scope_hash` é o SHA-256 dos códigos de escopo **como vieram escritos**. O
 * Excel entrega CNPJ ora mascarado, ora como número sem o zero da frente, e os
 * dois dão hashes diferentes para a mesma empresa. A identidade canônica
 * normaliza — é o que `canonical_scope` guarda, com `CHECK` no banco —, e o
 * comentário de `schema/canonical.ts` diz com todas as letras que `scope_hash`
 * "não faz mais parte da identidade". Este arquivo continuava repartindo o
 * mundo por ele: a mesma unidade virava dois contextos com o mesmo rótulo na
 * tela, e o Impacto abria mostrando metade das vigências.
 *
 * `scopeHash` continua sendo o nome do campo, e continua sendo verdade — é o
 * hash do escopo. O que mudou é **de qual escopo**: o canônico, pela mesma
 * função que a identidade da vigência usa (`freightcheck_serialize_scope`).
 * Os valores antigos continuam sendo aceitos no pedido, para que um link
 * colado não morra; ver `resolveContext`.
 */

/**
 * O canal de uma vigência: a coluna, para um alias de `snapshot`.
 *
 * `canalDe("sb")` → `sb.canal`. Uma função de uma linha existe para que a
 * leitura do canal tenha **um** lugar — o que a expressão regular que morava
 * aqui não tinha, porque cada consulta a reescrevia sobre a coluna de rótulo
 * que tivesse à mão.
 */
export function canalDe(snapshotAlias: string) {
  return sql.raw(`${snapshotAlias}.canal`);
}

export interface SeriesContext {
  scopeHash: string;
  /**
   * O canal, como `snapshot.canal` o guarda.
   *
   * Continua aceitando `null` no **pedido**, e não na resposta: a coluna é
   * `NOT NULL` com `CHECK` de não vazio, de modo que nenhum contexto tem canal
   * nulo. Um pedido com `null` simplesmente não casa com nada — que é a
   * resposta certa, e não um erro.
   */
  channel: string | null;
}

export interface ContextInfo extends SeriesContext {
  /** "CAMAÇARI · EMPURRADA" — o que a tela mostra. */
  label: string;
  /**
   * Os `snapshot.scope_hash` crus que este contexto já teve.
   *
   * Existem para compatibilidade e para mais nada: um link colado antes desta
   * mudança carrega um deles, e recusá-lo seria transformar uma correção em
   * página quebrada. Podem ser mais de um — é justamente o defeito que a
   * mudança fecha.
   */
  scopeHashesLegados: string[];
  scopes: { scopeType: string; code: string; name: string | null }[];
  /** A vigência mais recente deste contexto. */
  latestPeriod: string;
  /** Quantas vigências este contexto tem. */
  periods: number;
}

/** Erro de recusa: o contexto pedido não existe. Rota traduz em 404. */
export class ContextNotFoundError extends Error {
  constructor(requested: Partial<SeriesContext>, available: ContextInfo[]) {
    const asked = [requested.scopeHash, requested.channel].filter(Boolean).join(" · ");
    super(
      `Nenhuma vigência importada para o contexto pedido (${asked || "sem identificação"}). ` +
        `Disponíveis: ${available.map((c) => c.label).join(", ") || "nenhum"}.`,
    );
    this.name = "ContextNotFoundError";
  }
}

/**
 * Todo par (unidade, canal) que já entregou vigência.
 *
 * Ordenado pela vigência mais recente primeiro, com desempate por `scope_hash`
 * e canal — determinístico de propósito. Deixar a ordem por conta do Postgres
 * é como o Painel antigo passou a exibir a série de menor impacto e a omitir a
 * maior, sem dizer que omitia.
 */
export async function listContexts(db: Database): Promise<ContextInfo[]> {
  const { rows } = await db.execute<{
    scope_hash: string;
    channel: string | null;
    latest_period: string;
    periods: number;
    legados: string[];
  }>(sql`
    SELECT ${chaveDeEscopoSql("s")}        AS scope_hash,
           s.canal                         AS channel,
           max(s.effective_date)::text     AS latest_period,
           count(DISTINCT s.effective_date)::int AS periods,
           array_agg(DISTINCT s.scope_hash) AS legados
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     GROUP BY 1, 2
     ORDER BY max(s.effective_date) DESC, 1, 2 NULLS LAST
  `);

  const { rows: scopeRows } = await db.execute<{
    scope_hash: string;
    channel: string | null;
    scope_type: string;
    code: string;
    name: string | null;
  }>(sql`
    SELECT DISTINCT ${chaveDeEscopoSql("s")} AS scope_hash,
           s.canal AS channel,
           sc.scope_type, sc.code, sc.name
      FROM snapshot s
      JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      JOIN scope sc          ON sc.id = ss.scope_id
     WHERE s.status <> 'SUPERSEDED'
     ORDER BY 1, 2 NULLS LAST, sc.scope_type, sc.code
  `);

  const key = (scopeHash: string, channel: string | null) => `${scopeHash}|${channel ?? ""}`;
  const scopesByKey = new Map<string, ContextInfo["scopes"]>();
  for (const row of scopeRows) {
    const k = key(row.scope_hash, row.channel);
    const list = scopesByKey.get(k) ?? [];
    list.push({ scopeType: row.scope_type, code: row.code, name: row.name });
    scopesByKey.set(k, list);
  }

  return rows.map((row) => {
    const scopes = scopesByKey.get(key(row.scope_hash, row.channel)) ?? [];
    return {
      scopeHash: row.scope_hash,
      scopeHashesLegados: [...new Set(row.legados ?? [])].sort(),
      channel: row.channel,
      label: contextLabel(scopes, row.channel, row.scope_hash),
      scopes,
      latestPeriod: row.latest_period,
      periods: Number(row.periods),
    };
  });
}

/**
 * O nome legível do contexto.
 *
 * A unidade manda; o canal entra ao lado quando existe. Sem escopo cadastrado
 * — o que acontece em fixtures sintéticas — resta o hash, que é feio mas é
 * honesto: inventar "Unidade 1" seria pior.
 */
function contextLabel(
  scopes: ContextInfo["scopes"],
  channel: string | null,
  scopeHash: string,
): string {
  const unidade = scopes.find((s) => s.scopeType === "UNIDADE");
  const head = unidade?.name ?? unidade?.code ?? scopes[0]?.name ?? scopes[0]?.code ?? scopeHash;
  return channel ? `${head} · ${channel}` : head;
}

/**
 * Qual contexto esta leitura enxerga.
 *
 * Sem pedido explícito, o mais recente — e a resposta **diz qual escolheu** e
 * quais outros existem, para que escolher por padrão nunca seja escolher em
 * silêncio. Pedido que não existe é recusa escrita, não uma lista vazia.
 */
export async function resolveContext(
  db: Database,
  requested?: Partial<SeriesContext>,
  /** Lista já carregada, para quem vai precisar dela inteira de todo jeito. */
  preloaded?: ContextInfo[],
): Promise<ContextInfo | null> {
  const contexts = preloaded ?? (await listContexts(db));
  if (contexts.length === 0) return null;

  const wantsScope = requested?.scopeHash !== undefined && requested.scopeHash !== null;
  const wantsChannel = requested?.channel !== undefined;
  if (!wantsScope && !wantsChannel) return contexts[0];

  /*
    O escopo pedido casa pela chave canônica **ou** por um `scope_hash` antigo.

    A compatibilidade é de mão única e temporária: links colados, favoritos e
    estado de tela guardados antes desta mudança carregam o hash cru. Recusá-los
    transformaria uma correção em página quebrada, e o custo de aceitá-los é uma
    comparação a mais numa lista de dezenas.

    Quando dois contextos antigos se fundem num só — o caso do CNPJ mascarado —,
    os dois hashes legados apontam para o mesmo contexto. É o resultado certo: o
    link antigo levava a metade da história e passa a levar à história inteira.
  */
  const casaEscopo = (c: ContextInfo) =>
    !wantsScope ||
    c.scopeHash === requested!.scopeHash ||
    c.scopeHashesLegados.includes(requested!.scopeHash!);

  const found = contexts.find(
    (c) => casaEscopo(c) && (!wantsChannel || c.channel === requested!.channel),
  );
  if (!found) throw new ContextNotFoundError(requested!, contexts);
  return found;
}

/**
 * O predicado SQL do contexto, para um alias de `snapshot`.
 *
 * Escopo canônico e canal, os dois pela mesma autoridade que a identidade da
 * vigência usa. `=` e não `IS NOT DISTINCT FROM`: as duas colunas por trás são
 * `NOT NULL`, de modo que não há o que o segundo resolvesse — e um pedido com
 * canal nulo não casar com nada é a resposta certa, porque contexto com canal
 * nulo não existe.
 *
 * O predicado recebe a chave já resolvida. Quem traduz um `scope_hash` antigo
 * para ela é `resolveContext`, uma vez, no início da leitura — e não cada
 * consulta, que é como a tradução viraria oito traduções.
 */
export function contextFilter(snapshotAlias: string, context: SeriesContext) {
  return sql`${chaveDeEscopoSql(snapshotAlias)} = ${context.scopeHash}
             AND ${canalDe(snapshotAlias)} = ${context.channel}::text`;
}

/**
 * A chave da série: contexto + cobertura de equipamento.
 *
 * O canal entra pela coluna, e não mais pelo rótulo. `entity_type_set` continua
 * aqui e está errado — ele cresce com entrega parcial e parte a série —, mas
 * tirá-lo exige a comparação por componente, e as duas metades andam juntas no
 * PR-9. Ver `docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte D.3.
 */
export function seriesKey(
  scopeHash: string,
  canal: string,
  entityTypeSet: string,
): string {
  return `${scopeHash}|${canal}|${entityTypeSet}`;
}
