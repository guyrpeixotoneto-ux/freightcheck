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

/**
 * O recorte temporal de uma leitura: **de qual vigência até qual**.
 *
 * As duas pontas são inclusivas e são datas de vigências que o contexto de fato
 * entregou — nunca um intervalo arbitrário de calendário. A diferença importa:
 * "de 01/03 a 31/05" seria uma pergunta sobre dias, e este produto não tem
 * dias; ele tem vigências, e a janela é um par delas.
 */
export interface JanelaDeVigencias {
  de: string;
  ate: string;
}

export interface SeriesContext {
  scopeHash: string;
  /** Null quando o rótulo da vigência não declara canal. */
  channel: string | null;
  /**
   * O recorte temporal, quando pedido. Ausente ou nulo é a série inteira.
   *
   * Mora aqui, e não num parâmetro à parte de cada leitura, porque
   * {@link contextFilter} é o único predicado que todas as consultas de leitura
   * usam: pendurando a janela no contexto, toda tela que já respeita unidade e
   * canal passa a respeitar o recorte sem uma linha nova — e nenhuma delas pode
   * reconstruir a disponibilidade por conta própria, que é como duas telas
   * passam a discordar sobre o mesmo mês.
   */
  janela?: JanelaDeVigencias | null;
}

/**
 * O contexto pedido por quem chama, antes de ser resolvido.
 *
 * Separado de `Partial<SeriesContext>` só por causa da janela: quem pede pode
 * mandar uma ponta só — "de março para cá" —, e a outra é preenchida com o
 * extremo da série. O `SeriesContext` resolvido nunca tem meia janela.
 */
export interface RequestedContext {
  scopeHash?: string;
  channel?: string | null;
  janela?: { de?: string; ate?: string } | null;
}

export interface ContextInfo extends SeriesContext {
  /** "CAMAÇARI · EMPURRADA" — o que a tela mostra. */
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  /** A vigência mais recente deste contexto. */
  latestPeriod: string;
  /**
   * Quantas vigências este contexto tem — **todas**, sem o recorte.
   *
   * Deliberadamente não muda com a janela: é o tamanho do histórico, e a frase
   * "N vigências no histórico" que várias telas mostram deixaria de ser
   * verdadeira se ela encolhesse ao filtrar. Quantas caem dentro do recorte é
   * {@link ContextInfo.periodosNaJanela}.
   */
  periods: number;
  /**
   * Todas as vigências do contexto, da mais antiga à mais recente.
   *
   * Vem junto para que a tela monte os dois seletores de "De" e "Até" sem uma
   * segunda consulta — e, mais importante, sem inventar as opções: as pontas
   * escolhíveis são exatamente as que este contexto entregou.
   */
  periodosDisponiveis: string[];
  /** Quantas vigências caem dentro do recorte. Igual a `periods` sem janela. */
  periodosNaJanela: number;
}

/** Erro de recusa: o contexto pedido não existe. Rota traduz em 404. */
export class ContextNotFoundError extends Error {
  constructor(requested: RequestedContext, available: ContextInfo[]) {
    const asked = [requested.scopeHash, requested.channel].filter(Boolean).join(" · ");
    super(
      `Nenhuma vigência importada para o contexto pedido (${asked || "sem identificação"}). ` +
        `Disponíveis: ${available.map((c) => c.label).join(", ") || "nenhum"}.`,
    );
    this.name = "ContextNotFoundError";
  }
}

/**
 * Erro de recusa: o recorte pedido não existe. Rota traduz em 400.
 *
 * 400 e não 404 de propósito — o contexto existe, o pedido é que está errado, e
 * a diferença é o que separa "importe alguma coisa" de "escolha outra ponta".
 *
 * Recusar em vez de aparar é a mesma decisão que `resolveContext` já toma com o
 * contexto: uma ponta inexistente aparada em silêncio faria a tela responder
 * sobre um período diferente do pedido, e o número apareceria certo sob um
 * título errado.
 */
