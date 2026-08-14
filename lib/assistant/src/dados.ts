/**
 * De onde vêm os números do assistente.
 *
 * **Nenhum número desta camada é escrito à mão.** Cada fato sai de uma consulta
 * feita na hora, dentro do recorte pedido, e carrega junto a origem — a tabela
 * ou a função que o produziu — para que quem discordar da resposta tenha onde
 * conferir. É a mesma exigência que a tela faz de si mesma; o assistente não
 * está dispensado dela por ser texto.
 *
 * **O que esta camada não faz.** Não estima, não anualiza, não soma
 * periodicidades diferentes e não completa um valor ausente com o valor
 * anterior. Quando a consulta não devolve nada, o dossiê sai com o bloco vazio
 * e a nota dizendo o que faltou. Um assistente que preenche lacuna sozinho é
 * pior que um que não responde, porque não dá para perceber quando ele fez
 * isso.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { bookEntryTable, type Database } from "@workspace/db";
import {
  getFamiliesView,
  getOverview,
  listContexts,
  type FamiliesView,
  type FamilyView,
  type ImpactSummary,
  type ParameterView,
  type SeriesContext,
} from "@workspace/comparison";
import { getCurationSummary } from "@workspace/curation";
import { normalizar } from "./normalizar";

// ── O formato do que sai daqui ──────────────────────────────────────────────

export interface Fato {
  rotulo: string;
  valor: string;
  /** A ressalva que anda junto do número. Aparece sempre que existe. */
  detalhe?: string;
}

export interface BlocoDeDado {
  titulo: string;
  fatos: Fato[];
  /** O que este bloco deliberadamente não responde. */
  nota?: string;
  /** De onde os números vieram — tabela, função, recorte. */
  origem: string;
  tela?: { label: string; href: string };
}

export interface Recorte {
  /** `scope_hash` da unidade, quando quem pergunta já está num recorte. */
  scopeHash?: string;
  channel?: string | null;
  /** A vigência (data efetiva). Sem ela, a mais recente do contexto. */
  period?: string;
}

// ── Formatação ──────────────────────────────────────────────────────────────

const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

const INTEIRO = new Intl.NumberFormat("pt-BR");

/** "/mês", "/ano" — a periodicidade nunca é omitida ao lado de um valor. */
function sufixo(periodicidade: string): string {
  const mapa: Record<string, string> = {
    MENSAL: "/mês",
    ANUAL: "/ano",
    PONTUAL: " (valor único)",
  };
  return mapa[periodicidade] ?? ` (${periodicidade.toLowerCase()})`;
}

/**
 * O impacto escrito como o produto o exibe: uma linha por periodicidade.
 *
 * Devolve `null` quando não há nenhuma periodicidade com valor apurado — e o
 * chamador é obrigado a tratar esse `null`, porque é ele que distingue "não
 * mudou nada em dinheiro" de "mudou e não sabemos quanto".
 */
function impactoEmTexto(impacto: ImpactSummary): string | null {
  const linhas = Object.entries(impacto.byPeriodicity)
    .filter(([, valor]) => valor !== 0)
    .map(([periodicidade, valor]) => {
      const sinal = valor > 0 ? "+" : "−";
      return `${sinal}${REAIS.format(Math.abs(valor))}${sufixo(periodicidade)}`;
    });
  return linhas.length > 0 ? linhas.join(" · ") : null;
}

/** "15 alterações · 0 com impacto calculado" — sempre os dois números juntos. */
function cobertura(calculadas: number, total: number): string {
  if (total === 0) return "sem alterações neste recorte";
  const pct = Math.round((calculadas / total) * 100);
  return `${pct}% do que mudou tem impacto calculável (${INTEIRO.format(calculadas)} de ${INTEIRO.format(total)})`;
}

// ── Panorama: o que o banco tem ─────────────────────────────────────────────

/**
 * O que existe no banco, sem recorte.
 *
 * É o bloco que sustenta perguntas como "o que vocês já têm importado?" e é
 * também o que permite ao assistente recusar bem: com o banco vazio, todo o
 * resto devolve nada, e a resposta certa passa a ser "não há vigência
 * importada" em vez de silêncio.
 */
