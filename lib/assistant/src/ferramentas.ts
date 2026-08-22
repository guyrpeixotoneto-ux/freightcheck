/**
 * CORPUS B e C — as ferramentas, e a regra que as governa.
 *
 * **O modelo interpreta; o banco calcula.** Nenhuma função deste arquivo
 * implementa regra de negócio: todas envolvem serviços que já existiam e que as
 * telas já usam. É o que garante que o assistente e a tela de Parâmetros nunca
 * discordem — os dois chamam `getFamiliesView`, e um número diferente entre
 * eles seria um defeito no motor, não uma divergência de leitura.
 *
 * **Todo resultado carrega o recorte que o produziu.** `Evidencia.recorte` diz
 * unidade, canal e vigência de cada número. Isto não é enfeite de auditoria: é
 * o mecanismo de isolamento. Uma evidência sem recorte não pode ser usada para
 * responder uma pergunta com recorte, e a validação recusa a mistura.
 *
 * **O panorama é o caso que exigiu correção.** A versão anterior chamava
 * `getOverview`, que soma o banco inteiro — todas as unidades, todos os canais.
 * Num produto de uma unidade só isso passa despercebido; na segunda unidade
 * importada, a resposta a "quantas vigências temos?" passaria a incluir
 * vigências de uma operação que quem perguntou não opera. Aqui ele é filtrado
 * pelo contexto como todo o resto.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { bookEntryTable, type Database } from "@workspace/db";
import {
  buildCockpit,
  contextFilter,
  getAttributeSeries,
  getChangeProvenance,
  getEndToEndAnalysis,
  getFamiliesView,
  getGroupedView,
  getGroupVehicles,
  getRangeAnalysis,
  listContexts,
  listPeriods,
  resolveContext,
  type ContextInfo,
  type SeriesContext,
} from "@workspace/comparison";
import { getVisaoDeFrota } from "@workspace/composition";
import { AVISO_DE_CIRCULARIDADE, getDREDaFrota, getPonteDaDRE, explicarResultado } from "@workspace/dre";
import {
  INTEIRO,
  cobertura,
  dinheiro,
  impactoEmTexto,
  numerosDoImpacto,
  rotuloDoPeriodo,
} from "./formato";
import type { Alvo } from "./parametros";
import { extrairAnexo } from "./anexos";
import { normalizar } from "./normalizar";

// ── O formato de toda evidência ─────────────────────────────────────────────

export interface Fato {
  rotulo: string;
  valor: string;
  detalhe?: string;
  /**
   * Mecânica do produto, e não resposta a ninguém.
   *
   * Revisão vigente, quantidade de revisões guardadas, tipo da entrada, chave
   * do bloco: são coisas que o assistente precisa saber e que quem perguntou
   * "o que é QLP ADM?" não pediu. Elas saíam na primeira linha da resposta —
   * "Revisão vigente: 1 — 1 revisão guardada" — porque a redação percorria os
   * fatos sem distinguir o que responde do que administra. Marcado assim, o
   * fato continua no dossiê, aparece no painel técnico, sustenta a fonte, e
   * nunca vira frase.
   */
  interno?: boolean;
}

export interface Recorte {
  unidade: string;
  canal: string | null;
  /** O rótulo humano do contexto: "CAMAÇARI · EMPURRADA". */
  contexto: string;
  vigencia?: string;
  intervalo?: string;
}

export interface Evidencia {
  /** Qual ferramenta produziu — vai para o painel de fontes. */
  ferramenta: string;
  titulo: string;
  fatos: Fato[];
  /**
   * Os números crus que este resultado autoriza a citar.
   *
   * A validação em `orquestrador.ts` confere contra esta lista. Um número no
   * texto que não esteja aqui não veio de consulta nenhuma.
   */
  numeros: number[];
  /**
   * Os **identificadores** que este resultado autoriza a citar — placas, hoje.
   *
   * **Por que eles não são números.** `QYP3G72` é o nome de um caminhão. O
   * extrator de afirmações numéricas via `3` e `72` ali dentro e conferia os
   * dois contra a lista de valores apurados: uma placa passava quando algum
   * valor por acaso terminava naqueles dígitos, e reprovava quando não. Medido
   * na bateria real, foi assim que a investigação mais funda que este produto
   * já produziu — dez consultas, seis encadeadas — foi descartada inteira, por
   * trinta e sete fragmentos de dois dígitos que eram pedaços de placa.
   *
   * **A correção não afrouxa nada; ela troca a régua.** Uma placa continua
   * precisando de lastro — só que o lastro é *ser uma placa que voltou de
   * consulta*, e não *coincidir com um valor em reais*. Uma placa inventada
   * passa a ser recusada sempre, e não só quando os dígitos dela não casam por
   * acaso com algum número da tabela.
   *
   * Vazio ou ausente quer dizer "esta consulta não autoriza identificador
   * nenhum" — que é o correto para um agregado.
   */
  identificadores?: string[];
  origem: string;
  recorte?: Recorte;
  tela?: { label: string; href: string };
  nota?: string;
  /**
   * O rótulo do fato que responde — quando não é o primeiro com número.
   *
   * A ferramenta sabe o que ela foi buscar; quem redige, não. Numa série o
   * primeiro número é "pontos na série: 9", e a resposta a "qual o valor do
   * IPVA?" é o último ponto, não a contagem deles. Sem este campo a redação
   * determinística abria com a metainformação e enterrava o valor no meio da
   * lista.
   */
  destaque?: string;
  /**
   * O assunto que **esta consulta descobriu ser o que mais pesa**.
   *
   * É o que permite um segundo salto: quem pergunta "o que devo investigar?"
   * não sabe o nome do parâmetro que vai sair na frente, e por isso não pode
   * pedir a regra dele na mesma frase. Um analista, tendo achado o item, iria
   * ler o que o Book diz sobre ele — e é isso que a orquestração faz com este
   * campo.
   *
   * Só as ferramentas que **ordenam** o preenchem. Uma consulta que devolve o
   * agregado não descobriu assunto nenhum; ela descreveu o conjunto.
   */
  assuntoEmDestaque?: string;
  /**
   * A referência **estruturada** do que esta consulta abriu — para a próxima usar.
   *
   * `assuntoEmDestaque` é o rótulo gerencial ("Consumo negociado cavalo"), e é
   * o que entra na prosa. Ele não serve como argumento: a consulta seguinte
   * precisa do código do atributo e do tipo de ativo, e derivar um do outro
   * exigiria uma busca por nome — que é justamente onde um rename da curadoria
   * quebraria a conversa em silêncio.
   *
   * É este campo que faz o foco da conversa ser uma referência e não um texto.
   * Ver `foco.ts` e `aprofundar.ts`.
   */
  alvoDaDescida?: { codigo: string; equipamento: string; rotulo: string };
}

export interface ContextoResolvido {
  contexto: SeriesContext;
  info: ContextInfo;
  outros: ContextInfo[];
}

function recorteDe(info: ContextInfo, extra: Partial<Recorte> = {}): Recorte {
  const unidade =
    info.scopes.find((s) => s.scopeType === "UNIT" || s.scopeType === "UNIDADE")?.name ??
    info.scopes[0]?.name ??
    info.scopeHash.slice(0, 8);
  return { unidade, canal: info.channel, contexto: info.label, ...extra };
}

// ── Contexto ────────────────────────────────────────────────────────────────

/**
 * Qual unidade e canal esta conversa está descrevendo.
 *
 * Devolve os outros contextos junto, sempre. É o que permite à resposta dizer
 * "estou olhando CAMAÇARI · EMPURRADA, e existem outras duas" em vez de
 * escolher em silêncio — a regra que o produto já aplica em toda tela e que o
 * assistente precisava herdar.
 */
export async function resolverContexto(
  db: Database,
  pedido: Partial<SeriesContext> = {},
): Promise<ContextoResolvido | null> {
  const contextos = await listContexts(db);
  const contexto = await resolveContext(db, pedido, contextos);
  if (!contexto) return null;
  const info = contextos.find(
    (c) => c.scopeHash === contexto.scopeHash && c.channel === contexto.channel,
  );
  if (!info) return null;
  return {
    contexto,
    info,
    outros: contextos.filter((c) => c !== info),
  };
}

/** As vigências que existem — deste contexto, nunca de todos. */
export async function listarVigencias(
  db: Database,
  ctx: ContextoResolvido,
): Promise<Evidencia> {
  const periodos = await listPeriods(db, ctx.contexto);
  return {
    ferramenta: "listarVigencias",
    titulo: `Vigências de ${ctx.info.label}`,
    fatos: [
      {
        rotulo: "Vigências neste contexto",
        valor: INTEIRO.format(periodos.length),
        detalhe: periodos.map((p) => rotuloDoPeriodo(p.effective_date)).join(", "),
      },
      ...(ctx.outros.length > 0
        ? [
            {
              rotulo: "Outros contextos no banco",
              valor: ctx.outros.map((c) => c.label).join(", "),
              detalhe: "não entram em nenhum número desta resposta",
            },
          ]
        : []),
    ],
    numeros: [periodos.length],
    origem: `listPeriods no contexto ${ctx.info.label}`,
    recorte: recorteDe(ctx.info),
    tela: { label: "Vigências", href: "/vigencias" },
  };
}