export class JanelaInvalidaError extends Error {
  constructor(motivo: string, disponiveis: string[]) {
    super(
      `${motivo} Vigências deste contexto: ${disponiveis.join(", ") || "nenhuma"}.`,
    );
    this.name = "JanelaInvalidaError";
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
    all_periods: string[];
  }>(sql`
    SELECT s.scope_hash,
           ${channelSql("s.source_label")} AS channel,
           max(s.effective_date)::text     AS latest_period,
           count(DISTINCT s.effective_date)::int AS periods,
           array_agg(DISTINCT s.effective_date::text ORDER BY s.effective_date::text)
             AS all_periods
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
      periodosDisponiveis: row.all_periods ?? [],
      // Sem janela pedida, o recorte é a série inteira — e dizer isso com o
      // mesmo número evita que a tela tenha de saber se houve filtro.
      periodosNaJanela: Number(row.periods),
      janela: null,
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
  requested?: RequestedContext,
  /** Lista já carregada, para quem vai precisar dela inteira de todo jeito. */
  preloaded?: ContextInfo[],
): Promise<ContextInfo | null> {
  const contexts = preloaded ?? (await listContexts(db));
  if (contexts.length === 0) return null;

  const wantsScope = requested?.scopeHash !== undefined && requested.scopeHash !== null;
  const wantsChannel = requested?.channel !== undefined;

  const base = !wantsScope && !wantsChannel
    ? contexts[0]
    : contexts.find(
        (c) =>
          (!wantsScope || c.scopeHash === requested!.scopeHash) &&
          (!wantsChannel || c.channel === requested!.channel),
      );
  if (!base) throw new ContextNotFoundError(requested!, contexts);

  return aplicarJanela(base, requested?.janela ?? null);
}

/**
 * O recorte, conferido contra as vigências que o contexto de fato entregou.
 *
 * Uma ponta só é aceita quando ela **é** uma vigência daqui. Aparar em silêncio
 * para a mais próxima faria a tela responder sobre um período diferente do
 * pedido — o número certo sob o título errado, que é a categoria de erro que
 * este produto inteiro evita.
 *
 * Meia janela é completada com o extremo da série: "de março para cá" é um
 * pedido legítimo, e obrigar as duas pontas transformaria um filtro útil num
 * formulário.
 */
export function aplicarJanela(
  context: ContextInfo,
  pedida: { de?: string; ate?: string } | null,
): ContextInfo {
  const disponiveis = context.periodosDisponiveis;
  if (!pedida || (pedida.de === undefined && pedida.ate === undefined)) {
    return { ...context, janela: null, periodosNaJanela: context.periods };
  }
  if (disponiveis.length === 0) {
    throw new JanelaInvalidaError(
      "O contexto não tem vigência nenhuma para recortar.",
      disponiveis,
    );
  }

  const de = pedida.de ?? disponiveis[0];
  const ate = pedida.ate ?? disponiveis[disponiveis.length - 1];

  for (const [rotulo, valor] of [
    ["De", de],
    ["Até", ate],
  ] as const) {
    if (!disponiveis.includes(valor)) {
      throw new JanelaInvalidaError(
        `"${valor}" não é uma vigência deste contexto (${rotulo}).`,
        disponiveis,
      );
    }
  }
  if (de > ate) {
    throw new JanelaInvalidaError(
      `O início do recorte (${de}) é posterior ao fim (${ate}).`,
      disponiveis,
    );
  }

  return {
    ...context,
    janela: { de, ate },
    periodosNaJanela: disponiveis.filter((d) => d >= de && d <= ate).length,
  };
}

/**
 * O predicado SQL do contexto, para um alias de `snapshot`.
 *
 * `IS NOT DISTINCT FROM` porque o canal pode ser NULL dos dois lados, e `=`
 * devolveria NULL — que numa cláusula WHERE quer dizer "não passa". Seria a
 * forma silenciosa de a leitura de um banco sem canal legível devolver vazio.
 *
 * **A janela entra aqui, e é por isso que ela é do contexto.** Toda consulta de
 * leitura do produto passa por este predicado; pendurando o recorte no contexto
 * resolvido, o Impacto, o panorama, a matriz por quinzena e as recomendações ao
 * cliente respeitam o mesmo "de/até" sem que nenhum deles precise saber que ele
 * existe. Uma leitura que montasse o recorte por conta própria seria a segunda
 * régua de disponibilidade que este módulo existe para não ter.
 */
export function contextFilter(snapshotAlias: string, context: SeriesContext) {
  const alias = sql.raw(`${snapshotAlias}.effective_date`);
  const janela = context.janela
    ? sql` AND ${alias} >= ${context.janela.de}::date
           AND ${alias} <= ${context.janela.ate}::date`
    : sql``;

  return sql`${sql.raw(`${snapshotAlias}.scope_hash`)} = ${context.scopeHash}
             AND ${channelSql(`${snapshotAlias}.source_label`)}
                 IS NOT DISTINCT FROM ${context.channel}::text${janela}`;
}

/** A chave da série: contexto + cobertura de equipamento. */
export function seriesKey(
  scopeHash: string,
  sourceLabel: string,
  entityTypeSet: string,
): string {
  return `${scopeHash}|${channelOf(sourceLabel) ?? ""}|${entityTypeSet}`;
}