export async function panorama(db: Database): Promise<BlocoDeDado> {
  const [visao, curadoria, contextos] = await Promise.all([
    getOverview(db),
    getCurationSummary(db),
    listContexts(db),
  ]);

  const t = visao.totals as Record<string, unknown>;
  const numero = (chave: string): number => Number(t[chave] ?? 0);
  const texto = (chave: string): string | null =>
    t[chave] == null ? null : String(t[chave]);

  const confirmados = numero("atributos_confirmados");
  const atributos = numero("atributos");
  const alteracoes = numero("alteracoes");
  const comImpacto = numero("com_impacto");

  const fatos: Fato[] = [
    {
      rotulo: "Vigências importadas",
      valor: INTEIRO.format(numero("vigencias")),
      detalhe:
        texto("primeira_vigencia") && texto("ultima_vigencia")
          ? `de ${texto("primeira_vigencia")} a ${texto("ultima_vigencia")}`
          : undefined,
    },
    { rotulo: "Ativos distintos", valor: INTEIRO.format(numero("ativos")) },
    {
      rotulo: "Atributos no dicionário",
      valor: INTEIRO.format(atributos),
      detalhe: `${INTEIRO.format(confirmados)} com semântica confirmada · ${INTEIRO.format(
        numero("monetarios_pendentes"),
      )} monetários ainda pendentes`,
    },
    {
      rotulo: "Alterações registradas",
      valor: INTEIRO.format(alteracoes),
      detalhe: cobertura(comImpacto, alteracoes),
    },
    {
      rotulo: "Alterações inconclusivas",
      valor: INTEIRO.format(numero("inconclusivas")),
      detalhe: "comparação que o produto se recusa a concluir; ver Alterações",
    },
    {
      rotulo: "Contextos (unidade × canal)",
      valor: INTEIRO.format(contextos.length),
      detalhe:
        contextos.length > 0
          ? contextos.map((c) => c.label).join(", ")
          : "nenhuma vigência importada ainda",
    },
    {
      rotulo: "Atributos por classificar",
      valor: INTEIRO.format(curadoria.unclassified),
      detalhe: "sem nó de taxonomia; não entram em impacto",
    },
  ];

  return {
    titulo: "O que este banco contém",
    fatos,
    origem: "consulta agregada sobre snapshot, entity, attribute e change",
    tela: { label: "Dados", href: "/dados" },
    nota:
      "Números do banco inteiro, sem recorte de unidade ou canal. Um total aqui " +
      "atravessa contextos e não deve ser lido como o resultado de uma operação.",
  };
}

// ── Vigência: o que mudou ───────────────────────────────────────────────────

interface VisaoComRecorte {
  visao: FamiliesView;
  contexto: SeriesContext;
}

async function carregarVisao(
  db: Database,
  recorte: Recorte,
): Promise<VisaoComRecorte | null> {
  const pedido: Partial<SeriesContext> = {};
  if (recorte.scopeHash) pedido.scopeHash = recorte.scopeHash;
  if (recorte.channel !== undefined) pedido.channel = recorte.channel;

  const visao = await getFamiliesView(db, recorte.period, pedido);
  if (!visao) return null;
  return {
    visao,
    contexto: { scopeHash: visao.context.scopeHash, channel: visao.context.channel },
  };
}

/**
 * O resumo de uma vigência: quanto mexeu, em quem, e quanto disso tem preço.
 *
 * A ordem dos fatos não é decorativa — é a mesma da tela de Parâmetros, e pela
 * mesma razão. O tamanho do movimento vem antes do impacto, porque quando a
 * cobertura é baixa o impacto é o número menos informativo dos dois, e quem lê
 * a lista de cima para baixo precisa encontrar primeiro o que o produto
 * consegue afirmar.
 */