// ── Panorama, agora com recorte ─────────────────────────────────────────────

interface LinhaPanorama extends Record<string, unknown> {
  vigencias: number;
  primeira: string | null;
  ultima: string | null;
  ativos: number;
  atributos: number;
  alteracoes: number;
  com_impacto: number;
  inconclusivas: number;
}

/**
 * O que existe **neste recorte** — não no banco inteiro.
 *
 * Cada subconsulta filtra por `(unidade, canal)`. A versão anterior usava
 * `getOverview`, que não filtra nada: era o único ponto do assistente capaz de
 * devolver, a uma pergunta sobre CAMAÇARI, um total que incluía MANAUS.
 */
export async function panoramaDoContexto(
  db: Database,
  ctx: ContextoResolvido,
): Promise<Evidencia> {
  const filtro = contextFilter("s", ctx.contexto);

  const { rows } = await db.execute<LinhaPanorama>(sql`
    WITH vig AS (
      SELECT s.id, s.effective_date
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED' AND ${filtro}
    ),
    cs AS (
      SELECT c.id
        FROM change_set c
        JOIN vig ON vig.id = c.snapshot_b_id
    )
    SELECT
      (SELECT count(*) FROM vig)                                    AS vigencias,
      (SELECT min(effective_date)::text FROM vig)                   AS primeira,
      (SELECT max(effective_date)::text FROM vig)                   AS ultima,
      (SELECT count(DISTINCT f.entity_id) FROM fact f
        JOIN vig ON vig.id = f.snapshot_id)                         AS ativos,
      (SELECT count(DISTINCT sa.attribute_id) FROM snapshot_attribute sa
        JOIN vig ON vig.id = sa.snapshot_id)                        AS atributos,
      (SELECT count(*) FROM "change" ch JOIN cs ON cs.id = ch.change_set_id
        WHERE ch.change_type = 'VALUE_CHANGED')                     AS alteracoes,
      (SELECT count(*) FROM "change" ch JOIN cs ON cs.id = ch.change_set_id
        WHERE ch.impact_confidence = 'CALCULATED')                  AS com_impacto,
      (SELECT count(*) FROM "change" ch JOIN cs ON cs.id = ch.change_set_id
        WHERE ch.comparability = 'INCONCLUSIVE')                    AS inconclusivas
  `);

  const t = rows[0];
  const numero = (v: unknown) => Number(v ?? 0);

  return {
    ferramenta: "panoramaDoContexto",
    titulo: `O que ${ctx.info.label} tem importado`,
    fatos: [
      {
        rotulo: "Vigências",
        valor: INTEIRO.format(numero(t?.vigencias)),
        detalhe:
          t?.primeira && t?.ultima
            ? `de ${rotuloDoPeriodo(t.primeira)} a ${rotuloDoPeriodo(t.ultima)}`
            : undefined,
      },
      { rotulo: "Ativos", valor: INTEIRO.format(numero(t?.ativos)), detalhe: "veículos distintos neste recorte" },
      {
        rotulo: "Colunas que este recorte traz",
        valor: INTEIRO.format(numero(t?.atributos)),
      },
      {
        rotulo: "Alterações registradas",
        valor: INTEIRO.format(numero(t?.alteracoes)),
        detalhe: cobertura(numero(t?.com_impacto), numero(t?.alteracoes)),
      },
      {
        rotulo: "Alterações inconclusivas",
        valor: INTEIRO.format(numero(t?.inconclusivas)),
        detalhe: "comparações que o produto se recusa a concluir",
      },
    ],
    numeros: [
      numero(t?.vigencias),
      numero(t?.ativos),
      numero(t?.atributos),
      numero(t?.alteracoes),
      numero(t?.com_impacto),
      numero(t?.inconclusivas),
    ],
    origem: `agregação sobre snapshot/fact/change filtrada por ${ctx.info.label}`,
    recorte: recorteDe(ctx.info),
    tela: { label: "Cobertura de dados", href: "/dados" },
    nota:
      ctx.outros.length > 0
        ? `Só ${ctx.info.label}. Os outros contextos (${ctx.outros
            .map((c) => c.label)
            .join(", ")}) não entram nestes números.`
        : undefined,
  };
}

// ── A leitura de comparação, com o estado pendente inescapável ──────────────

/**
 * O resultado de ler uma visão de comparação: ou a visão, ou a pendência dita.
 *
 * **Por que uma união e não um campo a mais.** O campo já existia e já
 * propagava — `FamiliesView extends GroupedView`, e `getFamiliesView` devolve
 * `{...view}` — e ainda assim seis funções deste arquivo liam a visão sem
 * jamais consultá-lo. Não é descuido de quem escreveu: é o que acontece quando
 * a condição excepcional mora num campo opcional de leitura. Quem escreve a
 * sétima função copia a sexta, e a sexta não olha.
 *
 * Com a união, `visao` não existe sem estreitar o tipo. Uma função nova que
 * esqueça a pendência não compila — e é essa a diferença entre uma regra e um
 * lembrete.
 */
export type LeituraDeComparacao<V> =
  | { pendente: false; visao: V }
  | { pendente: true; evidencia: Evidencia };

/**
 * A evidência que **declara** a pendência, em vez de devolver zeros.
 *
 * Ela é uma evidência de verdade — vai ao dossiê, sustenta a fonte, aparece no
 * painel técnico — e não autoriza número nenhum: `numeros: []`. É exatamente o
 * que se quer, porque não há número a citar. O que ela carrega é a instrução de
 * não concluir ausência de movimento, escrita onde quem redige vai lê-la.
 */
