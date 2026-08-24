/**
 * O conjunto de alteração existe antes de alguém afirmar que ele é zero.
 *
 * **O defeito que este módulo fecha.** `change` e `change_set` são estado
 * derivado: eles nascem quando alguém chama `computeChangeSet`, e até a
 * auditoria isso só acontecia quando alguém **abria a tela de Alterações**.
 * Quem lê a tabela sem essa garantia não distingue duas coisas opostas — "esta
 * vigência não mudou nada" e "esta vigência nunca foi comparada" —, e as duas
 * saem da consulta como a mesma linha: zero.
 *
 * O assistente lia exatamente assim, e por isso respondia "0 alterações — sem
 * alterações neste recorte" num banco com 124 mil fatos e nove vigências. Uma
 * resposta errada, fluente e com a fonte ao lado: a pior classe de erro que uma
 * aplicação de auditoria pode produzir, porque é indistinguível de uma certa.
 *
 * **Por que garantir em vez de avisar.** A alternativa era devolver "não
 * comparado" e deixar quem pergunta pedir o cálculo. Mas o cálculo é
 * determinístico, barato quando já existe e é a única resposta possível: não há
 * decisão humana entre "quero saber o que mudou" e "compare as duas vigências".
 * Um aviso aqui seria burocracia — o produto sabe o que fazer e sabe fazer
 * sozinho.
 *
 * **Barato quando já está feito.** `computeChangeSet` já é idempotente e já
 * devolve o conjunto existente sem recalcular. O que este módulo acrescenta é
 * não chamá-lo à toa: duas consultas descobrem quais pares faltam, e só os que
 * faltam são calculados. Numa base em dia o custo são essas duas consultas.
 *
 * **O recorte é respeitado.** Só os pares do contexto pedido são garantidos —
 * garantir o banco inteiro faria a primeira pergunta de uma unidade pagar pela
 * comparação de todas as outras.
 *
 * ---------------------------------------------------------------------------
 * As duas coisas que esta garantia deixava passar
 * ---------------------------------------------------------------------------
 *
 * Ela nasceu prometendo "todos os pares que faltam do recorte" e entregava um
 * subconjunto. Os dois furos foram medidos antes de serem fechados, e os dois
 * produziam o mesmo efeito na tela: a vigência continuava pendente **depois**
 * de a garantia ter dito que passou por ela.
 *
 * 1. **Existir um `change_set` não é existir a comparação canônica.** A
 *    verificação era `snapshot_b_id IN (…)` e nada mais. A tela Comparar grava
 *    pares arbitrários — abril contra agosto — na mesma tabela e com o mesmo
 *    `snapshot_b`; a Visão Gerencial, corretamente, só lê o par cujo
 *    `snapshot_a` é a vigência **imediatamente anterior** (o `LEFT JOIN` de
 *    `gerencial.ts` exige as duas pontas). Bastava alguém ter comparado agosto
 *    contra abril à mão para a garantia considerar agosto "já feito" e nunca
 *    materializar o par que a home lê. A verificação agora é pelo par inteiro
 *    (`snapshot_a_id`, `snapshot_b_id`) e só conta `status = 'DONE'` — que é a
 *    mesma régua que `computeChangeSet` usa para decidir se reaproveita ou
 *    recalcula, e por isso `PENDING`/`STALE` voltam a ser trabalho a fazer em
 *    vez de trabalho dado por feito.
 *
 * 2. **Falha de comparação virava "sem anterior".** O `catch` somava em
 *    `semAnterior`, de modo que um par recusado pelo motor — escopo, canal ou
 *    cobertura incompatíveis — saía do relatório com o mesmo nome de uma
 *    primeira vigência de série. São opostos: um é "não há o que comparar", o
 *    outro é "havia, e não deu". Falha agora tem lugar próprio ({@link
 *    FalhaDeComparacao}), com o motivo escrito, para que quem promoveu possa
 *    ver o que ficou para trás em vez de receber um número redondo.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import { channelSql, contextLabel, datasetFamilyFilter } from "./series";
import type { SeriesContext } from "./series";

/**
 * Um par que tinha com que ser comparado e não foi.
 *
 * Nunca é silêncio, e nunca é confundido com ausência de histórico: as duas
 * dariam a mesma vigência não comparada na tela, e só uma delas é defeito.
 */
export interface FalhaDeComparacao {
  /** A vigência que ficou sem a sua comparação canônica. */
  snapshotId: string;
  /** A anterior, com que ela deveria ter sido comparada. */
  anteriorId: string;
  /** O que o motor respondeu, na língua dele. */
  motivo: string;
}