export async function resumoDaVigencia(
  db: Database,
  recorte: Recorte = {},
): Promise<BlocoDeDado | null> {
  const carregada = await carregarVisao(db, recorte);
  if (!carregada) return null;
  const { visao } = carregada;
  const resumo = visao.summary;

  const impacto = impactoEmTexto(resumo.impact);
  const fatos: Fato[] = [
    {
      rotulo: "Contexto",
      valor: visao.context.label,
      detalhe:
        visao.otherContexts.length > 0
          ? `outros contextos no banco: ${visao.otherContexts.map((c) => c.label).join(", ")}`
          : "único contexto no banco",
    },
    {
      rotulo: "Vigência",
      valor: visao.periodLabel,
      detalhe: visao.complete
        ? "todas as séries desta vigência entraram na leitura"
        : `séries ausentes: ${visao.missingSeries.join(", ") || "não identificadas"}`,
    },
    {
      rotulo: "Alterações",
      valor: INTEIRO.format(resumo.changes),
      detalhe: cobertura(resumo.impact.calculatedChanges, resumo.changes),
    },
    {
      rotulo: "Veículos afetados",
      valor: INTEIRO.format(resumo.vehiclesTouched),
      detalhe: "ativos distintos — o mesmo caminhão não conta duas vezes",
    },
    {
      rotulo: "Impacto apurado",
      valor: impacto ?? "não apurável com este export",
      detalhe: impacto
        ? "por periodicidade, nunca somado entre elas"
        : `${INTEIRO.format(resumo.notCalculable)} alterações sem preço — semântica ainda não confirmada`,
    },
  ];

  if (resumo.locked > 0) {
    fatos.push({
      rotulo: "Grupos travados por semântica",
      valor: INTEIRO.format(resumo.locked),
      detalhe: "monetários e somáveis, à espera de confirmação na Curadoria",
    });
  }

  if (resumo.topParameters.length > 0) {
    fatos.push({
      rotulo: "Parâmetros que mais mexeram",
      valor: resumo.topParameters
        .slice(0, 3)
        .map((p) => `${p.name} (${INTEIRO.format(p.changes)})`)
        .join(", "),
      detalhe: "ordenado pelo maior valor absoluto dentro de uma periodicidade",
    });
  }

  return {
    titulo: `Vigência ${visao.periodLabel} — ${visao.context.label}`,
    fatos,
    origem: "getFamiliesView (change_set + change, no contexto resolvido)",
    tela: { label: "Parâmetros", href: "/parametros" },
    nota:
      "Este é o movimento **desta** vigência contra a anterior. O acumulado de " +
      "todas as comparações é outro número e vive em campo próprio.",
  };
}

// ── Parâmetro: uma gaveta específica ────────────────────────────────────────

function casa(alvo: string, texto: string): boolean {
  const a = normalizar(alvo);
  const t = normalizar(texto);
  if (!a || !t) return false;
  if (t.includes(a) || a.includes(t)) return true;
  // Palavra a palavra: "indice reajuste" acha "Índice de Reajuste".
  const palavras = a.split(" ").filter((p) => p.length > 3);
  return palavras.length > 0 && palavras.every((p) => t.includes(p));
}

/**
 * O que mudou numa gaveta nomeada — "pneu", "IPVA", "índice de reajuste".
 *
 * Procura primeiro entre os parâmetros e depois entre as famílias, porque quem
 * escreve "pneu" quer o parâmetro e quem escreve "frota" quer a família, e
 * inverter a ordem faria a pergunta específica cair na resposta genérica.
 *
 * Devolve `null` quando não acha. Não devolve o parâmetro mais parecido: um
 * palpite errado aqui sai com número, e número errado com aparência de certo é
 * exatamente o que este produto recusa.
 */
