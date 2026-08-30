import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { criarDeduplicador, daLinhaDoBanco, type Deduplicador } from "./deduplicacao";
import { loadChanges, type RawChange } from "./grouped";
import { carregarVinculosDeConjunto, snapshotsDosChangeSets } from "./vinculos";
import { listPeriods } from "./consolidated";
import type { TipoDaLinhaDoTempo } from "./tipos";
import {
  contextFilter,
  listContexts,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
} from "./series";

/**
 * A janela de comparações de um intervalo — **quais vigências entram, e com
 * que linhas**.
 *
 * Este arquivo não responde nenhuma pergunta de produto. Ele monta o chão em
 * que duas leituras diferentes pisam: a Linha do Tempo (`getRangeAnalysis`,
 * que agrupa o intervalo por parâmetro) e a Evolução por Placa
 * (`evolucao-por-placa.ts`, que o agrupa por ativo). As duas precisam
 * concordar, célula a célula, sobre **qual** comparação pertence a **qual**
 * vigência, sobre quais linhas de alteração existem ali dentro e sobre qual
 * índice de dupla contagem decide o dinheiro — e concordar por construção, e
 * não por duas cópias do mesmo SQL que alguém manteria iguais na mão.
 *
 * A separação foi feita depois de a Evolução por Placa existir por um dia com
 * a sua própria cópia dessas quarenta linhas. A cópia estava correta no dia em
 * que foi escrita, e essa é justamente a forma como este produto já ganhou
 * quatro respostas diferentes para "qual foi o impacto?" (ver o cabeçalho de
 * `deduplicacao.ts`): não por erro, mas por duplicação que envelhece.
 *
 * Quatro decisões viajam aqui dentro, e nenhuma é nova — todas vinham de
 * `getRangeAnalysis`, com o motivo escrito no lugar em que foram tomadas:
 *
 * 1. **`from` é ponto de partida, não período somado.** O intervalo são as
 *    transições que *vão* de `from` até `to`. Julho → agosto é uma comparação,
 *    e não duas.
 * 2. **O eixo é `listPeriods`, e não a lista crua de datas.** Uma vigência que
 *    só tem trecho é uma casca (`naoEhSoTrecho`, em `series.ts`) e não disputa
 *    "a mais recente" com o equipamento.
 * 3. **O índice de composição é montado sobre o intervalo inteiro**, e nunca
 *    sobre um recorte — um total mora numa gaveta e a parcela dele noutra. O
 *    que ele não faz é atravessar vigências: `criarDeduplicador` indexa por
 *    (comparação, ativo), e as duas regras são internas a um par de vigências.
 * 4. **A importação oculta não entra**, nem pelo snapshot (`hidden_at`), nem
 *    pela linha (`alteracao_visivel`, dentro de `loadChanges`), nem pela
 *    revisão morta (`status <> 'SUPERSEDED'`).
 */

/** Uma comparação do intervalo, e a vigência que ela explica. */
export interface ComparacaoDaJanela extends Record<string, unknown> {
  change_set_id: string;
  period: string;
  entity_type_set: string;
}

export interface JanelaDeComparacoes {
  context: ContextInfo;
  /** Todas as vigências do contexto, da mais recente para a mais antiga. */
  datas: string[];
  /** A ponta de partida — não entra na soma. */
  inicio: string;
  /** A ponta final — entra. */
  fim: string;
  /** As vigências dentro do intervalo, da mais recente para a mais antiga. */
  noIntervalo: string[];
  /** As comparações do intervalo que caem numa vigência do eixo. */
  sets: ComparacaoDaJanela[];
  changeSetIds: string[];
  /** A vigência de cada comparação — a chave da coluna. */
  periodoDoSet: Map<string, string>;
  /** Todas as linhas de alteração do intervalo, sem recorte de parâmetro. */
  linhas: RawChange[];
  /** O índice de dupla contagem, montado sobre o intervalo inteiro. */
  dedup: Deduplicador;
}

/**
 * Quais séries de snapshot a leitura de intervalo enxerga.
 *
 * Sem recorte, a régua de sempre: tudo menos a série de trecho, que é a única
 * que chega inteira num `entity_type_set` só e que as telas de frota não querem
 * ver (ver `loadChanges`). Com `tipo = TRECHO`, é o contrário.
 */
export function serieDoTipo(tipo: TipoDaLinhaDoTempo | undefined) {
  return tipo === "TRECHO"
    ? sql`'TRECHO' = ANY(string_to_array(sb.entity_type_set, '+'))`
    : sql`sb.entity_type_set IS DISTINCT FROM 'TRECHO'`;
}

