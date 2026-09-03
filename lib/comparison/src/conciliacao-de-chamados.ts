import { sql, type SQL } from "drizzle-orm";
import {
  ALTERACAO_DE_ORIGEM_VISIVEL,
  type Database,
} from "@workspace/db";

/**
 * CONCILIAÇÃO DE CHAMADOS — a planilha e a fila, alteração a alteração.
 *
 * O produto já responde às duas metades desta pergunta, separadas de propósito
 * e nunca somadas (`schema/tickets.ts`): a comparação de vigências diz **o que
 * a Ambev mexeu** entre duas planilhas, e a fila de chamados diz **o que se
 * pediu** e o que voltou aplicado. O que nenhuma das duas responde — e é a
 * pergunta que quem opera faz todo dia — é se as duas contam a mesma história:
 *
 * > Para cada alteração que a planilha importada trouxe, existe um chamado que
 * > a pediu? E para cada chamado que pediu alteração, ela apareceu na planilha?
 *
 * Este arquivo é essa terceira leitura, e só ela. Não recalcula comparação
 * nenhuma, não lê arquivo, não escreve nada: cruza `change` de um lado com
 * `ticket_change` do outro e classifica cada par em uma das quatro situações
 * abaixo.
 *
 * ---------------------------------------------------------------------------
 * Conciliar não é somar
 * ---------------------------------------------------------------------------
 *
 * A regra que separa as duas superfícies continua valendo aqui, inteira: **o
 * impacto de um chamado nunca é somado ao da planilha.** Esta leitura publica
 * os dois lado a lado e diz se batem — que é o oposto de fundi-los. Um número
 * desta tela nunca entra em total financeiro nenhum: os campos de dinheiro
 * saem daqui para explicar uma divergência, não para compor uma apuração.
 *
 * ---------------------------------------------------------------------------
 * O grão, e por que ele é este
 * ---------------------------------------------------------------------------
 *
 * O par **(placa, parâmetro)**. É o único grão em que os dois lados falam a
 * mesma língua: `change` é uma linha por entidade+atributo dentro de uma
 * comparação, e `ticket_change` é uma linha por chamado+parâmetro dentro de um
 * envio. Conciliar por placa apenas diria "esta placa mudou e teve chamado" sem
 * dizer se mudou *no que* o chamado pediu — que é a única pergunta que
 * interessa.
 *
 * A chave do parâmetro é `attribute_code`, e **não** `parameter_label`. O
 * rótulo é o cabeçalho do arquivo de chamados ("Frete peso", "Pedágio"), e o
 * `change` não o conhece: o vocabulário comum é o código que o dicionário
 * resolve dos dois lados. Uma linha sem código não é conciliável — e vai para a
 * contagem de fora, nunca para uma das quatro situações. Ver
 * `FORA_DA_CONCILIACAO` abaixo: ela é publicada, porque suprimir em silêncio o
 * que não se sabe classificar é a forma mais fácil de esta tela mentir.
 *
 * ---------------------------------------------------------------------------
 * Um envio, e nunca a tabela inteira
 * ---------------------------------------------------------------------------
 *
 * `readTicketImport` **só insere** — cada `ticket_import` é um retrato completo
 * da fila (é o que o Monitoramento explora, em `schema/monitoramento-de-chamados.ts`).
 * O efeito colateral é uma armadilha de contagem: o mesmo chamado existe em
 * `ticket` uma vez **por envio**, e contar `ticket_change` sem recortar por
 * envio multiplicaria a fila pelo número de importações. Um mês de importações
 * diárias devolveria trinta vezes o número certo, e nada na tela denunciaria.
 *
 * Por isso a conciliação é sempre **uma comparação contra um envio**, e os dois
 * ids são obrigatórios. `envioMaisRecenteLido` diz qual é o padrão; a escolha
 * fica com quem pergunta.
 *
 * ---------------------------------------------------------------------------
 * A unidade não é conferida — é medida
 * ---------------------------------------------------------------------------
 *
 * O arquivo de chamados nomeia a unidade em `ticket_import.serie` (texto, como
 * a Ambev escreveu); a vigência a nomeia em `snapshot.scope_hash` (identidade
 * canônica). As duas não se traduzem uma na outra, e inventar essa tradução
 * seria o defeito que a `0049` documenta.
 *
 * O que dá para fazer sem inventar nada é **medir**: quantas placas cada lado
 * tem, e quantas os dois têm em comum (`placasEmComum`). Conciliar Recife
 * contra Camaçari devolve zero placas em comum, e é isso que a tela mostra —
 * um fato contado, e não um palpite sobre cadastro.
 */