function comparacaoPendente(
  ctx: ContextoResolvido,
  periodLabel: string,
  ferramenta: string,
): Evidencia {
  return {
    ferramenta,
    titulo: `Comparação pendente em ${periodLabel}`,
    fatos: [
      {
        rotulo: "Estado da comparação",
        valor: "ainda não calculada",
        detalhe:
          "A vigência tem dados importados e nunca foi comparada com a anterior neste " +
          "recorte. Isto não é «nada mudou» — é «ninguém calculou».",
      },
    ],
    numeros: [],
    origem: `change_set ausente para ${periodLabel} · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, { vigencia: periodLabel }),
    tela: { label: "Alterações", href: "/alteracoes" },
    nota:
      "Não conclua que nada mudou a partir desta consulta, e não relate zero: o que há " +
      "é uma comparação pendente. Diga isso a quem perguntou.",
  };
}

/**
 * A visão por famílias, ou a pendência — nunca zeros silenciosos.
 *
 * Todo caminho deste arquivo capaz de responder sobre comparação passa por
 * aqui. `getFamiliesView` continua sendo quem lê; o que esta função acrescenta
 * é obrigar quem a chama a decidir o que fazer com o terceiro estado.
 */
async function lerFamilias(
  db: Database,
  ctx: ContextoResolvido,
  periodo: string | undefined,
  ferramenta: string,
): Promise<LeituraDeComparacao<NonNullable<Awaited<ReturnType<typeof getFamiliesView>>>> | null> {
  const visao = await getFamiliesView(db, periodo, ctx.contexto);
  if (!visao) return null;
  if (visao.comparacao === "NAO_MATERIALIZADA") {
    return { pendente: true, evidencia: comparacaoPendente(ctx, visao.periodLabel, ferramenta) };
  }
  return { pendente: false, visao };
}

/** A mesma regra sobre a visão agrupada — ver {@link lerFamilias}. */
async function lerAgrupada(
  db: Database,
  ctx: ContextoResolvido,
  periodo: string | undefined,
  ferramenta: string,
): Promise<LeituraDeComparacao<NonNullable<Awaited<ReturnType<typeof getGroupedView>>>> | null> {
  const visao = await getGroupedView(db, periodo, ctx.contexto);
  if (!visao) return null;
  if (visao.comparacao === "NAO_MATERIALIZADA") {
    return { pendente: true, evidencia: comparacaoPendente(ctx, visao.periodLabel, ferramenta) };
  }
  return { pendente: false, visao };
}

// ── Movimento de uma vigência ───────────────────────────────────────────────

export async function resumoDaVigencia(
  db: Database,
  ctx: ContextoResolvido,
  periodo?: string,
): Promise<Evidencia | null> {
  const leitura = await lerFamilias(db, ctx, periodo, "resumoDaVigencia");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;
  const r = visao.summary;
  const impacto = impactoEmTexto(r.impact);

  return {
    ferramenta: "resumoDaVigencia",
    titulo: `O que mudou em ${visao.periodLabel}`,
    fatos: [
      {
        rotulo: "Alterações",
        valor: INTEIRO.format(r.changes),
        detalhe: cobertura(r.impact.calculatedChanges, r.changes),
      },
      {
        rotulo: "Veículos afetados",
        valor: INTEIRO.format(r.vehiclesTouched),
        detalhe: "ativos distintos — o mesmo caminhão não conta duas vezes",
      },
      {
        rotulo: "Impacto apurado",
        valor: impacto ?? "não apurável com este export",
        detalhe: impacto
          ? "por periodicidade, nunca somado entre elas"
          : `${INTEIRO.format(r.notCalculable)} alterações sem preço`,
      },
      /*
        A participação sai calculada daqui, e não da cabeça do modelo.

        "Financiamento (12)" deixa a pergunta seguinte — quanto isso é do
        total? — para quem lê, e a instrução proíbe o modelo de dividir. O
        resultado era uma resposta que não conseguia dizer o que importa, ou
        uma que dizia e era descartada pela trava por citar um número que
        nenhuma consulta devolveu. Cálculo é do backend; esta é a conta.
      */
      ...(r.topParameters.length > 0
        ? [
            {
              rotulo: "Parâmetros que mais mexeram",
              valor: r.topParameters
                .slice(0, 3)
                .map(
                  (p) =>
                    `${p.name} (${INTEIRO.format(p.changes)}` +
                    (r.changes > 0
                      ? `, ${Math.round((p.changes / r.changes) * 100)}% do movimento`
                      : "") +
                    ")",
                )
                .join(", "),
            },
          ]
        : []),
    ],
    numeros: [
      r.changes,
      r.vehiclesTouched,
      r.impact.calculatedChanges,
      r.notCalculable,
      ...numerosDoImpacto(r.impact),
      ...r.topParameters.slice(0, 3).map((p) => p.changes),
      ...(r.changes > 0
        ? r.topParameters.slice(0, 3).map((p) => Math.round((p.changes / r.changes) * 100))
        : []),
    ],
    origem: `getFamiliesView · ${visao.periodLabel} · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Parâmetros", href: "/parametros" },
    /*
      O que mais mexeu, para quem vier atrás da regra dele.

      O segundo salto da Fase 5 — achado o item que pesa, vá ler a regra dele —
      dependia de alguém publicar qual é esse item, e só o ranking e a fila
      publicavam. O resumo da vigência é a forma mais comum de a descoberta
      acontecer, e ficou de fora por omissão: "existe alguma regra no Book
      relacionada a essa alteração?" chega aqui com um pronome no lugar do
      assunto, recebe o resumo, e não tinha como saber de que regra ir atrás.
    */
    ...(r.topParameters[0] ? { assuntoEmDestaque: r.topParameters[0].name } : {}),
  };
}

/**
 * O que merece atenção nesta vigência — a fila de investigação, com o porquê.
 *
 * **Uma capacidade que existia e o assistente não alcançava.** `buildCockpit`
 * ordena os grupos de alteração por criticidade e diz, para cada um, os motivos
 * que formaram o score: abrangência na frota, magnitude do movimento, se há
 * dinheiro apurado, se há troca de formato. É a resposta literal a "tem alguma
 * coisa fora do padrão?" e a "o que eu deveria investigar primeiro?" — e até
 * aqui essas perguntas recebiam o agregado da vigência, que é verdadeiro e não
 * responde nenhuma das duas.
 *
 * **Nada aqui calcula.** O cockpit é projeção pura sobre o que o motor já
 * apurou, e é o mesmo objeto que a tela de Alterações usa para ordenar a fila.
 * O assistente e a tela discordarem sobre o que é crítico seria pior do que o
 * assistente não ter opinião.
 *
 * **Os motivos vão junto porque a ordem sem eles é um oráculo.** "Financiamento
 * é o primeiro" não se audita; "é o primeiro porque atinge toda a frota e tem
 * R$ 28 mil apurados" se audita — e é a diferença entre um assistente que
 * ordena e um que explica por que ordenou.
 */
export async function filaDeInvestigacao(
  db: Database,
  ctx: ContextoResolvido,
  periodo?: string,
): Promise<Evidencia | null> {
  const leitura = await lerAgrupada(db, ctx, periodo, "filaDeInvestigacao");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;

  const cockpit = buildCockpit(visao);
  const fila = cockpit.priorities.slice(0, 5);
  if (fila.length === 0) return null;

  /*
    O diagnóstico diz o que aconteceu; o título diz **com o quê**.

    Sem o título, dois grupos diferentes que sofreram a mesma coisa aparecem
    como duas linhas idênticas — "O valor foi zerado em 10 cavalos" duas vezes,
    uma sobre financiamento e outra sobre depreciação. A fila fica com cara de
    duplicata e quem lê não tem como escolher por onde começar, que é a única
    coisa que ela existe para responder.
  */
  const tituloDoGrupo = new Map(visao.groups.map((g) => [g.key, g.title]));

  const fatos: Fato[] = fila.map((item) => ({
    rotulo: `${item.rank}. ${tituloDoGrupo.get(item.key) ?? item.key}`,
    valor: `${item.diagnosis} (${item.severity.toLowerCase()}, ${item.shareLabel})`,
    /*
      Os motivos do score, e não o score.

      O número é comparável e não é explicável: "72 pontos" não diz a ninguém
      por que este veio antes daquele. Os motivos dizem, e são o que a tela de
      Alterações mostra ao lado da mesma fila.
    */
    detalhe: item.reasons.map((r) => r.label).join("; ") || undefined,
  }));

  return {
    ferramenta: "filaDeInvestigacao",
    titulo: `O que merece atenção em ${visao.periodLabel}`,
    fatos,
    numeros: fila.flatMap((i) => [
      i.rank,
      ...(i.sharePercent !== null ? [i.sharePercent] : []),
    ]),
    origem: `buildCockpit · ${visao.periodLabel} · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Alterações", href: "/alteracoes" },
    destaque: fatos[0]?.rotulo,
    ...(fila[0] && tituloDoGrupo.get(fila[0].key)
      ? { assuntoEmDestaque: tituloDoGrupo.get(fila[0].key)! }
      : {}),
    nota:
      "A ordem é a mesma da tela de Alterações, e cada posição vem com os " +
      "motivos que a colocaram ali. Criticidade ordena a investigação; ela não " +
      "afirma que houve erro.",
  };
}

/** O que mudou numa gaveta específica, nesta vigência. */
export async function movimentoDoParametro(
  db: Database,
  ctx: ContextoResolvido,
  alvo: Alvo,
  periodo?: string,
): Promise<Evidencia | null> {
  const leitura = await lerFamilias(db, ctx, periodo, "movimentoDoParametro");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;

  for (const familia of visao.families) {
    for (const p of familia.parameters) {
      if (p.name !== alvo.parametro) continue;
      const impacto = impactoEmTexto(p.impact);
      return {
        ferramenta: "movimentoDoParametro",
        titulo: `${p.name} em ${visao.periodLabel}`,
        fatos: [
          { rotulo: "Família", valor: familia.name },
          {
            rotulo: "Alterações",
            valor: INTEIRO.format(p.changes),
            detalhe: cobertura(p.impact.calculatedChanges, p.changes),
          },
          { rotulo: "Veículos afetados", valor: INTEIRO.format(p.vehicles) },
          {
            rotulo: "Impacto apurado",
            valor: impacto ?? "não apurável com este export",
            detalhe: impacto ? undefined : `${INTEIRO.format(p.impact.notCalculable)} sem preço`,
          },
          ...(p.groups.length > 0
            ? [{ rotulo: "O que mudou dentro dela", valor: p.groups.slice(0, 5).map((g) => g.title).join(", ") }]
            : []),
        ],
        numeros: [p.changes, p.vehicles, p.impact.calculatedChanges, ...numerosDoImpacto(p.impact)],
        origem: `getFamiliesView → ${familia.code} / ${p.key} · ${visao.periodLabel}`,
        recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
        tela: { label: "Parâmetros", href: "/parametros" },
      };
    }
  }

  /*
    A gaveta existe e não se mexeu.

    `getFamiliesView` só devolve o que mudou, então uma gaveta parada some da
    visão — e a versão anterior devolvia `null`, que a orquestração lia como
    "não consultei nada". Numa conversa isso aparecia assim: alguém perguntava
    "quanto mudou o IPVA em agosto?", ouvia a série, perguntava "por quê?" e
    recebia silêncio. Zero alteração é uma resposta, e é diferente de não ter
    procurado.
  */
  return {
    ferramenta: "movimentoDoParametro",
    titulo: `${alvo.parametro} em ${visao.periodLabel}`,
    fatos: [
      {
        rotulo: "Alterações",
        valor: INTEIRO.format(0),
        detalhe: "esta gaveta não registrou alteração nesta vigência",
      },
    ],
    numeros: [0],
    origem: `getFamiliesView → ${alvo.parametro} · ${visao.periodLabel}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Parâmetros", href: "/parametros" },
    nota:
      "Uma gaveta sem alteração não aparece na tela de Parâmetros da vigência. " +
      "Isso é ausência de movimento, não ausência de dado.",
  };
}

// ── Série e intervalo ───────────────────────────────────────────────────────

/**
 * A evolução de uma coluna ao longo das vigências.
 *
 * A série devolve numerador, denominador e média em cada ponto, e esta
 * evidência os mostra os três — porque a soma da frota não é o preço: o total
 * de IPVA sobe quando entram dois cavalos, sem nada ter encarecido.
 */
export async function serieDoParametro(
  db: Database,
  ctx: ContextoResolvido,
  codigo: string,
): Promise<Evidencia | null> {
  const serie = await getAttributeSeries(db, codigo, ctx.contexto);
  if (!serie || serie.points.length === 0) return null;

  const pontos = serie.points;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];

  const fatos: Fato[] = [
    { rotulo: "Coluna", valor: serie.title, detalhe: codigo },
    {
      rotulo: "Semântica",
      valor: serie.semanticsStatus,
      detalhe: serie.summable
        ? "somável — o total da frota é uma leitura legítima"
        : "não somável — só a média e os extremos fazem sentido",
    },
    {
      rotulo: "Pontos na série",
      valor: INTEIRO.format(pontos.length),
      detalhe: `de ${primeiro.periodLabel} a ${ultimo.periodLabel}`,
    },
  ];

  const numeros: number[] = [pontos.length];

  for (const ponto of pontos) {
    const partes: string[] = [];
    if (ponto.total !== null) {
      partes.push(`total ${ponto.total.toLocaleString("pt-BR")}`);
      numeros.push(ponto.total);
    }
    if (ponto.average !== null) {
      partes.push(`média ${ponto.average.toLocaleString("pt-BR")}`);
      numeros.push(ponto.average);
    }
    partes.push(`${INTEIRO.format(ponto.numericVehicles)} veículos com número`);
    numeros.push(ponto.numericVehicles);
    fatos.push({ rotulo: ponto.periodLabel, valor: partes.join(" · ") });
  }

  return {
    ferramenta: "serieDoParametro",
    titulo: `Evolução de ${serie.title}`,
    fatos,
    numeros,
    origem: `getAttributeSeries(${codigo}) · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, {
      intervalo: `${primeiro.periodLabel} → ${ultimo.periodLabel}`,
    }),
    tela: { label: "Parâmetros", href: "/parametros" },
    nota: serie.note,
    // O valor de hoje é o último ponto. "Pontos na série: 9" é como a série é
    // feita, não o que ela diz.
    destaque: ultimo.periodLabel,
  };
}

/**
 * O intervalo, nas duas leituras que o produto mantém.
 *
 * Movimentos do período soma as comparações do caminho; ponta a ponta compara
 * só as extremidades. Os dois números divergem de propósito quando um valor
 * subiu e voltou, e devolver só um deles seria decidir a pergunta por quem
 * perguntou.
 */
export async function compararIntervalo(
  db: Database,
  ctx: ContextoResolvido,
  de?: string,
  ate?: string,
  gavetas?: string[],
): Promise<Evidencia | null> {
  const [movimento, pontaAPonta] = await Promise.all([
    getRangeAnalysis(db, de, ate, ctx.contexto, gavetas),
    getEndToEndAnalysis(db, de, ate, ctx.contexto, gavetas),
  ]);
  if (!movimento) return null;

  const impactoMovimento = impactoEmTexto(movimento.impact);
  const fatos: Fato[] = [
    {
      rotulo: "Intervalo",
      valor: `${movimento.fromLabel} → ${movimento.toLabel}`,
      detalhe: `${INTEIRO.format(movimento.totals.comparisons)} comparação(ões) somada(s)`,
    },
    {
      rotulo: "Movimentos do período",
      valor: impactoMovimento ?? "não apurável",
      detalhe: `${INTEIRO.format(movimento.totals.changes)} alterações · um valor que subiu e voltou conta duas vezes`,
    },
  ];

  const numeros = [
    movimento.totals.changes,
    movimento.totals.comparisons,
    ...numerosDoImpacto(movimento.impact),
  ];

  if (pontaAPonta) {
    const impactoPonta = impactoEmTexto(pontaAPonta.impact);
    fatos.push({
      rotulo: "Ponta a ponta",
      valor: impactoPonta ?? "não apurável",
      detalhe: `${INTEIRO.format(pontaAPonta.totals.changes)} alterações que permanecem · o que subiu e voltou some aqui`,
    });
    numeros.push(pontaAPonta.totals.changes, ...numerosDoImpacto(pontaAPonta.impact));
  }

  return {
    ferramenta: "compararIntervalo",
    titulo: `${movimento.fromLabel} → ${movimento.toLabel}`,
    fatos,
    numeros,
    origem: `getRangeAnalysis + getEndToEndAnalysis · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, {
      intervalo: `${movimento.fromLabel} → ${movimento.toLabel}`,
    }),
    tela: { label: "Parâmetros", href: "/parametros" },
    nota:
      "As duas leituras respondem perguntas diferentes e divergem de propósito: " +
      "a primeira mede a agitação do caminho, a segunda o saldo entre as pontas.",
  };
}