export async function parametro(
  db: Database,
  alvo: string,
  recorte: Recorte = {},
): Promise<BlocoDeDado | null> {
  const carregada = await carregarVisao(db, recorte);
  if (!carregada) return null;
  const { visao } = carregada;

  let achadoParametro: { familia: FamilyView; parametro: ParameterView } | null = null;
  let achadoFamilia: FamilyView | null = null;

  for (const familia of visao.families) {
    for (const p of familia.parameters) {
      if (!achadoParametro && casa(alvo, p.name)) achadoParametro = { familia, parametro: p };
    }
    if (!achadoFamilia && casa(alvo, familia.name)) achadoFamilia = familia;
  }

  if (achadoParametro) {
    const { familia, parametro: p } = achadoParametro;
    const impacto = impactoEmTexto(p.impact);
    const fatos: Fato[] = [
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
        detalhe: impacto
          ? undefined
          : `${INTEIRO.format(p.impact.notCalculable)} alterações sem preço`,
      },
    ];
    if (p.pending) {
      fatos.push({ rotulo: "Pendência declarada", valor: p.pending });
    }
    if (p.groups.length > 0) {
      fatos.push({
        rotulo: "O que mudou dentro dela",
        valor: p.groups.slice(0, 5).map((g) => g.title).join(", "),
        detalhe:
          p.groups.length > 5
            ? `e mais ${INTEIRO.format(p.groups.length - 5)} grupos — ver a tela`
            : undefined,
      });
    }

    return {
      titulo: `${p.name} — ${visao.periodLabel}, ${visao.context.label}`,
      fatos,
      origem: `getFamiliesView → família ${familia.code}, parâmetro ${p.key}`,
      tela: { label: "Parâmetros", href: "/parametros" },
    };
  }

  if (achadoFamilia) {
    const f = achadoFamilia;
    const impacto = impactoEmTexto(f.impact);
    return {
      titulo: `Família ${f.name} — ${visao.periodLabel}, ${visao.context.label}`,
      fatos: [
        { rotulo: "O que ela reúne", valor: f.note },
        {
          rotulo: "Parâmetros",
          valor: `${INTEIRO.format(f.parametersChanged)} de ${INTEIRO.format(f.parametersWithData)} mexeram`,
          detalhe: `nome vindo do ${f.origin === "FREIGHTECH" ? "Freightech" : "FreightCheck"}`,
        },
        {
          rotulo: "Alterações",
          valor: INTEIRO.format(f.changes),
          detalhe: cobertura(f.impact.calculatedChanges, f.changes),
        },
        { rotulo: "Veículos afetados", valor: INTEIRO.format(f.vehicles) },
        {
          rotulo: "Impacto apurado",
          valor: impacto ?? "não apurável com este export",
        },
      ],
      origem: `getFamiliesView → família ${f.code}`,
      tela: { label: "Parâmetros", href: "/parametros" },
    };
  }

  return null;
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
 * A entrada vigente de cada bloco — a de maior revisão.
 *
 * `DISTINCT ON` sobre `block_key` ordenado por revisão decrescente é a leitura
 * que corresponde à regra do schema: a vigente é a de maior número, e não
 * existe coluna dizendo qual é. Perguntar ao banco de outro jeito seria manter
 * uma segunda opinião sobre o mesmo fato.
 */
async function entradasVigentes(db: Database): Promise<EntradaDoBook[]> {
  const { rows } = await db.execute<EntradaDoBook>(sql`
    SELECT DISTINCT ON (block_key)
           block_key      AS "blockKey",
           block_category AS "blockCategory",
           block_title    AS "blockTitle",
           kind::text     AS kind,
           revision,
           filename,
           body_text      AS "bodyText",
           note,
           created_by     AS "createdBy",
           created_at     AS "createdAt"
      FROM book_entry
     ORDER BY block_key, revision DESC
  `);
  return rows;
}