/**
 * As quatro situações de um par — mutuamente exclusivas e exaustivas.
 *
 * Exaustivas sobre a **união** dos dois lados, e é essa escolha que faz a tela
 * responder à pergunta inteira: uma leitura que partisse só da planilha nunca
 * mostraria o chamado que pediu o que a planilha não aplicou, que é metade do
 * que se procura aqui.
 *
 * CONCILIADA   — os dois lados existem e não se contradizem.
 * DIVERGENTE   — os dois lados existem e o valor final não bate.
 * SEM_CHAMADO  — a planilha mudou e nenhum chamado deste envio pediu.
 * SEM_ALTERACAO— o chamado pediu e a planilha comparada não mudou.
 */
export const SITUACOES_DA_CONCILIACAO = [
  "CONCILIADA",
  "DIVERGENTE",
  "SEM_CHAMADO",
  "SEM_ALTERACAO",
] as const;

export type SituacaoDaConciliacao = (typeof SITUACOES_DA_CONCILIACAO)[number];

/**
 * Sobre o que o veredito foi dado — porque "bate" não quer dizer o mesmo nos
 * três casos, e a tela precisa poder dizer qual.
 *
 * VALOR      — os dois lados trouxeram número, e a conta foi feita.
 * TEXTO      — os dois trouxeram texto que não é número, comparados normalizados.
 * EXISTENCIA — um dos lados não tem valor final para comparar, e o veredito é
 *              só sobre existir. É o caso mais comum do export real: 96% das
 *              alterações de chamado não são `SET` — são troca de fórmula ou
 *              inclusão de item, que mudam a remuneração sem que exista "de 10
 *              para 12" (ver `schema/tickets.ts`, `changeKind`). Chamar isso de
 *              conciliado por valor seria afirmar uma conferência que não houve.
 */
export type BaseDoVeredito = "VALOR" | "TEXTO" | "EXISTENCIA";

/**
 * Quanto dois valores podem diferir e ainda serem o mesmo valor.
 *
 * Um centavo. A planilha e o chamado passam por arredondamentos diferentes
 * antes de chegarem aqui, e publicar "divergente" por R$ 0,004 encheria a fila
 * de divergências que ninguém consegue resolver — e faria as de verdade
 * sumirem no meio.
 *
 * É parâmetro, e não constante enterrada na consulta, pela mesma razão que
 * `chamados.ts` dá para o predicado `DIVERGENT` não ser coluna: a régua é uma
 * pergunta da tela, e um dia alguém vai querer apertá-la.
 */
export const TOLERANCIA_PADRAO = 0.01;

export interface RecorteDaConciliacao {
  /** A comparação de vigências — um `change_set`, nunca uma lista. */
  changeSetId: string;
  /** O envio de chamados — um `ticket_import`, pelo motivo acima. */
  ticketImportId: string;
  /**
   * Só os chamados que nomeiam uma das duas vigências comparadas
   * (`ticket.vigencia_label` = rótulo A ou B).
   *
   * Desligado por padrão, e de propósito. `Vig. Abertura` é a vigência contra a
   * qual o chamado foi aberto e casa com `snapshot.source_label` — quando vem
   * preenchida. Num envio em que ela não venha, ligar isto por conta própria
   * esvaziaria a tela inteira sem dizer por quê. Quem liga é quem pergunta, e a
   * tela diz quantos chamados o filtro alcança antes de alguém clicar.
   */
  somenteVigenciaComparada?: boolean;
  /** Quanto dois valores podem diferir e ainda baterem. Padrão: um centavo. */
  tolerancia?: number;
}