// ── Rankings ────────────────────────────────────────────────────────────────

/**
 * Onde o dinheiro foi — para baixo ou para cima.
 *
 * Os dois lados vêm do mesmo `ExecutiveSummary` que a tela de Parâmetros usa,
 * e continuam separados por periodicidade. Somar perda mensal com perda anual
 * para produzir "o total que perdemos" daria um número que nenhuma das duas
 * grandezas justifica.
 *
 * A lista sai de `summary.sides` — a partição **por linha de alteração** —, e
 * não mais dos `topParameters` filtrados pelo sinal do saldo. A diferença é
 * medida e não é pequena: em agosto/2026 `Financiamento` subiu R$ 17.086,20 em
 * quatro cavalos e caiu R$ 2.147,19 num quinto. Pelo saldo ele aparecia só do
 * lado do ganho, com R$ 14.939,01, e a pergunta "onde a remuneração caiu?"
 * recebia uma resposta em que aquela queda não existia — enquanto a Visão geral,
 * que lê os mesmos lados, a mostrava. Duas superfícies do mesmo produto
 * respondendo diferente sobre o mesmo dinheiro é o defeito que este arquivo
 * inteiro existe para não cometer.
 */
export async function rankingDeImpacto(
  db: Database,
  ctx: ContextoResolvido,
  lado: "PERDA" | "GANHO",
  periodo?: string,
): Promise<Evidencia | null> {
  const leitura = await lerFamilias(db, ctx, periodo, "rankingDeImpacto");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;
  const r = visao.summary;

  const porPeriodicidade = lado === "PERDA" ? r.lossesByPeriodicity : r.gainsByPeriodicity;
  const entradas = Object.entries(porPeriodicidade).filter(([, v]) => v !== 0);

  /*
    O mesmo parâmetro pode ter valor deste lado em mais de uma periodicidade, e
    as duas saem juntas na linha dele — nunca somadas. O ranking entre
    parâmetros usa o maior módulo dentro de **uma** periodicidade, que é a mesma
    régua do pódio da Visão geral.
  */
  const porParametro = new Map<
    string,
    { name: string; familyName: string; changes: number; soma: [string, number][] }
  >();
  for (const balde of r.sides) {
    const side = lado === "PERDA" ? balde.losses : balde.gains;
    for (const p of side.parameters) {
      const entrada =
        porParametro.get(p.key) ??
        { name: p.name, familyName: p.familyName, changes: 0, soma: [] };
      entrada.changes += p.changes;
      entrada.soma.push([balde.periodicity, p.amount]);
      porParametro.set(p.key, entrada);
    }
  }

  const maiorModulo = (soma: [string, number][]) =>
    soma.reduce((maior, [, v]) => Math.max(maior, Math.abs(v)), 0);
  const relevantes = [...porParametro.values()]
    .sort((a, b) => maiorModulo(b.soma) - maiorModulo(a.soma))
    .slice(0, 5)
    .map((p) => ({ p, soma: p.soma }));

  const fatos: Fato[] = [
    {
      rotulo: lado === "PERDA" ? "Total que reduziu a remuneração" : "Total que aumentou a remuneração",
      valor:
        entradas.length > 0
          ? entradas.map(([per, v]) => dinheiro(v, per)).join(" · ")
          : lado === "PERDA"
            ? "nenhuma perda apurada nesta vigência"
            : "nenhum ganho apurado nesta vigência",
      detalhe: "por periodicidade, nunca somado entre elas",
    },
  ];

  for (const { p, soma } of relevantes) {
    fatos.push({
      rotulo: p.name,
      valor: soma.map(([per, v]) => dinheiro(v, per)).join(" · "),
      // "deste lado" e não "do parâmetro": a contagem é das linhas que caíram
      // aqui. O mesmo parâmetro pode ter outras do outro lado, e escrever só
      // "12 alterações" faria a soma das duas listas parecer contagem dobrada.
      detalhe: `${p.familyName} · ${INTEIRO.format(p.changes)} ${
        p.changes === 1 ? "alteração deste lado" : "alterações deste lado"
      }`,
    });
  }

  if (relevantes.length === 0) {
    fatos.push({
      rotulo: "Parâmetros",
      valor: "nenhum com impacto apurado deste lado",
      detalhe: `${INTEIRO.format(r.notCalculable)} alterações da vigência estão sem preço`,
    });
  }

  return {
    ferramenta: "rankingDeImpacto",
    titulo:
      lado === "PERDA"
        ? `Onde a remuneração caiu em ${visao.periodLabel}`
        : `Onde a remuneração subiu em ${visao.periodLabel}`,
    fatos,
    numeros: [
      ...entradas.map(([, v]) => v),
      ...relevantes.flatMap(({ p, soma }) => [p.changes, ...soma.map(([, v]) => v)]),
    ],
    origem: `getFamiliesView → summary.sides[].${lado === "PERDA" ? "losses" : "gains"} · ${visao.periodLabel}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Parâmetros", href: "/parametros" },
    ...(relevantes[0] ? { assuntoEmDestaque: relevantes[0].p.name } : {}),
  };
}

/** Os veículos que mais mudaram nesta vigência. */
export async function veiculosAfetados(
  db: Database,
  ctx: ContextoResolvido,
  periodo?: string,
  limite = 8,
): Promise<Evidencia | null> {
  const leitura = await lerFamilias(db, ctx, periodo, "veiculosAfetados");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;
  const top = visao.summary.topVehicles.slice(0, limite);

  if (top.length === 0) {
    return {
      ferramenta: "veiculosAfetados",
      titulo: `Veículos afetados em ${visao.periodLabel}`,
      fatos: [
        {
          rotulo: "Ranking por impacto",
          valor: "nenhum veículo com impacto apurado",
          detalhe: `${INTEIRO.format(visao.summary.vehiclesTouched)} veículos tiveram alteração, nenhuma com preço`,
        },
      ],
      numeros: [visao.summary.vehiclesTouched],
      origem: `getFamiliesView → summary.topVehicles · ${visao.periodLabel}`,
      recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
      tela: { label: "Análise de frota", href: "/analise-equipamentos" },
    };
  }

  return {
    ferramenta: "veiculosAfetados",
    titulo: `Veículos mais impactados em ${visao.periodLabel}`,
    fatos: top.map((v) => ({
      rotulo: v.plate ?? "(sem placa)",
      valor: Object.entries(v.byPeriodicity)
        .map(([per, valor]) => dinheiro(valor, per))
        .join(" · "),
      detalhe: `${INTEIRO.format(v.changes)} alterações${v.entityType ? ` · ${v.entityType.toLowerCase()}` : ""}`,
    })),
    numeros: [
      visao.summary.vehiclesTouched,
      ...top.flatMap((v) => [v.changes, ...Object.values(v.byPeriodicity)]),
    ],
    /* As placas do ranking — o que esta consulta autoriza nomear. */
    identificadores: top
      .map((v) => v.plate)
      .filter((p): p is string => typeof p === "string" && p.length > 0),
    origem: `getFamiliesView → summary.topVehicles · ${visao.periodLabel}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Análise de frota", href: "/analise-equipamentos" },
    nota: "Ordenado pelo maior valor absoluto dentro de uma periodicidade, nunca pela soma entre elas.",
  };
}