export interface GarantiaDeComparacao {
  /** Os pares que já existiam prontos — nenhum trabalho foi feito por eles. */
  jaExistiam: number;
  /** Os pares calculados agora. */
  calculados: number;
  /** As vigências sem anterior: a primeira de cada série não se compara. */
  semAnterior: number;
  /** Os pares elegíveis que o motor recusou. Vazio é o estado normal. */
  falhas: FalhaDeComparacao[];
}

interface LinhaDeSnapshot extends Record<string, unknown> {
  id: string;
  effective_date: string;
  anterior_id: string | null;
}

/** Uma vigência do recorte e a que a precede na série dela. */
export interface VigenciaDaSerie {
  id: string;
  effectiveDate: string;
  /** Nulo na primeira da série — e só nela. */
  anteriorId: string | null;
}

/**
 * A série, em SQL, para decidir **o que pular** — e só isso.
 *
 * O `LAG` reproduz a régua de `findPreviousSnapshot`: mesma origem, mesmo
 * escopo, mesma cobertura de equipamento e mesmo canal, a vigência
 * imediatamente anterior por data. Está aqui em SQL porque a alternativa —
 * uma ida ao banco por vigência só para descobrir que ela já está comparada —
 * transformaria a garantia numa consulta por vigência em toda pergunta
 * digitada, que é justamente o custo que este módulo existe para não pagar.
 *
 * **Quem decide o par que será comparado continua sendo `findPreviousSnapshot`.**
 * Esta janela só escolhe quais vigências nem precisam ser olhadas; a que sobrar
 * vai ao motor com a anterior que a função canônica devolver. Assim não há uma
 * segunda definição de "vigência anterior" no produto — há uma definição e um
 * índice dela, e `garantia-serie.test.ts` prova que os dois concordam vigência
 * a vigência.
 *
 * **A janela do contexto não estreita o cálculo do anterior.** `janela` e
 * `periodo` recortam o que será *garantido*, nunca a série sobre a qual o
 * anterior é procurado: a primeira vigência de um recorte tem anterior fora
 * dele, e computá-la como "primeira da série" inventaria uma ausência de
 * histórico que não existe.
 */
function serieComAnterior(contexto: SeriesContext) {
  return sql`
    SELECT s.id,
           s.effective_date::text AS effective_date,
           lag(s.id) OVER (
             PARTITION BY s.source_system,
                          s.scope_hash,
                          s.entity_type_set,
                          ${channelSql("s.source_label")}
             ORDER BY s.effective_date
           ) AS anterior_id
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND s.scope_hash = ${contexto.scopeHash}
       AND ${channelSql("s.source_label")} IS NOT DISTINCT FROM ${contexto.channel}::text
  `;
}

/**
 * As vigências do recorte, cada uma com a anterior da sua série.
 *
 * Exportada para ser conferida: `garantia-serie.test.ts` compara, vigência a
 * vigência, o que esta janela diz com o que `findPreviousSnapshot` responde —
 * é o que impede o índice de virar uma segunda definição de "vigência
 * anterior" com o passar do tempo.
 */
export async function paresDaSerie(
  db: Database,
  contexto: SeriesContext,
  periodo?: string,
): Promise<VigenciaDaSerie[]> {
  const janela = contexto.janela
    ? sql` AND s.effective_date >= ${contexto.janela.de}::date
           AND s.effective_date <= ${contexto.janela.ate}::date`
    : sql``;

  const { rows } = await db.execute<LinhaDeSnapshot>(sql`
    WITH serie AS (${serieComAnterior(contexto)})
    SELECT v.id, v.effective_date, v.anterior_id
      FROM serie v
      JOIN snapshot s ON s.id = v.id
     WHERE ${datasetFamilyFilter("s", contexto.datasetFamily)}
       ${periodo ? sql`AND s.effective_date = ${periodo}::date` : sql``}${janela}
     ORDER BY s.effective_date
  `);

  return rows.map((linha) => ({
    id: linha.id,
    effectiveDate: linha.effective_date,
    anteriorId: linha.anterior_id,
  }));
}

/**
 * Garante que as vigências deste recorte têm com que ser comparadas.
 *
 * `periodo` limita o trabalho ao que a pergunta precisa. Sem ele, todas as
 * vigências do recorte são garantidas — que é o que uma leitura de intervalo
 * pede, e o que vale rodar uma vez depois de uma importação.
 *
 * Nunca lança por causa de um par: uma vigência que não se compara com a
 * anterior (escopo, canal ou cobertura diferentes) é uma condição legítima do
 * domínio, e derrubar a pergunta inteira por causa dela trocaria uma resposta
 * incompleta por nenhuma. O que ela produz é uma entrada em `falhas`, com o
 * motivo — o que **não** acontece é a falha sair do relatório disfarçada de
 * vigência sem histórico.
 */