export interface FiltrosDaConciliacao {
  situacao?: SituacaoDaConciliacao;
  /** Cru, como as duas tabelas o gravam — quem normaliza é quem monta as abas. */
  entityType?: string;
  /** Texto livre: placa, parâmetro ou número de chamado. */
  search?: string;
}

/** O que cada lado tem, antes de qualquer cruzamento. */
export interface LadoDaConciliacao {
  /** Linhas na população — `change` de um lado, `ticket_change` do outro. */
  alteracoes: number;
  /** Pares (placa, parâmetro) distintos. Do lado da planilha é igual a
   *  `alteracoes`, porque uma comparação tem uma linha por par; do lado dos
   *  chamados pode ser menor, quando dois chamados pedem o mesmo parâmetro na
   *  mesma placa. */
  pares: number;
  /** Placas distintas. */
  placas: number;
  /**
   * Linhas que ficaram **fora** da conciliação por falta de chave — sem placa
   * ou sem parâmetro reconhecido no dicionário.
   *
   * Contadas e publicadas. Elas não entram em nenhuma das quatro situações
   * porque não há como cruzá-las, e omiti-las faria os dois totais desta tela
   * não fecharem com os das telas de origem.
   */
  foraDaConciliacao: number;
}

export interface ResumoDaConciliacao {
  planilha: LadoDaConciliacao;
  chamados: LadoDaConciliacao;
  /** Pares distintos na união dos dois lados — o total das quatro situações. */
  pares: number;
  conciliadas: number;
  divergentes: number;
  semChamado: number;
  semAlteracao: number;
  /**
   * A conta que dá nome ao módulo: quantas alterações a planilha trouxe menos
   * quantas os chamados trouxeram. Zero é o estado esperado.
   *
   * Positivo: a planilha mudou mais do que se pediu. Negativo: pediu-se mais do
   * que a planilha mudou. É uma diferença de **contagem**, e nunca de dinheiro.
   */
  diferenca: number;
  /** Placas que os dois lados têm. Zero com os dois lados cheios é o sinal de
   *  que o envio e a vigência são de unidades diferentes. */
  placasEmComum: number;
}

/** Um par (placa, parâmetro), com os dois lados e o veredito. */
export interface LinhaDaConciliacao {
  entityLabel: string;
  entityType: string | null;
  attributeCode: string;
  attributeName: string | null;
  situacao: SituacaoDaConciliacao;
  /** `null` quando não houve o que confrontar — SEM_CHAMADO e SEM_ALTERACAO. */
  base: BaseDoVeredito | null;

  /* O lado da planilha — nulo quando a situação é SEM_ALTERACAO. */
  changeId: number | null;
  planilhaAntes: string | null;
  planilhaDepois: string | null;
  planilhaDepoisNumerico: number | null;
  planilhaImpacto: number | null;
  planilhaPeriodicidade: string | null;
  /** Quantas alterações desta comparação caem neste mesmo par. Normalmente 1. */
  alteracoesNoPar: number;

  /* O lado dos chamados — nulo quando a situação é SEM_CHAMADO. */
  ticketChangeId: string | null;
  /** O chamado representante do par: o mais recente, quando há mais de um. */
  externalId: string | null;
  statusBucket: string | null;
  /** Quantos chamados deste envio pedem este mesmo par. */
  chamadosNoPar: number;
  parameterLabel: string | null;
  /** SET | ADD | FORM_THIS | … — o que o chamado fez com o parâmetro. */
  changeKind: string | null;
  chamadoAntes: string | null;
  chamadoDepois: string | null;
  chamadoDepoisNumerico: number | null;
  chamadoImpacto: number | null;
  /** ARQUIVO | VIGENCIA | AUSENTE — a força de prova do "antes" do chamado. */
  beforeSource: string | null;
  vigenciaLabel: string | null;