/** Um trecho legível do texto da regra, sem cortar no meio de uma palavra. */
function trecho(texto: string, limite = 600): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, espaco > 0 ? espaco : limite)}…`;
}

/**
 * A cobertura do Book: quais blocos já têm regra registrada.
 *
 * **O denominador não está aqui, e isso é deliberado.** O índice dos blocos é
 * transcrição da tela do Freightech e mora na interface; este módulo conhece
 * apenas o que foi registrado neste produto. Dizer "12 de 66" a partir daqui
 * exigiria uma segunda cópia do índice, que sairia de sincronia com a primeira
 * na primeira vez que o Freightech renomeasse um bloco. A resposta diz o que
 * sabe — quantos blocos têm regra — e manda conferir o total na tela.
 */
export async function coberturaDoBook(db: Database): Promise<BlocoDeDado> {
  const entradas = await entradasVigentes(db);
  const porTipo = entradas.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  const categorias = [...new Set(entradas.map((e) => e.blockCategory))].sort();

  const fatos: Fato[] = [
    {
      rotulo: "Blocos com regra registrada",
      valor: INTEIRO.format(entradas.length),
      detalhe: `${INTEIRO.format(porTipo.TEXTO ?? 0)} escritos como texto · ${INTEIRO.format(
        porTipo.DOCUMENTO ?? 0,
      )} com documento anexado`,
    },
    {
      rotulo: "Categorias cobertas",
      valor: categorias.length > 0 ? categorias.join(", ") : "nenhuma",
    },
  ];

  if (entradas.length > 0) {
    const recentes = [...entradas]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
    fatos.push({
      rotulo: "Registradas por último",
      valor: recentes
        .map((e) => `${e.blockTitle} (rev. ${e.revision})`)
        .join(", "),
    });
  }

  return {
    titulo: "Book do Operador — o que já tem regra",
    fatos,
    origem: "book_entry, entrada vigente por bloco (maior revisão)",
    tela: { label: "Book do Operador", href: "/book-operador" },
    nota:
      "O total de blocos publicados pelo Freightech não é contado aqui: o índice " +
      "é transcrição da tela de origem e vive na interface. Um bloco sem regra " +
      "registrada continua existindo lá e aparece vazio na tela do Book.",
  };
}

/**
 * A regra de um bloco nomeado — "pneu", "lucro armazém", "plano de saúde".
 *
 * Quando a entrada vigente é TEXTO, a regra escrita entra no dossiê e o
 * assistente pode responder a partir dela. Quando é DOCUMENTO, o conteúdo é um
 * arquivo: a resposta diz qual é, de que revisão, e manda baixar — transcrever
 * um PDF de cabeça é a forma mais rápida de inventar uma regra de remuneração.
 */
export async function blocoDoBook(
  db: Database,
  alvo: string,
): Promise<BlocoDeDado | null> {
  const entradas = await entradasVigentes(db);
  const achado = entradas.find(
    (e) => casa(alvo, e.blockTitle) || casa(alvo, `${e.blockCategory} ${e.blockTitle}`),
  );
  if (!achado) return null;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(bookEntryTable)
    .where(eq(bookEntryTable.blockKey, achado.blockKey));

  const fatos: Fato[] = [
    { rotulo: "Categoria", valor: achado.blockCategory },
    {
      rotulo: "Revisão vigente",
      valor: `${achado.revision}`,
      detalhe:
        total === 1
          ? "1 revisão guardada — o Book não apaga nenhuma"
          : `${INTEIRO.format(total)} revisões guardadas — nenhuma foi apagada`,
    },
    {
      rotulo: "Tipo",
      valor: achado.kind === "TEXTO" ? "regra escrita no sistema" : "documento anexado",
      detalhe: achado.filename ?? undefined,
    },
    {
      rotulo: "Registrada por",
      valor: achado.createdBy,
      detalhe: new Date(achado.createdAt).toLocaleDateString("pt-BR"),
    },
  ];

  if (achado.note) fatos.push({ rotulo: "Nota de quem enviou", valor: achado.note });

  if (achado.kind === "TEXTO" && achado.bodyText) {
    fatos.push({ rotulo: "A regra, como foi escrita", valor: trecho(achado.bodyText) });
  }

  return {
    titulo: `Book — ${achado.blockTitle}`,
    fatos,
    origem: `book_entry, bloco "${achado.blockKey}", revisão ${achado.revision}`,
    tela: { label: "Book do Operador", href: "/book-operador" },
    nota:
      achado.kind === "DOCUMENTO"
        ? "A regra está no arquivo anexado. Baixe pela tela do Book — este assistente " +
          "não transcreve o conteúdo de um documento que não leu."
        : undefined,
  };
}

/**
 * Busca no texto das regras escritas.
 *
 * Só alcança entradas do tipo TEXTO, e a resposta diz isso: um PDF anexado não
 * é procurável aqui, e deixar isso implícito faria "não encontrei" parecer
 * "não existe".
 */
export async function buscarNoTextoDoBook(
  db: Database,
  termo: string,
): Promise<BlocoDeDado | null> {
  const alvo = termo.trim();
  if (alvo.length < 3) return null;

  const rows = await db
    .select({
      blockTitle: bookEntryTable.blockTitle,
      blockCategory: bookEntryTable.blockCategory,
      revision: bookEntryTable.revision,
      bodyText: bookEntryTable.bodyText,
    })
    .from(bookEntryTable)
    .where(
      and(
        eq(bookEntryTable.kind, "TEXTO"),
        sql`${bookEntryTable.bodyText} ILIKE ${`%${alvo}%`}`,
      ),
    )
    .orderBy(desc(bookEntryTable.createdAt))
    .limit(4);

  if (rows.length === 0) return null;

  return {
    titulo: `Regras escritas que mencionam "${alvo}"`,
    fatos: rows.map((r) => ({
      rotulo: `${r.blockCategory} · ${r.blockTitle} (rev. ${r.revision})`,
      valor: trecho(r.bodyText ?? "", 400),
    })),
    origem: "book_entry, busca textual em entradas do tipo TEXTO",
    tela: { label: "Book do Operador", href: "/book-operador" },
    nota:
      "A busca alcança apenas regras escritas no sistema. Documentos anexados não " +
      "são procuráveis por texto — se a regra estiver num PDF, ela não aparece aqui.",
  };
}
