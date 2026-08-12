import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { channelOf } from "@workspace/ingest";

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
 * **O canal não é coluna.** `snapshot` é congelado por trigger quando fecha, de
 * modo que uma coluna nova não poderia ser preenchida nas vigências já
 * importadas — e o produto ainda só viu um canal, então não há o que uma coluna
 * distinguisse hoje. O canal é derivado do rótulo, aqui em SQL e em
 * `lib/ingest/src/vigencia.ts` em TypeScript; os dois são obrigados a
 * concordar por um teste que roda os dois lados sobre os mesmos rótulos. No dia
 * em que existir um segundo canal no banco, persistir a derivação passa a valer
 * a migration — e o teste continua sendo o que prova a equivalência.
 */

/**
 * Espelho, em POSIX, do `LABEL_PATTERN` de `lib/ingest/src/vigencia.ts`.
 *
 * `substring(… from …)` devolve o grupo capturado, ou NULL quando o rótulo não
 * tem a forma — que é exatamente o que `channelOf` devolve do lado do
 * TypeScript. NULL é uma partição como outra qualquer: rótulos sem canal
 * legível ficam todos juntos, em vez de cada um virar uma série sozinha.
 */
export const CHANNEL_PATTERN = "^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$";

/** `channelSql("sb.source_label")` → o canal daquela coluna, ou NULL. */
export function channelSql(labelColumn: string) {
  return sql.raw(`substring(${labelColumn} from '${CHANNEL_PATTERN}')`);
}

export { channelOf };

export interface SeriesContext {
  scopeHash: string;
  /** Null quando o rótulo da vigência não declara canal. */
  channel: string | null;
}

export interface ContextInfo extends SeriesContext {
  /** "CAMAÇARI · EMPURRADA" — o que a tela mostra. */
  label: string;
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
  }>(sql`
    SELECT s.scope_hash,
           ${channelSql("s.source_label")} AS channel,
           max(s.effective_date)::text     AS latest_period,
           count(DISTINCT s.effective_date)::int AS periods
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     GROUP BY 1, 2
     ORDER BY max(s.effective_date) DESC, s.scope_hash, 2 NULLS LAST
  `);

  const { rows: scopeRows } = await db.execute<{
    scope_hash: string;
    channel: string | null;
    scope_type: string;
    code: string;
    name: string | null;
  }>(sql`
    SELECT DISTINCT s.scope_hash,
           ${channelSql("s.source_label")} AS channel,
           sc.scope_type, sc.code, sc.name
      FROM snapshot s
      JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      JOIN scope sc          ON sc.id = ss.scope_id
     WHERE s.status <> 'SUPERSEDED'
     ORDER BY s.scope_hash, 2 NULLS LAST, sc.scope_type, sc.code
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

  const found = contexts.find(
    (c) =>
      (!wantsScope || c.scopeHash === requested!.scopeHash) &&
      (!wantsChannel || c.channel === requested!.channel),
  );
  if (!found) throw new ContextNotFoundError(requested!, contexts);
  return found;
}

/**
 * O predicado SQL do contexto, para um alias de `snapshot`.
 *
 * `IS NOT DISTINCT FROM` porque o canal pode ser NULL dos dois lados, e `=`
 * devolveria NULL — que numa cláusula WHERE quer dizer "não passa". Seria a
 * forma silenciosa de a leitura de um banco sem canal legível devolver vazio.
 */
export function contextFilter(snapshotAlias: string, context: SeriesContext) {
  return sql`${sql.raw(`${snapshotAlias}.scope_hash`)} = ${context.scopeHash}
             AND ${channelSql(`${snapshotAlias}.source_label`)}
                 IS NOT DISTINCT FROM ${context.channel}::text`;
}

/** A chave da série: contexto + cobertura de equipamento. */
export function seriesKey(
  scopeHash: string,
  sourceLabel: string,
  entityTypeSet: string,
): string {
  return `${scopeHash}|${channelOf(sourceLabel) ?? ""}|${entityTypeSet}`;
}