  /** `planilhaDepoisNumerico − chamadoDepoisNumerico`, quando os dois existem. */
  diferencaDeValor: number | null;
}

export interface PaginaDaConciliacao {
  linhas: LinhaDaConciliacao[];
  total: number;
}

/**
 * A população da planilha — as mesmas alterações que a fila de Justificativas
 * enfileira, e pelo mesmo recorte.
 *
 * Sem placa fica de fora (`LAYOUT_CHANGE` não tem ativo, e um par sem placa não
 * cruza com chamado nenhum), e a origem oculta também
 * (`ALTERACAO_DE_ORIGEM_VISIVEL`): uma importação escondida não pode voltar a
 * aparecer por uma porta lateral.
 *
 * **E um par é uma linha, como do outro lado.** O motor emite uma alteração por
 * `(entidade, atributo)`, então dentro de uma comparação o par já seria único —
 * *se* a placa fosse a entidade. Ela não é: duas identidades canônicas podem
 * carregar a mesma placa (é o que as migrations de fusão de identidade tratam),
 * e a chave daqui é o texto da placa normalizado, porque é a única coisa que o
 * chamado também tem. Sem o `row_number()`, esse caso raro faria o `FULL OUTER
 * JOIN` multiplicar o lado dos chamados e as quatro situações deixariam de
 * somar o total — em silêncio. Com ele, o par continua sendo uma linha, e
 * `alteracoes_no_par` diz quantas ela representa.
 */
function alteracoesDaPlanilha(changeSetId: string): SQL {
  return sql`
    SELECT *
      FROM (
        SELECT change.id                         AS change_id,
               upper(btrim(change.entity_label)) AS placa,
               change.attribute_code             AS parametro,
               change.entity_label,
               change.entity_type,
               change.attribute_name,
               change.value_before,
               change.value_after,
               change.numeric_after,
               change.impact_amount,
               change.impact_periodicity,
               row_number() OVER (
                 PARTITION BY upper(btrim(change.entity_label)), change.attribute_code
                 ORDER BY change.id DESC
               ) AS rn,
               count(*) OVER (
                 PARTITION BY upper(btrim(change.entity_label)), change.attribute_code
               ) AS alteracoes_no_par
          FROM change
         WHERE change.change_set_id = ${changeSetId}::uuid
           AND change.entity_label IS NOT NULL
           AND change.attribute_code IS NOT NULL
           AND ${ALTERACAO_DE_ORIGEM_VISIVEL}
      ) escolhidas
     WHERE rn = 1
  `;
}

/**
 * A população dos chamados — as alterações de parâmetro de **um** envio.
 *
 * `row_number()` escolhe o representante do par e `count(*) OVER` diz quantos
 * ele representa. As duas coisas na mesma passada porque são a mesma pergunta:
 * quando dois chamados pedem o mesmo parâmetro na mesma placa, a tela mostra o
 * mais recente **e** diz que há outro — mostrar um e calar o outro seria
 * esconder justamente o caso em que a fila se contradiz.
 *
 * O mais recente é por `opened_at`, e o desempate é a linha física do arquivo:
 * `opened_at` pode não ter vindo, e ordenação instável faria a mesma consulta
 * devolver representantes diferentes a cada execução.
 */