/** O que mudou e não pôde ser precificado — e por quê. */
export async function semParaPrecificar(
  db: Database,
  ctx: ContextoResolvido,
  periodo?: string,
): Promise<Evidencia | null> {
  const leitura = await lerFamilias(db, ctx, periodo, "semParaPrecificar");
  if (!leitura) return null;
  if (leitura.pendente) return leitura.evidencia;
  const visao = leitura.visao;
  const r = visao.summary;

  const travados = visao.families
    .flatMap((f) => f.parameters.map((p) => ({ familia: f.name, p })))
    .filter((x) => x.p.impact.notCalculable > 0)
    .sort((a, b) => b.p.impact.notCalculable - a.p.impact.notCalculable)
    .slice(0, 8);

  return {
    ferramenta: "semParaPrecificar",
    titulo: `O que ficou sem preço em ${visao.periodLabel}`,
    fatos: [
      {
        rotulo: "Alterações sem impacto calculável",
        valor: INTEIRO.format(r.notCalculable),
        detalhe: cobertura(r.impact.calculatedChanges, r.changes),
      },
      {
        rotulo: "Grupos travados por semântica",
        valor: INTEIRO.format(r.locked),
        detalhe: "monetários e somáveis, à espera de confirmação na Curadoria",
      },
      ...travados.map((x) => ({
        rotulo: x.p.name,
        valor: `${INTEIRO.format(x.p.impact.notCalculable)} sem preço`,
        detalhe: x.familia,
      })),
    ],
    numeros: [
      r.notCalculable,
      r.locked,
      r.impact.calculatedChanges,
      r.changes,
      ...travados.map((x) => x.p.impact.notCalculable),
    ],
    origem: `getFamiliesView · ${visao.periodLabel} · ${ctx.info.label}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Curadoria", href: "/curadoria" },
    nota:
      "Sem preço não é sem impacto: é o valor que este export não sustenta. " +
      "A confirmação da semântica em Curadoria é o que destrava cada um deles.",
  };
}

/** De onde veio um número: a célula da planilha que o originou. */
export async function procedenciaDaAlteracao(
  db: Database,
  ctx: ContextoResolvido,
  changeId: number,
): Promise<Evidencia | null> {
  const proveniencia = await getChangeProvenance(db, changeId);
  if (!proveniencia) return null;
  const p = proveniencia as Record<string, unknown>;
  const texto = (chave: string) => (p[chave] == null ? "—" : String(p[chave]));

  return {
    ferramenta: "procedenciaDaAlteracao",
    titulo: "De onde veio este número",
    fatos: [
      { rotulo: "Atributo", valor: texto("attribute_code") },
      { rotulo: "Valor anterior", valor: texto("value_before") },
      { rotulo: "Valor novo", valor: texto("value_after") },
      { rotulo: "Planilha", valor: texto("source_sheet"), detalhe: texto("source_cell") },
    ],
    numeros: [],
    origem: `getChangeProvenance(${changeId})`,
    recorte: recorteDe(ctx.info),
    tela: { label: "Alterações", href: "/alteracoes" },
  };
}

/** Os veículos de um grupo, com valor anterior e novo de cada um. */
export async function veiculosDoGrupo(
  db: Database,
  ctx: ContextoResolvido,
  periodo: string,
  codigo: string,
  equipamento: string,
): Promise<Evidencia | null> {
  const veiculos = await getGroupVehicles(db, {
    period: periodo,
    attributeCode: codigo,
    entityType: equipamento,
    scopeHash: ctx.contexto.scopeHash,
    channel: ctx.contexto.channel,
  });
  if (veiculos.length === 0) return null;

  return {
    ferramenta: "veiculosDoGrupo",
    alvoDaDescida: { codigo, equipamento, rotulo: codigo },
    titulo: `Veículos com alteração em ${codigo}`,
    fatos: veiculos.slice(0, 10).map((v) => ({
      rotulo: v.plate ?? "(sem placa)",
      valor: `${v.valueBefore ?? "—"} → ${v.valueAfter ?? "—"}`,
      detalhe:
        v.impactAmount !== null && v.impactPeriodicity
          ? dinheiro(v.impactAmount, v.impactPeriodicity)
          : "sem preço",
    })),
    numeros: veiculos.flatMap((v) =>
      [v.numericBefore, v.numericAfter, v.impactAmount].filter(
        (n): n is number => n !== null,
      ),
    ),
    /*
      As dez placas que os fatos mostram — as mesmas que a redação pode nomear.

      `numeros` acima cobre a lista inteira porque a soma e a contagem falam do
      conjunto; os identificadores param na página, porque nomear é diferente de
      contar: o que não foi mostrado não pode ser citado pelo nome.
    */
    identificadores: veiculos
      .slice(0, 10)
      .map((v) => v.plate)
      .filter((p): p is string => typeof p === "string" && p.length > 0),
    origem: `getGroupVehicles(${codigo}, ${equipamento}) · ${rotuloDoPeriodo(periodo)}`,
    recorte: recorteDe(ctx.info, { vigencia: rotuloDoPeriodo(periodo) }),
    tela: { label: "Alterações", href: "/alteracoes" },
  };
}

// ── Book do Operador ────────────────────────────────────────────────────────

interface EntradaDoBook extends Record<string, unknown> {
  blockKey: string;
  blockCategory: string;
  blockTitle: string;
  kind: string;
  revision: number;
  filename: string | null;
  bodyText: string | null;
  note: string | null;
  createdBy: string;
  createdAt: Date;
}

/**
 * O bloco que este termo nomeia — **uma** regra, e não duas.
 *
 * Quem lê a regra e quem abre o arquivo do bloco precisam concordar sobre qual
 * bloco a pergunta nomeou, e essa concordância não pode depender de duas
 * implementações parecidas. Era exatamente o que havia aqui: `regraDoBook`
 * casava o título nos dois sentidos ("QLP ADM" está contido em "qlp adm de
 * camaçari") e `anexoDoBook` exigia que a chave do banco contivesse a frase
 * inteira. O efeito não era erro em lugar nenhum — era a resposta dizer que o
 * bloco tem documento anexado e o documento não ir junto, que é a forma mais
 * silenciosa de o assistente parecer incapaz de ler o que ele tem em mãos.
 *
 * **O título mais longo vence.** "DESCONTO QLP ADM" e "QLP ADM" casam os dois
 * quando a pergunta escreve o primeiro; devolver o mais curto responderia sobre
 * o bloco vizinho, com o nome certo no título e a regra errada no corpo.
 */
export function blocoQueOTermoNomeia<
  T extends { blockTitle: string; blockCategory: string },
>(entradas: T[], termo: string): T | null {
  const alvo = normalizar(termo).trim();
  if (!alvo) return null;

  const candidatos = entradas.filter((e) => {
    const titulo = normalizar(e.blockTitle);
    return (
      titulo.includes(alvo) ||
      alvo.includes(titulo) ||
      normalizar(`${e.blockCategory} ${e.blockTitle}`).includes(alvo)
    );
  });

  return (
    candidatos.sort((a, b) => b.blockTitle.length - a.blockTitle.length)[0] ?? null
  );
}

async function entradasVigentes(db: Database): Promise<EntradaDoBook[]> {
  const { rows } = await db.execute<EntradaDoBook>(sql`
    SELECT DISTINCT ON (block_key)
           block_key AS "blockKey", block_category AS "blockCategory",
           block_title AS "blockTitle", kind::text AS kind, revision,
           filename, body_text AS "bodyText", note,
           created_by AS "createdBy", created_at AS "createdAt"
      FROM book_entry
     ORDER BY block_key, revision DESC
  `);
  return rows;
}

/** O que o chamador já sabe sobre o arquivo do bloco quando pede a regra. */
export interface ComoOArquivoChegou {
  /**
   * O documento do bloco acompanha esta pergunta.
   *
   * Muda a ressalva, e a ressalva é uma afirmação sobre o que o assistente fez
   * — não uma fórmula de cortesia. Dizer "não transcrevo documento que não li"
   * com o documento aberto ao lado é declarar uma incapacidade que não existe,
   * e foi o que esta resposta fazia toda vez que o anexo entrava.
   */
  documentoLido?: boolean;
}

/**
 * A regra registrada de um bloco.
 *
 * O Book não tem recorte por unidade: uma regra de remuneração vale para o
 * contrato, não para uma operação. Por isso esta evidência sai sem `recorte` —
 * e a validação sabe que a ausência aqui é deliberada, não esquecimento.
 */
export async function regraDoBook(
  db: Database,
  termo: string,
  arquivo: ComoOArquivoChegou = {},
): Promise<Evidencia | null> {
  const entradas = await entradasVigentes(db);
  const achado = blocoQueOTermoNomeia(entradas, termo);
  if (!achado) return null;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(bookEntryTable)
    .where(eq(bookEntryTable.blockKey, achado.blockKey));

  const fatos: Fato[] = [
    { rotulo: "Bloco", valor: achado.blockTitle, detalhe: achado.blockCategory, interno: true },
    {
      rotulo: "Revisão vigente",
      valor: String(achado.revision),
      detalhe:
        total === 1
          ? "1 revisão guardada — o Book não apaga nenhuma"
          : `${INTEIRO.format(total)} revisões guardadas — nenhuma foi apagada`,
      interno: true,
    },
    {
      rotulo: "Tipo",
      valor: achado.kind === "TEXTO" ? "regra escrita no sistema" : "documento anexado",
      detalhe: achado.filename ?? undefined,
      interno: true,
    },
  ];

  return {
    ferramenta: "regraDoBook",
    titulo: `Book · ${achado.blockTitle}`,
    fatos,
    numeros: [achado.revision, total],
    origem: `book_entry · bloco "${achado.blockKey}" · revisão ${achado.revision}`,
    tela: { label: "Book do Operador", href: "/book-operador" },
    /*
      A ressalva sobrevive num caso só: o arquivo existe e não foi possível
      lê-lo. Antes ela saía sempre — inclusive com o documento aberto ao lado —,
      e depois de o índice passar a ler Word, Excel e PowerPoint ela virou o que
      deveria ter sido desde o começo: o aviso de um caso raro (formato legado,
      arquivo acima do teto), e não a descrição do funcionamento normal.
    */
    nota:
      achado.kind === "DOCUMENTO" && !arquivo.documentoLido
        ? "O conteúdo deste documento não pôde ser lido — formato legado ou arquivo " +
          "grande demais. Ele continua baixável na tela do Book."
        : undefined,
  };
}

/**
 * Como a remuneração da frota se compõe nesta vigência.
 *
 * A tela de Composição responde o que nenhuma outra respondia: não *quanto
 * mudou*, mas **de que o total é feito** — quantos equipamentos entraram no
 * mensal, quantos ficaram incompletos, e quantos componentes monetários ainda
 * não têm regra financeira. Esse último número é o que separa "o total é este"
 * de "o total é este até onde dá para afirmar", e por isso ele sai como
 * ressalva, não como rodapé.
 *
 * Chama `getVisaoDeFrota`, o mesmo serviço da tela. Se o assistente e a tela
 * divergirem num número, é bug de um serviço só — não de dois caminhos que
 * calculam a mesma coisa de jeitos diferentes.
 */
export async function composicaoDaFrota(
  db: Database,
  ctx: ContextoResolvido,
  equipamento: "CAVALO" | "CARRETA",
  periodo?: string,
): Promise<Evidencia | null> {
  const visao = await getVisaoDeFrota(db, equipamento, {
    context: ctx.contexto,
    ...(periodo ? { period: periodo } : {}),
  });
  if (!visao) return null;

  const r = visao.resumo;
  const fatos: Fato[] = [
    {
      rotulo: "Equipamentos na frota",
      valor: INTEIRO.format(r.equipamentos),
      detalhe: `${INTEIRO.format(r.comValorApurado)} com valor apurado`,
    },
    { rotulo: "Total mensal", valor: dinheiro(r.mensalTotal, "MENSAL"), detalhe: "somado na frota" },
    {
      rotulo: "Movimento",
      valor: `${INTEIRO.format(r.comAumento)} subiram · ${INTEIRO.format(r.comReducao)} caíram`,
      detalhe: `${INTEIRO.format(r.semVariacao)} sem variação`,
    },
  ];

  if (r.incompletos > 0) {
    fatos.push({
      rotulo: "Incompletos",
      valor: INTEIRO.format(r.incompletos),
      detalhe: "sem as duas pontas para comparar",
    });
  }

  return {
    ferramenta: "composicaoDaFrota",
    titulo: `Composição · ${visao.rotuloDoTipo} · ${visao.periodLabel}`,
    fatos,
    numeros: [
      r.equipamentos,
      r.comValorApurado,
      r.mensalTotal,
      r.comAumento,
      r.comReducao,
      r.semVariacao,
      r.incompletos,
      r.componentesSemRegra,
      r.componentesSemClassificacao,
      visao.totalSemFiltro,
    ],
    origem: `getVisaoDeFrota(${equipamento}) · ${visao.effectiveDate}`,
    recorte: recorteDe(ctx.info, { vigencia: visao.periodLabel }),
    tela: { label: "Composição", href: "/composicao" },
    destaque: "Total mensal",
    /*
      A ressalva de apuração parcial vem antes da de regra financeira, e não
      depois: o assistente respondia o total sem nenhuma nota sempre que
      `componentesSemRegra` era zero — o que acontecia justamente quando
      ninguém tinha classificado coluna nenhuma. Ver `apuracaoCompleta` em
      `ResumoDaFrota`.
    */
    nota: !visao.serieEntregue
      ? "Esta vigência não entregou a série deste equipamento — o que aparece vem da vigência anterior."
      : !r.apuracaoCompleta
        ? `Apuração parcial: ${INTEIRO.format(r.componentesSemClassificacao)} número(s) ` +
          `sem classificação em ${INTEIRO.format(r.equipamentosComPendencia)} equipamento(s)` +
          (r.componentesSemRegra > 0
            ? `, e ${INTEIRO.format(r.componentesSemRegra)} componente(s) monetário(s) sem ` +
              `regra financeira, ficaram fora do total.`
            : ` ficaram fora do total.`)
        : undefined,
  };
}

/** Quais blocos já têm regra registrada. */
export async function coberturaDoBook(db: Database): Promise<Evidencia> {
  const entradas = await entradasVigentes(db);
  const porTipo = entradas.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ferramenta: "coberturaDoBook",
    titulo: "Book do Operador — o que já tem regra",
    fatos: [
      {
        rotulo: "Blocos com regra registrada",
        valor: INTEIRO.format(entradas.length),
        detalhe: `${INTEIRO.format(porTipo.TEXTO ?? 0)} como texto · ${INTEIRO.format(porTipo.DOCUMENTO ?? 0)} como documento`,
      },
      ...(entradas.length > 0
        ? [
            {
              rotulo: "Blocos",
              valor: entradas.map((e) => `${e.blockTitle} (rev. ${e.revision})`).join(", "),
            },
          ]
        : []),
    ],
    numeros: [entradas.length, porTipo.TEXTO ?? 0, porTipo.DOCUMENTO ?? 0],
    origem: "book_entry · entrada vigente por bloco",
    tela: { label: "Book do Operador", href: "/book-operador" },
    nota:
      "O total de blocos que o Freightech publica não é contado aqui: o índice é " +
      "transcrição da tela de origem e o assistente conhece apenas o que foi registrado.",
  };
}

// ── Anexos do Book ──────────────────────────────────────────────────────────

/**
 * Um arquivo do Book, pronto para ir ao modelo como arquivo.
 *
 * Não há texto extraído aqui de propósito. A alternativa era rodar um OCR na
 * importação e guardar o resultado numa coluna — e aí o assistente citaria um
 * texto derivado como se fosse o documento, com a fidelidade de um parser e a
 * aparência de uma fonte. Num produto que existe para não exibir o que não pode
 * sustentar, a camada intermediária é justamente o que não se quer.
 *
 * O modelo lê PDF e imagem nativamente. Mandar os bytes é mais fiel e tem um
 * preço explícito: o que o modelo afirmar a partir do arquivo não é conferível
 * contra uma lista de números, como o resto do dossiê. É por isso que o anexo
 * entra numerado nas fontes — quem ler a resposta abre o mesmo arquivo que o
 * modelo leu e confere lá, que é a promessa que este produto faz.
 */
export interface Anexo {
  titulo: string;
  filename: string;
  origem: string;
  tela?: { label: string; href: string };
  /**
   * Como o conteúdo chega ao modelo — e a diferença importa na resposta.
   *
   * `NATIVO` é o arquivo em si: o modelo abre o PDF ou a imagem e vê o que
   * qualquer pessoa veria. `EXTRAIDO` é o que se conseguiu tirar de um formato
   * que ele não abre: o texto veio do XML do próprio arquivo e as figuras
   * saíram intactas, mas a diagramação ficou para trás. A instrução do modelo
   * trata os dois casos de forma diferente porque eles sustentam afirmações
   * diferentes.
   */
  conteudo:
    | { forma: "NATIVO"; mimeType: string; dados: string }
    | { forma: "EXTRAIDO"; texto: string; imagens: { mimeType: string; dados: string }[] };
}

/** O que o modelo abre sozinho, sem intermediário nenhum. */
const MIMES_NATIVOS = new Set(["application/pdf", "image/jpeg", "image/png"]);

/**
 * O teto de um anexo.
 *
 * A API aceita 32 MB por requisição; 8 MB por arquivo deixa folga para o
 * dossiê, a conversa e um segundo anexo sem chegar perto do limite. Um arquivo
 * maior não é truncado — truncar um PDF pela metade produz um documento que
 * *parece* completo e responde errado sobre o que estava no fim.
 */
const TETO_DO_ANEXO = 8 * 1024 * 1024;

/**
 * O arquivo vigente do bloco que a pergunta nomeia — quando dá para lê-lo.
 *
 * Devolve `null` em silêncio nos casos em que não dá (bloco sem documento,
 * formato que o modelo não lê, arquivo grande demais). O silêncio aqui é
 * correto porque `regraDoBook` já responde na mesma pergunta e já diz o que o
 * anexo é; o que se perde é a leitura do conteúdo, e isso a resposta declara
 * pela nota que já existe lá.
 */
export async function anexoDoBook(db: Database, termo: string): Promise<Anexo | null> {
  if (!termo.trim()) return null;

  /*
    O bloco é resolvido pela mesma regra que resolve a regra escrita.

    A versão anterior procurava a frase da pergunta dentro da chave do banco, e
    isso só funcionava quando a pessoa escrevia exatamente o título e nada mais:
    "qlp adm de camaçari" não está contido em "Gente::QLP ADM", e o documento do
    bloco ficava para trás enquanto a mesma pergunta recuperava a regra dele.
  */
  const bloco = blocoQueOTermoNomeia(await entradasVigentes(db), termo);
  if (!bloco) return null;

  const [achado] = await db
    .select({
      blockKey: bookEntryTable.blockKey,
      blockTitle: bookEntryTable.blockTitle,
      filename: bookEntryTable.filename,
      mimeType: bookEntryTable.mimeType,
      byteSize: bookEntryTable.byteSize,
      revision: bookEntryTable.revision,
      content: bookEntryTable.content,
    })
    .from(bookEntryTable)
    .where(
      and(
        eq(bookEntryTable.kind, "DOCUMENTO"),
        eq(bookEntryTable.blockKey, bloco.blockKey),
      ),
    )
    .orderBy(desc(bookEntryTable.revision))
    .limit(1);

  if (!achado?.content) return null;
  if (Number(achado.byteSize) > TETO_DO_ANEXO) return null;

  const bytes = Buffer.from(achado.content);
  const comum = {
    titulo: `Book · ${achado.blockTitle} · ${achado.filename ?? "documento"}`,
    filename: achado.filename ?? "documento",
    origem: `book_entry · bloco "${achado.blockKey}" · revisão ${achado.revision}`,
    tela: { label: "Book do Operador", href: "/book-operador" },
  };

  if (MIMES_NATIVOS.has(achado.mimeType)) {
    return {
      ...comum,
      conteudo: { forma: "NATIVO", mimeType: achado.mimeType, dados: bytes.toString("base64") },
    };
  }

  /*
    Office e texto puro: o que dá para tirar sem traduzir o que o arquivo mostra.

    `.doc`, `.xls` e `.ppt` antigos não caem aqui — são OLE2, um formato binário
    que exigiria outro leitor inteiro. `extrairAnexo` devolve null para eles e a
    resposta volta a dizer que não leu o documento, que continua sendo verdade.
  */
  const extraido = extrairAnexo(achado.mimeType, bytes);
  if (!extraido) return null;

  return {
    ...comum,
    conteudo: { forma: "EXTRAIDO", texto: extraido.texto, imagens: extraido.imagens },
  };
}


// ── DRE ─────────────────────────────────────────────────────────────────────

/**
 * O resultado apurado da frota, e quem o puxa para baixo (§28).
 *
 * **A regra que esta função existe para respeitar: o Assistente não tem
 * aritmética própria.** Ela chama `getDREDaFrota` — a mesma função da tela — e
 * traduz o resultado para evidência. Um número que aparece aqui apareceu antes
 * em `/dre`, e a evidência diz em qual tela conferi-lo.
 *
 * Os dois subtotais que o export não sustenta — EBITDA e margem de contribuição
 * — entram como fatos que **dizem o que falta**, e não somem. "Não sei" com o
 * motivo é uma resposta; silêncio sobre um EBITDA que o usuário perguntou é a
 * pior das respostas possíveis.
 */
export async function resultadoDaFrota(
  db: Database,
  ctx: ContextoResolvido,
  escopo: "CAVALO" | "CARRETA" | "CONJUNTO",
  periodo?: string,
): Promise<Evidencia | null> {
  const view = await getDREDaFrota(db, escopo, {
    context: ctx.contexto,
    ...(periodo ? { period: periodo } : {}),
  });
  if (!view) return null;

  const { consolidado } = view;
  const sub = (id: string) => consolidado.subtotais.find((s) => s.id === id)!;
  const receita = sub("RECEITA_BRUTA");
  const resultado = sub("RESULTADO_ECONOMICO");
  const ebitda = sub("EBITDA");

  const numeros: number[] = [consolidado.unidades, consolidado.ativos];
  const fatos: Fato[] = [];

  if (receita.valorParcial !== null) {
    fatos.push({
      rotulo: "Receita apurada",
      valor: dinheiro(receita.valorParcial, "MENSAL"),
      detalhe: `${INTEIRO.format(consolidado.unidades)} unidades econômicas · ${INTEIRO.format(consolidado.ativos)} ativos`,
    });
    numeros.push(receita.valorParcial);
  }

  if (resultado.valorParcial !== null) {
    /*
      A margem é calculada aqui, então é aqui que ela é autorizada.

      `toFixed(1)` escrevia `9.1` — ponto decimal, forma da máquina — dentro de
      uma frase em português. A trava autorizava o token literal `9.1`, e o
      modelo, escrevendo `9,1% da receita` como se escreve em português, era
      recusado. É o mesmo defeito do par antes→depois em `alteracoes`, e a
      auditoria reforçada o encontrou nesta ferramenta no primeiro exame.

      Pôr o valor em `numeros` resolve porque quem entra ali ganha as variantes
      pt-BR pelo mecanismo que já existe. E não abre porta para cálculo do
      modelo: quem calculou foi a ferramenta, deterministicamente, sobre dois
      números que ela mesma consultou.
    */
    const margem =
      receita.valorParcial !== null && receita.valorParcial !== 0
        ? ((resultado.valorParcial / receita.valorParcial) * 100).toFixed(1)
        : null;

    /*
      O texto sai **idêntico** ao de antes, e isso é requisito, não estilo: o
      planejador é a linha de base contra a qual o agente está sendo medido, e
      uma medição cujo "antes" se move junto com o "depois" não mede nada.
      `${margem}` reproduz o `toFixed(1)` original byte a byte — inclusive o
      `10.0` que um `Number()` teria encurtado para `10`.

      O que muda é só o lastro: a grandeza entra em `numeros`, onde ganha as
      variantes pt-BR. Autorização é acrescentada, nunca retirada.
    */
    fatos.push({
      rotulo: "Resultado apurado",
      valor: dinheiro(resultado.valorParcial, "MENSAL"),
      detalhe: margem !== null ? `${margem}% da receita` : undefined,
    });
    numeros.push(resultado.valorParcial);
    if (margem !== null) numeros.push(Number(margem));
  }

  /*
    O EBITDA pedido e não entregue. A frase nomeia os componentes que faltam,
    porque "não é possível calcular" sem dizer o que falta manda quem perguntou
    embora sem nada — e o que falta é exatamente a pergunta a fazer à Ambev.
  */
  if (!ebitda.conclusivo) {
    fatos.push({
      rotulo: "EBITDA",
      valor: "não apurável",
      detalhe: `faltam ${ebitda.bloqueadoPor.map((b) => b.titulo.toLowerCase()).join(", ")}`,
    });
  }

  fatos.push({
    rotulo: "Cobertura da DRE",
    valor: `${consolidado.cobertura.percentual.toFixed(0)}%`,
    detalhe: `${INTEIRO.format(consolidado.cobertura.apurados)} de ${INTEIRO.format(consolidado.cobertura.aplicaveis)} componentes com dado`,
  });
  numeros.push(consolidado.cobertura.percentual);

  fatos.push({
    rotulo: "Distribuição",
    valor: `${INTEIRO.format(consolidado.distribuicao.positivas)} positivas · ${INTEIRO.format(consolidado.distribuicao.negativas)} negativas`,
    detalhe:
      consolidado.distribuicao.semResultado > 0
        ? `${INTEIRO.format(consolidado.distribuicao.semResultado)} sem resultado apurável`
        : undefined,
  });
  numeros.push(
    consolidado.distribuicao.positivas,
    consolidado.distribuicao.negativas,
    consolidado.distribuicao.semResultado,
  );

  /* Os extremos do ranking: é o que responde "qual dá mais prejuízo". */
  const comResultado = view.ranking.filter((l) => l.resultado !== null);
  const piores = [...comResultado].sort((a, b) => a.resultado! - b.resultado!).slice(0, 5);
  const melhores = [...comResultado].sort((a, b) => b.resultado! - a.resultado!).slice(0, 5);

  if (piores.length > 0) {
    fatos.push({
      rotulo: "Menores resultados",
      valor: piores.map((l) => `${l.rotulo} (${dinheiro(l.resultado!, "MENSAL")})`).join(" · "),
    });
    numeros.push(...piores.map((l) => l.resultado!));
  }
  if (melhores.length > 0) {
    fatos.push({
      rotulo: "Maiores resultados",
      valor: melhores.map((l) => `${l.rotulo} (${dinheiro(l.resultado!, "MENSAL")})`).join(" · "),
    });
    numeros.push(...melhores.map((l) => l.resultado!));
  }

  if (view.atencao.length > 0) {
    fatos.push({
      rotulo: "Precisam de atenção",
      valor: INTEIRO.format(view.atencao.length),
      detalhe: view.atencao.slice(0, 3).map((a) => `${a.rotulo}: ${a.mensagem}`).join(" · "),
    });
    numeros.push(view.atencao.length);
  }

  return {
    ferramenta: "resultadoDaFrota",
    titulo: `DRE · ${escopo === "CONJUNTO" ? "Conjuntos" : escopo === "CAVALO" ? "Cavalos" : "Carretas"} · ${view.vigencias.alvo.periodLabel}`,
    fatos,
    numeros,
    origem: `getDREDaFrota(${escopo}) · ${view.vigencias.alvo.effectiveDate}`,
    recorte: recorteDe(ctx.info, { vigencia: view.vigencias.alvo.periodLabel }),
    tela: { label: "DRE", href: "/dre" },
    destaque: "Resultado apurado",
    /*
      A ressalva de circularidade acompanha toda resposta de DRE. Ela não é uma
      lacuna de dado que a curadoria possa fechar: é o que o export **é**, e uma
      resposta que a omitisse afirmaria ter medido custo incorrido.
    */
    nota: AVISO_DE_CIRCULARIDADE,
  };
}

/**
 * A placa citada na pergunta, quando há uma.
 *
 * O reconhecimento é da **forma** de uma placa, e a existência é conferida no
 * banco. Reconhecer só pela forma faria "ABC1D23" de uma pergunta hipotética
 * abrir a ficha de um veículo que não existe; conferir sem reconhecer faria
 * cada palavra da frase virar uma consulta.
 *
 * Aceita os dois padrões em circulação: o antigo (ABC1234) e o Mercosul
 * (ABC1D23). A frota real usa o segundo, e o primeiro continua válido enquanto
 * houver equipamento não replacado.
 */
const FORMA_DE_PLACA = /\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/gi;

export async function placaCitada(
  db: Database,
  pergunta: string,
): Promise<{ placa: string; entityId: string; entityType: string } | null> {
  const candidatas = [...pergunta.matchAll(FORMA_DE_PLACA)].map((m) => m[1].toUpperCase());
  if (candidatas.length === 0) return null;

  const { rows } = await db.execute<{
    entity_id: string;
    entity_type: string;
    placa: string;
  }>(sql`
    SELECT ei.entity_id::text AS entity_id, e.entity_type, ei.identifier_value AS placa
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND ei.identifier_value = ANY(${candidatas})
     LIMIT 1
  `);

  const linha = rows[0];
  return linha
    ? { placa: linha.placa, entityId: linha.entity_id, entityType: linha.entity_type }
    : null;
}

/**
 * Por que o resultado de uma unidade mudou — com a ponte real de alterações.
 *
 * Responde às perguntas de §28 que citam uma placa: "por que o ABC1D23 piorou
 * em agosto?". A explicação vem de `explicarResultado`, que a deriva dos
 * números; nada aqui é escrito à mão.
 */
export async function porQueOResultadoMudou(
  db: Database,
  ctx: ContextoResolvido,
  entityId: string,
  escopo: "CAVALO" | "CARRETA" | "CONJUNTO",
  periodo?: string,
): Promise<Evidencia | null> {
  const ponte = await getPonteDaDRE(db, entityId, escopo, {
    context: ctx.contexto,
    ...(periodo ? { period: periodo } : {}),
  });
  if (!ponte || ponte.de === null) return null;

  const explicacao = explicarResultado(ponte);
  const numeros: number[] = [];
  const fatos: Fato[] = [];

  if (ponte.variacaoDoResultado !== null) {
    fatos.push({
      rotulo: "Variação do resultado",
      valor: dinheiro(ponte.variacaoDoResultado, "MENSAL"),
      detalhe: `${ponte.de.periodLabel} → ${ponte.para.periodLabel}`,
    });
    numeros.push(ponte.variacaoDoResultado);
  }

  for (const linha of ponte.porLinha) {
    fatos.push({ rotulo: linha.titulo, valor: dinheiro(linha.efeito, "MENSAL") });
    numeros.push(linha.efeito);
  }

  if (ponte.saldo !== null) {
    fatos.push({ rotulo: "Saldo das alterações", valor: dinheiro(ponte.saldo, "MENSAL") });
    numeros.push(ponte.saldo);
  }

  if (ponte.naoAtribuido !== null && Math.abs(ponte.naoAtribuido) >= 0.01) {
    fatos.push({
      rotulo: "Não atribuído",
      valor: dinheiro(ponte.naoAtribuido, "MENSAL"),
      detalhe: "variação que nenhuma alteração de parâmetro explica",
    });
    numeros.push(ponte.naoAtribuido);
  }

  return {
    ferramenta: "porQueOResultadoMudou",
    titulo: `DRE · o que mudou · ${ponte.de.periodLabel} → ${ponte.para.periodLabel}`,
    fatos,
    numeros,
    origem: `getPonteDaDRE(${entityId}) · ${ponte.para.effectiveDate}`,
    recorte: recorteDe(ctx.info, { vigencia: ponte.para.periodLabel }),
    tela: { label: "DRE do veículo", href: `/dre/${entityId}?escopo=${escopo}` },
    destaque: "Variação do resultado",
    ...(explicacao ? { nota: explicacao.resumo } : {}),
  };
}