/**
 * As pontas do intervalo, conferidas contra o histórico do contexto.
 *
 * Uma ponta que não existe não vira erro nem some calada: cai no padrão — a
 * vigência mais recente, e a anterior a ela. É o intervalo mais curto que ainda
 * mostra movimento, e é o que a tela abre.
 */
export function pontasDoIntervalo(
  datas: string[],
  from?: string,
  to?: string,
): { inicio: string; fim: string } {
  const alvoFim = to && datas.includes(to) ? to : datas[0];
  /*
    Sem `from` escolhido, a ponta inicial é a vigência **imediatamente anterior
    à final** — e não a segunda mais recente do histórico. Com `to` em junho, "a
    segunda do histórico" é julho, que vem *depois*: o intervalo sairia
    invertido, e a tela mostraria junho → julho para quem pediu junho.
  */
  const anteriorAoFim = datas.find((d) => d < alvoFim);
  const alvoInicio = from && datas.includes(from) ? from : (anteriorAoFim ?? alvoFim);
  return alvoInicio <= alvoFim
    ? { inicio: alvoInicio, fim: alvoFim }
    : { inicio: alvoFim, fim: alvoInicio };
}

/**
 * Abre a janela: contexto resolvido, comparações do intervalo e linhas lidas.
 *
 * Devolve `null` pelas mesmas duas razões que `getRangeAnalysis` sempre
 * devolveu: não há contexto que case com o pedido, ou o contexto não tem
 * vigência nenhuma. As duas viram 404 na rota, e nunca uma janela vazia que a
 * tela leria como "nada mudou".
 */
export async function abrirJanelaDeComparacoes(
  db: Database,
  from?: string,
  to?: string,
  requestedContext?: RequestedContext,
  contextosCarregados?: ContextInfo[],
  tipo?: TipoDaLinhaDoTempo,
): Promise<JanelaDeComparacoes | null> {
  const contexts =
    contextosCarregados ?? (await listContexts(db, { operacao: requestedContext?.operacao }));
  const context = await resolveContext(db, requestedContext, contexts);
  if (!context) return null;

  const periods = await listPeriods(db, context); // mais recente primeiro
  if (periods.length === 0) return null;
  const datas = periods.map((p) => p.effective_date);

  const { inicio, fim } = pontasDoIntervalo(datas, from, to);

  const { rows: setsBrutos } = await db.execute<ComparacaoDaJanela>(sql`
    SELECT cs.id AS change_set_id,
           sb.effective_date::text AS period,
           sb.entity_type_set
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE sb.effective_date > ${inicio}::date
       AND sb.effective_date <= ${fim}::date
       AND sb.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = sb.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("sb", context)}
       -- Trecho só existe no Trecho 360 e na aba de tipo da Linha do Tempo, que
       -- o pede pelo nome. Sem recorte ele fica de fora. Ver a mesma nota em
       -- loadChanges.
       AND ${serieDoTipo(tipo)}
     ORDER BY sb.effective_date DESC, sb.entity_type_set
  `);

  /*
    Só as comparações que caem numa vigência **do eixo** — ver a decisão 2 do
    cabeçalho. Para as leituras que não são de trecho é uma passada sem efeito.
  */
  const noEixo = new Set(datas);
  const sets = setsBrutos.filter((s) => noEixo.has(s.period));
  const changeSetIds = sets.map((s) => s.change_set_id);

  /*
    O trecho não vem na leitura de frota — é preciso pedi-lo pelo nome. Cavalo e
    carreta vêm juntos de propósito: é sobre as linhas dos dois que o índice de
    composição precisa ser montado (o vínculo cavalo→carreta é o que impede a
    mesma coluna de ser contada duas vezes), e o recorte de um deles acontece
    depois, sobre as linhas já lidas.
  */
  const linhas = await loadChanges(db, changeSetIds, tipo === "TRECHO" ? "TRECHO" : undefined);

  const dedup = criarDeduplicador(
    linhas.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(db, await snapshotsDosChangeSets(db, changeSetIds)),
  );

  return {
    context,
    datas,
    inicio,
    fim,
    noIntervalo: datas.filter((d) => d > inicio && d <= fim).sort().reverse(),
    sets,
    changeSetIds,
    periodoDoSet: new Map(sets.map((s) => [s.change_set_id, s.period])),
    linhas,
    dedup,
  };
}