function alteracoesDosChamados(
  ticketImportId: string,
  vigencias: string[] | null,
): SQL {
  const porVigencia =
    vigencias === null
      ? sql``
      : vigencias.length === 0
        ? /* Recorte que não alcança nada é `false`, e nunca "sem recorte": ver
             `chamados.ts`, onde a mesma decisão está escrita por extenso. */
          sql` AND false`
        : sql` AND t.vigencia_label IN (${sql.join(
            vigencias.map((v) => sql`${v}`),
            sql`, `,
          )})`;

  return sql`
    SELECT *
      FROM (
        SELECT tc.id                          AS ticket_change_id,
               upper(btrim(t.entity_label))   AS placa,
               tc.attribute_code              AS parametro,
               t.entity_label,
               t.entity_type,
               t.external_id,
               t.status_bucket,
               t.vigencia_label,
               tc.parameter_label,
               tc.change_kind,
               tc.value_before_raw,
               tc.value_after_raw,
               tc.value_after_numeric,
               tc.impact_amount,
               tc.before_source,
               row_number() OVER (
                 PARTITION BY upper(btrim(t.entity_label)), tc.attribute_code
                 ORDER BY t.opened_at DESC NULLS LAST, t.source_row_index DESC
               ) AS rn,
               count(*) OVER (
                 PARTITION BY upper(btrim(t.entity_label)), tc.attribute_code
               ) AS chamados_no_par
          FROM ticket_change tc
          JOIN ticket t ON t.id = tc.ticket_id
         WHERE tc.ticket_import_id = ${ticketImportId}::uuid
           AND t.entity_label IS NOT NULL
           AND tc.attribute_code IS NOT NULL
           ${porVigencia}
      ) escolhidos
     WHERE rn = 1
  `;
}

/**
 * O cruzamento — a consulta que todo o resto deste arquivo lê.
 *
 * `FULL OUTER JOIN` porque a pergunta tem dois lados, e um `LEFT JOIN` a partir
 * da planilha responderia só metade dela: o chamado que pediu o que a planilha
 * não aplicou não apareceria em lugar nenhum, e é justamente ele que se
 * procura.
 */
function paresDaConciliacao(recorte: RecorteDaConciliacao, vigencias: string[] | null): SQL {
  const tolerancia = recorte.tolerancia ?? TOLERANCIA_PADRAO;

  return sql`
    WITH planilha AS (${alteracoesDaPlanilha(recorte.changeSetId)}),
         chamados AS (${alteracoesDosChamados(recorte.ticketImportId, vigencias)}),
         par AS (
           SELECT COALESCE(p.placa, ch.placa)               AS placa,
                  COALESCE(p.parametro, ch.parametro)       AS parametro,
                  COALESCE(p.entity_label, ch.entity_label) AS entity_label,
                  COALESCE(p.entity_type, ch.entity_type)   AS entity_type,
                  p.attribute_name,
                  p.change_id,
                  p.value_before                            AS planilha_antes,
                  p.value_after                             AS planilha_depois,
                  p.numeric_after                           AS planilha_depois_numerico,
                  p.impact_amount                           AS planilha_impacto,
                  p.impact_periodicity                      AS planilha_periodicidade,
                  COALESCE(p.alteracoes_no_par, 0)          AS alteracoes_no_par,
                  ch.ticket_change_id,
                  ch.external_id,
                  ch.status_bucket,
                  ch.vigencia_label,
                  ch.parameter_label,
                  ch.change_kind,
                  ch.value_before_raw                       AS chamado_antes,
                  ch.value_after_raw                        AS chamado_depois,
                  ch.value_after_numeric                    AS chamado_depois_numerico,
                  ch.impact_amount                          AS chamado_impacto,
                  ch.before_source,
                  COALESCE(ch.chamados_no_par, 0)           AS chamados_no_par,
                  CASE
                    WHEN p.numeric_after IS NOT NULL
                     AND ch.value_after_numeric IS NOT NULL THEN 'VALOR'
                    WHEN p.numeric_after IS NULL
                     AND ch.value_after_numeric IS NULL
                     AND btrim(COALESCE(p.value_after, '')) <> ''
                     AND btrim(COALESCE(ch.value_after_raw, '')) <> '' THEN 'TEXTO'
                    ELSE 'EXISTENCIA'
                  END AS base
             FROM planilha p
             FULL OUTER JOIN chamados ch
               ON ch.placa = p.placa AND ch.parametro = p.parametro
         )
    SELECT par.*,
           CASE
             WHEN par.ticket_change_id IS NULL THEN 'SEM_CHAMADO'
             WHEN par.change_id IS NULL        THEN 'SEM_ALTERACAO'
             WHEN par.base = 'VALOR'
                  AND abs(par.planilha_depois_numerico - par.chamado_depois_numerico)
                      > ${tolerancia}::numeric THEN 'DIVERGENTE'
             WHEN par.base = 'TEXTO'
                  AND upper(btrim(par.planilha_depois)) <> upper(btrim(par.chamado_depois))
                  THEN 'DIVERGENTE'
             ELSE 'CONCILIADA'
           END AS situacao,
           CASE
             WHEN par.change_id IS NULL OR par.ticket_change_id IS NULL THEN NULL
             ELSE par.base
           END AS base_do_veredito,
           CASE
             WHEN par.planilha_depois_numerico IS NULL
               OR par.chamado_depois_numerico IS NULL THEN NULL
             ELSE par.planilha_depois_numerico - par.chamado_depois_numerico
           END AS diferenca_de_valor
      FROM par
  `;
}