export async function garantirComparacoes(
  db: Database,
  contexto: SeriesContext,
  periodo?: string,
  opcoes: { computedBy?: string } = {},
): Promise<GarantiaDeComparacao> {
  /*
    Uma vigência do recorte é uma linha por cobertura de equipamento.

    CAVALO e CARRETA chegam como snapshots distintos da mesma data, e cada um
    tem o seu par com a data anterior. Filtrar por data sem considerar isso
    garantiria metade do que a tela mostra.
  */
  const snapshots = await paresDaSerie(db, contexto, periodo);

  if (snapshots.length === 0) {
    return { jaExistiam: 0, calculados: 0, semAnterior: 0, falhas: [] };
  }

  /*
    Quais pares canônicos já estão prontos — numa consulta, antes de tocar em
    qualquer cálculo.

    `computeChangeSet` já devolveria o conjunto pronto sem recalcular, mas ao
    custo de três consultas por par. Numa base em dia isso seria trabalho puro
    em toda pergunta digitada. O par é a chave (e não só o `snapshot_b`) pela
    razão 1 do cabeçalho, e `DONE` é a condição pela mesma razão que o motor
    usa: um `change_set` `STALE` é uma comparação a refazer, não uma existente.
  */
  const { rows: existentes } = await db.execute<{
    snapshot_a_id: string;
    snapshot_b_id: string;
  }>(sql`
    SELECT DISTINCT cs.snapshot_a_id, cs.snapshot_b_id
      FROM change_set cs
     WHERE cs.status = 'DONE'
       AND cs.snapshot_b_id IN (${sql.join(
         snapshots.map((s) => sql`${s.id}::uuid`),
         sql`, `,
       )})
  `);
  const prontos = new Set(existentes.map((e) => `${e.snapshot_a_id}|${e.snapshot_b_id}`));

  let jaExistiam = 0;
  let calculados = 0;
  let semAnterior = 0;
  const falhas: FalhaDeComparacao[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.anteriorId && prontos.has(`${snapshot.anteriorId}|${snapshot.id}`)) {
      jaExistiam += 1;
      continue;
    }

    const anterior = await findPreviousSnapshot(db, snapshot.id);
    if (!anterior) {
      semAnterior += 1;
      continue;
    }

    if (prontos.has(`${anterior}|${snapshot.id}`)) {
      jaExistiam += 1;
      continue;
    }

    try {
      await computeChangeSet(db, anterior, snapshot.id, {
        computedBy: opcoes.computedBy ?? "assistant:garantia",
      });
      calculados += 1;
    } catch (err) {
      // Escopo, canal ou cobertura incompatíveis. É condição de domínio, e o
      // efeito na tela é o mesmo de antes desta função existir: aquele par não
      // tem comparação. A pergunta segue com o que houver — e o relatório diz
      // qual par ficou para trás, em vez de somá-lo às primeiras de série.
      falhas.push({
        snapshotId: snapshot.id,
        anteriorId: anterior,
        motivo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { jaExistiam, calculados, semAnterior, falhas };
}

// ---------------------------------------------------------------------------
// A garantia da promoção
// ---------------------------------------------------------------------------

/**
 * O que a garantia fez por uma das unidades que a promoção tocou.
 */
export interface GarantiaDaUnidade {
  scopeHash: string;
  channel: string | null;
  datasetFamily: string;
  /** "CAMAÇARI · EMPURRADA" — o mesmo rótulo do seletor de contexto. */
  rotulo: string;
  garantia: GarantiaDeComparacao;
}

/**
 * O relatório da garantia de uma promoção — a resposta a "e as comparações?".
 *
 * `paresElegiveis` é a soma das vigências que **tinham** anterior: é o
 * denominador que a Visão Gerencial vai mostrar, e é sempre igual a
 * `jaExistiam + calculados + falhas.length`. `semAnterior` fica fora dele de
 * propósito — a primeira vigência de uma série não é um par que faltou.
 */
export interface GarantiaDaPromocao {
  unidades: GarantiaDaUnidade[];
  paresElegiveis: number;
  jaExistiam: number;
  calculados: number;
  semAnterior: number;
  falhas: FalhaDeComparacao[];
}

interface LinhaDeContexto extends Record<string, unknown> {
  scope_hash: string;
  channel: string | null;
  dataset_family: string;
  /**
   * Os escopos **cadastrados**, e não o `canonical_scope` do snapshot.
   *
   * A identidade canônica guarda tipo e código; o nome da unidade vive em
   * `scope`, e é dele que sai "CAMAÇARI". Ler o outro daria um rótulo escrito
   * em CNPJ — legítimo como identidade, ilegível como resposta a "quais
   * unidades esta importação tocou", e diferente do que o seletor de contexto
   * mostra para a mesma unidade.
   */
  escopos: { scopeType: string; code: string; name: string | null }[] | null;
}

/**
 * Materializa, depois de uma promoção, todas as comparações consecutivas das
 * unidades que aquele arquivo tocou.
 *
 * **Por que aqui e não dentro de `promote`.** `@workspace/comparison` depende de
 * `@workspace/ingest` (o canal da vigência é derivado por lá), então a
 * dependência inversa não existe: quem promove não pode chamar o motor. Esta
 * função é a metade que faltava, e quem a costura é a rota de promoção — o
 * único lugar que já tem as duas na mão.
 *
 * **Por que uma vez por unidade e sem período.** Um arquivo consolidado traz
 * cinco unidades na mesma vigência, e cada uma tem a sua série: garantir só a
 * data promovida deixaria de fora qualquer par anterior que nunca foi
 * materializado — que é exatamente o estado em que uma base fica quando as
 * comparações só nasciam ao abrir a tela. Sem `periodo`, cada unidade sai da
 * promoção com a série inteira comparada, e a segunda promoção não recalcula
 * nada porque a primeira já gravou (`jaExistiam`).
 *
 * **Nada é inventado.** A vigência sem anterior continua sem comparação e é
 * contada em `semAnterior`: "sem vigência" segue significando ausência real de
 * histórico, aqui como na faixa do ano.
 */
export async function garantirComparacoesDaPromocao(
  db: Database,
  snapshotIds: string[],
  opcoes: { computedBy?: string } = {},
): Promise<GarantiaDaPromocao> {
  const vazio: GarantiaDaPromocao = {
    unidades: [],
    paresElegiveis: 0,
    jaExistiam: 0,
    calculados: 0,
    semAnterior: 0,
    falhas: [],
  };
  if (snapshotIds.length === 0) return vazio;

  /*
    Os contextos que esta promoção tocou, e não os do banco.

    Um arquivo de uma unidade não pode fazer a promoção pagar pela comparação
    das outras quarenta — é a mesma regra de recorte que vale para a pergunta
    do assistente, dita do lado de quem importa.
  */
  const { rows } = await db.execute<LinhaDeContexto>(sql`
    SELECT s.scope_hash,
           ${channelSql("s.source_label")} AS channel,
           s.dataset_family,
           (SELECT json_agg(json_build_object(
                      'scopeType', sc.scope_type,
                      'code', sc.code,
                      'name', sc.name)
                    ORDER BY sc.scope_type, sc.code)
              FROM snapshot_scope ss
              JOIN scope sc ON sc.id = ss.scope_id
             WHERE ss.snapshot_id = s.id) AS escopos
      FROM snapshot s
     WHERE s.id IN (${sql.join(
       snapshotIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
  `);

  /*
    Uma unidade, uma garantia — mesmo quando o arquivo trouxe duas coberturas.

    Cavalo e carreta da mesma unidade são dois snapshots com o mesmo contexto e
    séries distintas, e `garantirComparacoes` já percorre as duas de uma vez
    (o par é montado por `findPreviousSnapshot`, que respeita a cobertura).
    Chamar por snapshot faria a segunda chamada recontar como `jaExistiam` o
    que a primeira acabou de calcular, e o relatório da promoção sairia com o
    dobro dos pares.
  */
  const porContexto = new Map<string, LinhaDeContexto>();
  for (const linha of rows) {
    porContexto.set(
      `${linha.scope_hash}|${linha.channel ?? ""}|${linha.dataset_family}`,
      linha,
    );
  }

  const unidades: GarantiaDaUnidade[] = [];
  for (const linha of porContexto.values()) {
    const contexto: SeriesContext = {
      scopeHash: linha.scope_hash,
      channel: linha.channel,
      datasetFamily: linha.dataset_family,
    };
    const escopos = linha.escopos ?? [];
    unidades.push({
      scopeHash: linha.scope_hash,
      channel: linha.channel,
      datasetFamily: linha.dataset_family,
      rotulo: contextLabel(escopos, linha.channel, linha.scope_hash),
      garantia: await garantirComparacoes(db, contexto, undefined, {
        computedBy: opcoes.computedBy ?? "ingest:promocao",
      }),
    });
  }

  const soma = (f: (g: GarantiaDeComparacao) => number) =>
    unidades.reduce((total, u) => total + f(u.garantia), 0);
  const falhas = unidades.flatMap((u) => u.garantia.falhas);

  return {
    unidades,
    paresElegiveis: soma((g) => g.jaExistiam + g.calculados) + falhas.length,
    jaExistiam: soma((g) => g.jaExistiam),
    calculados: soma((g) => g.calculados),
    semAnterior: soma((g) => g.semAnterior),
    falhas,
  };
}