/** Os rótulos das duas vigências comparadas — a chave do recorte opcional. */
async function rotulosDaComparacao(
  db: Database,
  changeSetId: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ a: string | null; b: string | null }>(sql`
    SELECT sa.source_label AS a, sb.source_label AS b
      FROM change_set cs
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE cs.id = ${changeSetId}::uuid
  `);
  const linha = rows[0];
  if (!linha) return [];
  return [linha.a, linha.b].filter((v): v is string => Boolean(v));
}

async function vigenciasDoRecorte(
  db: Database,
  recorte: RecorteDaConciliacao,
): Promise<string[] | null> {
  if (!recorte.somenteVigenciaComparada) return null;
  return await rotulosDaComparacao(db, recorte.changeSetId);
}

function numero(bruto: unknown): number {
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 0;
}

function talvezNumero(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O resumo — os dois lados, o cruzamento e a diferença de contagem.
 *
 * Três consultas e não uma: os dois lados são contados **antes** do cruzamento,
 * porque é ali que moram as linhas que não têm chave (sem placa, sem parâmetro
 * reconhecido) e que o `FULL OUTER JOIN` jamais veria. Um resumo montado só do
 * cruzamento publicaria "1.200 alterações" onde a comparação tem 1.310, e a
 * tela discordaria da tela de Alterações sem nenhum aviso.
 */
export async function resumoDaConciliacao(
  db: Database,
  recorte: RecorteDaConciliacao,
): Promise<ResumoDaConciliacao> {
  const vigencias = await vigenciasDoRecorte(db, recorte);

  const [ladoPlanilha, ladoChamados, cruzamento] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      SELECT count(*) FILTER (
               WHERE change.entity_label IS NOT NULL AND change.attribute_code IS NOT NULL
             )                                                       AS alteracoes,
             count(DISTINCT (upper(btrim(change.entity_label)), change.attribute_code)) FILTER (
               WHERE change.entity_label IS NOT NULL AND change.attribute_code IS NOT NULL
             )                                                       AS pares,
             count(DISTINCT upper(btrim(change.entity_label))) FILTER (
               WHERE change.entity_label IS NOT NULL AND change.attribute_code IS NOT NULL
             )                                                       AS placas,
             count(*) FILTER (
               WHERE change.entity_label IS NULL OR change.attribute_code IS NULL
             )                                                       AS fora
        FROM change
       WHERE change.change_set_id = ${recorte.changeSetId}::uuid
         AND ${ALTERACAO_DE_ORIGEM_VISIVEL}
    `),
    db.execute<Record<string, unknown>>(sql`
      SELECT count(*) FILTER (
               WHERE t.entity_label IS NOT NULL AND tc.attribute_code IS NOT NULL
             )                                                       AS alteracoes,
             count(DISTINCT (upper(btrim(t.entity_label)), tc.attribute_code)) FILTER (
               WHERE t.entity_label IS NOT NULL AND tc.attribute_code IS NOT NULL
             )                                                       AS pares,
             count(DISTINCT upper(btrim(t.entity_label))) FILTER (
               WHERE t.entity_label IS NOT NULL AND tc.attribute_code IS NOT NULL
             )                                                       AS placas,
             count(*) FILTER (
               WHERE t.entity_label IS NULL OR tc.attribute_code IS NULL
             )                                                       AS fora
        FROM ticket_change tc
        JOIN ticket t ON t.id = tc.ticket_id
       WHERE tc.ticket_import_id = ${recorte.ticketImportId}::uuid
         ${
           vigencias === null
             ? sql``
             : vigencias.length === 0
               ? sql` AND false`
               : sql` AND t.vigencia_label IN (${sql.join(
                   vigencias.map((v) => sql`${v}`),
                   sql`, `,
                 )})`
         }
    `),
    db.execute<Record<string, unknown>>(sql`
      WITH conciliacao AS (${paresDaConciliacao(recorte, vigencias)})
      SELECT count(*)                                                       AS pares,
             count(*) FILTER (WHERE situacao = 'CONCILIADA')                AS conciliadas,
             count(*) FILTER (WHERE situacao = 'DIVERGENTE')                AS divergentes,
             count(*) FILTER (WHERE situacao = 'SEM_CHAMADO')               AS sem_chamado,
             count(*) FILTER (WHERE situacao = 'SEM_ALTERACAO')             AS sem_alteracao,
             count(DISTINCT placa) FILTER (
               WHERE change_id IS NOT NULL AND ticket_change_id IS NOT NULL
             )                                                              AS placas_em_comum
        FROM conciliacao
    `),
  ]);

  const p = ladoPlanilha.rows[0] ?? {};
  const c = ladoChamados.rows[0] ?? {};
  const x = cruzamento.rows[0] ?? {};

  const planilha: LadoDaConciliacao = {
    alteracoes: numero(p.alteracoes),
    pares: numero(p.pares),
    placas: numero(p.placas),
    foraDaConciliacao: numero(p.fora),
  };
  const chamados: LadoDaConciliacao = {
    alteracoes: numero(c.alteracoes),
    pares: numero(c.pares),
    placas: numero(c.placas),
    foraDaConciliacao: numero(c.fora),
  };

  return {
    planilha,
    chamados,
    pares: numero(x.pares),
    conciliadas: numero(x.conciliadas),
    divergentes: numero(x.divergentes),
    semChamado: numero(x.sem_chamado),
    semAlteracao: numero(x.sem_alteracao),
    diferenca: planilha.alteracoes - chamados.alteracoes,
    placasEmComum: numero(x.placas_em_comum),
  };
}

/**
 * A lista — um par por linha, na ordem em que se trabalha.
 *
 * A ordenação é a da urgência, e não a alfabética: divergência primeiro (os
 * dois lados existem e discordam — é o achado), depois o que a planilha mudou
 * sem chamado, depois o chamado que a planilha não aplicou, e por último o que
 * está certo. Dentro de cada faixa, a placa e o parâmetro, para a lista ser
 * estável entre duas leituras.
 */
export async function linhasDaConciliacao(
  db: Database,
  recorte: RecorteDaConciliacao,
  filtros: FiltrosDaConciliacao = {},
  paginacao: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<PaginaDaConciliacao> {
  const vigencias = await vigenciasDoRecorte(db, recorte);

  const condicoes: SQL[] = [];
  if (filtros.situacao) condicoes.push(sql`situacao = ${filtros.situacao}`);
  if (filtros.entityType) condicoes.push(sql`entity_type = ${filtros.entityType}`);
  if (filtros.search && filtros.search.trim() !== "") {
    const alvo = `%${filtros.search.trim()}%`;
    condicoes.push(sql`(
      entity_label ILIKE ${alvo}
      OR parametro ILIKE ${alvo}
      OR COALESCE(attribute_name, '') ILIKE ${alvo}
      OR COALESCE(parameter_label, '') ILIKE ${alvo}
      OR COALESCE(external_id, '') ILIKE ${alvo}
    )`);
  }
  const onde =
    condicoes.length === 0
      ? sql``
      : sql` WHERE ${sql.join(condicoes, sql` AND `)}`;

  const base = sql`WITH conciliacao AS (${paresDaConciliacao(recorte, vigencias)})`;

  const [pagina, contagem] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      ${base}
      SELECT * FROM conciliacao
      ${onde}
       ORDER BY CASE situacao
                  WHEN 'DIVERGENTE'    THEN 0
                  WHEN 'SEM_CHAMADO'   THEN 1
                  WHEN 'SEM_ALTERACAO' THEN 2
                  ELSE 3
                END,
                placa,
                parametro
       LIMIT ${paginacao.limit} OFFSET ${paginacao.offset}
    `),
    db.execute<Record<string, unknown>>(sql`
      ${base}
      SELECT count(*) AS total FROM conciliacao ${onde}
    `),
  ]);

  return {
    total: numero(contagem.rows[0]?.total),
    linhas: pagina.rows.map((r) => ({
      entityLabel: String(r.entity_label ?? r.placa ?? ""),
      entityType: (r.entity_type as string | null) ?? null,
      attributeCode: String(r.parametro ?? ""),
      attributeName: (r.attribute_name as string | null) ?? null,
      situacao: r.situacao as SituacaoDaConciliacao,
      base: (r.base_do_veredito as BaseDoVeredito | null) ?? null,

      changeId: talvezNumero(r.change_id),
      planilhaAntes: (r.planilha_antes as string | null) ?? null,
      planilhaDepois: (r.planilha_depois as string | null) ?? null,
      planilhaDepoisNumerico: talvezNumero(r.planilha_depois_numerico),
      planilhaImpacto: talvezNumero(r.planilha_impacto),
      planilhaPeriodicidade: (r.planilha_periodicidade as string | null) ?? null,
      alteracoesNoPar: numero(r.alteracoes_no_par),

      ticketChangeId: (r.ticket_change_id as string | null) ?? null,
      externalId: (r.external_id as string | null) ?? null,
      statusBucket: (r.status_bucket as string | null) ?? null,
      chamadosNoPar: numero(r.chamados_no_par),
      parameterLabel: (r.parameter_label as string | null) ?? null,
      changeKind: (r.change_kind as string | null) ?? null,
      chamadoAntes: (r.chamado_antes as string | null) ?? null,
      chamadoDepois: (r.chamado_depois as string | null) ?? null,
      chamadoDepoisNumerico: talvezNumero(r.chamado_depois_numerico),
      chamadoImpacto: talvezNumero(r.chamado_impacto),
      beforeSource: (r.before_source as string | null) ?? null,
      vigenciaLabel: (r.vigencia_label as string | null) ?? null,

      diferencaDeValor: talvezNumero(r.diferenca_de_valor),
    })),
  };
}

/**
 * Os tipos de ativo presentes na conciliação — as abas da tela.
 *
 * Da união dos dois lados, e não da planilha só: um tipo que só aparece do lado
 * dos chamados existe na conciliação, e uma aba faltando esconderia justamente
 * a pendência que ninguém está vendo.
 */
export async function tiposDaConciliacao(
  db: Database,
  recorte: RecorteDaConciliacao,
): Promise<{ entityType: string | null; pares: number }[]> {
  const vigencias = await vigenciasDoRecorte(db, recorte);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    WITH conciliacao AS (${paresDaConciliacao(recorte, vigencias)})
    SELECT entity_type, count(*) AS pares
      FROM conciliacao
     GROUP BY entity_type
     ORDER BY count(*) DESC
  `);
  return rows.map((r) => ({
    entityType: (r.entity_type as string | null) ?? null,
    pares: numero(r.pares),
  }));
}
