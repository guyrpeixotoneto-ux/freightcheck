/**
 * CORPUS A — o conhecimento conceitual, indexado por trecho.
 *
 * São três origens e um formato só. O catálogo do Freightech diz o que cada
 * gaveta **é** e o que o export traz ou não traz dela; o índice do Book diz de
 * que assunto cada bloco trata; os artigos dizem como o FreightCheck funciona.
 * Perguntas conceituais — "o que é", "como funciona", "como é calculado" — se
 * respondem aqui, e só aqui.
 *
 * **Trecho, não documento.** A unidade recuperável é um cartão ou um bloco, não
 * o corpus inteiro. Uma pergunta sobre combustível traz o cartão Combustível e
 * os blocos de combustível, e não os outros setenta e quatro. Isso não é
 * economia de token — os três corpora somados dão ~30k caracteres e caberiam
 * inteiros num prompt. É precisão: material irrelevante no contexto é material
 * que o modelo pode citar, e citar o cartão errado com segurança é o defeito
 * que este produto menos pode cometer.
 *
 * **O texto do trecho é sintetizado dos campos, nunca escrito aqui.** Um cartão
 * vira prosa a partir de `nome`, `secao`, `nota`, `colunas`, `parametros` e
 * `atributos`. Assim o corpus acompanha o catálogo sem uma segunda cópia para
 * sair de sincronia — quando alguém confere mais um cartão contra a tela do
 * Freightech, o assistente sabe no mesmo commit.
 */

import {
  BLOCOS_BOOK,
  CATALOGO_FREIGHTECH,
  chaveDoBloco,
  chaveDoCartao,
} from "@workspace/knowledge";
import { ARTIGOS } from "./conhecimento";
import { normalizar, pontuar, termos } from "./normalizar";

export type Corpus = "CATALOGO" | "BOOK_INDICE" | "ARTIGO";

export interface Trecho {
  id: string;
  corpus: Corpus;
  titulo: string;
  /**
   * O vocabulário de sistema deste assunto — nomes de coluna, códigos de
   * atributo, nome do parâmetro interno.
   *
   * Fica **fora** de `texto` de propósito, e esta separação é a correção de um
   * defeito de contexto que passava por defeito de estilo. O trecho de
   * Combustível terminava com "mostra as colunas: Descricao, Iniciativa,
   * Creditoimposto, Precoanp, Precooperadora" — e um modelo instruído a ser
   * fiel ao dossiê repetia aquilo numa resposta sobre como o preço funciona.
   * Não era o modelo sendo técnico: era o material sendo técnico, e nenhum
   * prompt corrige um parágrafo que já vem assim escrito.
   *
   * O identificador continua na busca (`termos`), onde ele serve — quem digita
   * `Precoanp` tem de achar esta tela —, e só chega ao modelo quando a pergunta
   * é declaradamente técnica.
   */
  tecnico?: string;
  /** Onde ele mora — a seção do catálogo, a categoria do bloco, a área do artigo. */
  secao: string;
  /** A prosa recuperável. */
  texto: string;
  /** O vocabulário que leva até aqui. */
  termos: string[];
  /** Onde conferir. */
  fonte: string;
  tela?: { label: string; href: string };
  /** Nomes de parâmetro (na nomenclatura de `families.ts`) que este trecho cobre. */
  parametros: string[];
  /** Códigos de atributo que este trecho cobre. */
  atributos: string[];
  /**
   * O Freightech publica colunas que este export não traz.
   *
   * É o campo que sustenta a distinção mais importante que o assistente
   * precisa fazer: "o conceito existe lá, o dado não chega aqui" não é a mesma
   * resposta que "não encontrei".
   */
  colunasDaOrigem: string[];
}

// ── Construção do índice ────────────────────────────────────────────────────

/** Quebra `cavalo.combustivel_consumo_neg` em termos buscáveis. */
function termosDoCodigo(codigo: string): string[] {
  return codigo
    .split(/[.\-_]/)
    .map((parte) => normalizar(parte))
    .filter((parte) => parte.length > 2);
}

/** `PRECOANP` e `Precocreditoimpostos` viram termos legíveis. */
function termosDaColuna(coluna: string): string[] {
  const limpo = normalizar(coluna);
  const partes = coluna
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-zÀ-ÿ0-9]+/)
    .map((p) => normalizar(p))
    .filter((p) => p.length > 2);
  return [limpo, ...partes];
}

function trechosDoCatalogo(): Trecho[] {
  const trechos: Trecho[] = [];

  for (const secao of CATALOGO_FREIGHTECH) {
    for (const cartao of secao.cartoes) {
      /*
        O trecho abre pelo assunto, não pela identidade do cartão.

        A abertura era `"Combustível" é uma gaveta da seção FROTA do
        Freightech` — uma frase sobre a arrumação do sistema, no lugar em que
        se espera a explicação. Quem lê a resposta já sabe que perguntou sobre
        combustível; o que ele não sabe é como o preço funciona, e é a `nota`
        que diz isso. Título e seção continuam existindo como metadado: eles
        aparecem no cabeçalho do dossiê e na lista de fontes, que é onde a
        identidade pertence.
      */
      const partes: string[] = [];

      if (cartao.nota) partes.push(cartao.nota);
      else partes.push(`${cartao.nome} é uma das telas de ${secao.titulo} do Freightech.`);

      if (cartao.entidade) {
        partes.push(`É um inventário de ${cartao.entidade.toLowerCase()}: uma linha por veículo.`);
      }

      if (!cartao.parametros?.length && !cartao.atributos?.length) {
        /*
          A ausência dita em linguagem de operação, não de banco.

          "Nenhum parâmetro deste export alimenta esta gaveta" é verdadeiro e
          incompreensível para quem não conhece a estrutura interna. O que a
          pessoa precisa saber é qual arquivo tem o dado e qual não tem.
        */
        partes.push(
          `O arquivo de equipamentos que o FreightCheck recebe hoje não traz os dados desta ` +
            `tela — eles existem no Freightech, em outro arquivo, que ainda não foi importado.`,
        );
      }

      // ---- o vocabulário de sistema, separado ------------------------------
      const tecnico: string[] = [];
      if (cartao.colunas?.length) {
        tecnico.push(`Colunas desta tela no Freightech: ${cartao.colunas.join(", ")}.`);
      }
      if (cartao.formulario?.length) {
        const campos = cartao.formulario.flatMap((s) =>
          s.campos.map((c) => (c.calculado ? `${c.nome} (calculado)` : c.nome)),
        );
        tecnico.push(`No Freightech este cartão abre uma ficha, não uma tabela. Campos: ${campos.join(", ")}.`);
      }
      if (cartao.parametros?.length) {
        tecnico.push(`No FreightCheck corresponde ao parâmetro ${cartao.parametros.join(", ")}.`);
      }
      if (cartao.atributos?.length) {
        tecnico.push(`Colunas do export que a alimentam: ${cartao.atributos.join(", ")}.`);
      }

      const termos = [
        normalizar(cartao.nome),
        ...cartao.nome.split(/\s+/).map(normalizar).filter((t) => t.length > 2),
        normalizar(secao.titulo),
        ...(cartao.parametros ?? []).flatMap((p) =>
          p.split(/\s+/).map(normalizar).filter((t) => t.length > 2),
        ),
        ...(cartao.atributos ?? []).flatMap(termosDoCodigo),
        ...(cartao.colunas ?? []).flatMap(termosDaColuna),
      ];

      trechos.push({
        id: `catalogo:${chaveDoCartao(secao.titulo, cartao.nome)}`,
        corpus: "CATALOGO",
        titulo: cartao.nome,
        secao: secao.titulo,
        texto: partes.join(" "),
        ...(tecnico.length > 0 ? { tecnico: tecnico.join(" ") } : {}),
        termos: [...new Set(termos)],
        fonte: `Catálogo do Freightech · ${secao.titulo} › ${cartao.nome}`,
        tela: { label: "Parâmetros", href: "/parametros" },
        parametros: cartao.parametros ?? [],
        atributos: cartao.atributos ?? [],
        colunasDaOrigem: cartao.colunas ?? [],
      });
    }
  }

  return trechos;
}

function trechosDoBook(): Trecho[] {
  return BLOCOS_BOOK.map((bloco) => ({
    id: `book:${chaveDoBloco(bloco)}`,
    corpus: "BOOK_INDICE" as const,
    titulo: bloco.titulo,
    secao: bloco.categoria,
    texto:
      `"${bloco.titulo}" é um bloco da categoria ${bloco.categoria} do Book do Operador. ` +
      `O Freightech o descreve assim: ${bloco.descricao}` +
      (bloco.truncada ? " (a descrição foi cortada na captura e está incompleta)" : ""),
    termos: [
      ...new Set([
        normalizar(bloco.titulo),
        ...bloco.titulo.split(/[\s\-–—]+/).map(normalizar).filter((t) => t.length > 2),
        normalizar(bloco.categoria),
        ...bloco.descricao.split(/\s+/).map(normalizar).filter((t) => t.length > 3),
      ]),
    ],
    fonte: `Book do Operador · ${bloco.categoria} › ${bloco.titulo}`,
    tela: { label: "Book do Operador", href: "/book-operador" },
    parametros: [],
    atributos: [],
    colunasDaOrigem: [],
  }));
}

function trechosDosArtigos(): Trecho[] {
  return ARTIGOS.map((artigo) => ({
    id: `artigo:${artigo.id}`,
    corpus: "ARTIGO" as const,
    titulo: artigo.titulo,
    secao: artigo.area,
    texto: artigo.corpo,
    termos: [
      ...new Set([
        ...artigo.termos.map(normalizar),
        ...artigo.perguntas.flatMap((p) =>
          p.split(/\s+/).map(normalizar).filter((t) => t.length > 3),
        ),
      ]),
    ],
    fonte: artigo.fonte,
    tela: artigo.tela,
    parametros: [],
    atributos: [],
    colunasDaOrigem: [],
  }));
}

/**
 * O índice, montado uma vez.
 *
 * É constante em memória porque as três origens são código: mudam por deploy,
 * nunca por requisição. Reconstruí-lo a cada pergunta seria trabalho puro.
 */
export const TRECHOS: Trecho[] = [
  ...trechosDoCatalogo(),
  ...trechosDoBook(),
  ...trechosDosArtigos(),
];

// ── Recuperação ─────────────────────────────────────────────────────────────

export interface TrechoRelevante {
  trecho: Trecho;
  pontos: number;
}

/**
 * Abaixo disto o casamento é ruído — o mesmo limiar da busca de artigos, e pela
 * mesma razão: quem não passa daqui não entra na resposta, e a resposta certa
 * passa a ser "não encontrei".
 */
export const LIMIAR = 0.28;

export interface OpcoesDeBusca {
  limite?: number;
  /** Restringe a busca a certos corpora. */
  corpora?: Corpus[];
  /** Códigos de atributo já resolvidos — trechos que os cobrem sobem. */
  atributos?: string[];
  /** Nomes de parâmetro já resolvidos — idem. */
  parametros?: string[];
}

/**
 * Os trechos que respondem esta pergunta.
 *
 * O ganho decisivo sobre a busca anterior é o **empurrão por ligação**: quando
 * o parâmetro já foi resolvido — "combustível" virou
 * `cavalo.combustivel_consumo_neg` —, o cartão que declara aquele atributo sobe
 * mesmo que o nome dele não se pareça com a pergunta. É o que liga o corpus
 * conceitual ao dicionário de parâmetros sem que nenhum dos dois precise
 * conhecer o outro.
 */
export function buscarTrechos(
  pergunta: string,
  opcoes: OpcoesDeBusca = {},
): TrechoRelevante[] {
  const { limite = 4, corpora, atributos = [], parametros = [] } = opcoes;
  const universo = corpora
    ? TRECHOS.filter((t) => corpora.includes(t.corpus))
    : TRECHOS;

  const atributosPedidos = new Set(atributos);
  const parametrosPedidos = new Set(parametros.map(normalizar));

  const achados: TrechoRelevante[] = [];

  const palavrasDaPergunta = termos(pergunta);

  for (const trecho of universo) {
    const porTermo = pontuar(pergunta, trecho.termos);
    /*
      O título entra pelas palavras que valem, não pelas que ele tem.

      `pontuar` divide pelo número de termos do assunto, então passar o título
      cru fazia "Por que nunca existe um total único de impacto" ser dividido
      por nove — quatro delas artigos e preposições. O artigo que responde
      exatamente "como o FreightCheck calcula o impacto?" ficava em 0,22, dois
      centésimos abaixo do limiar, e a pergunta voltava "não encontrei".
    */
    const porTitulo = pontuar(pergunta, termos(trecho.titulo));

    /*
      E o quanto **da pergunta** este trecho cobre.

      As duas medidas acima olham do lado do assunto: que fração do vocabulário
      dele a pergunta acertou. Um artigo bem indexado, com dez sinônimos e
      quatro perguntas de exemplo, é punido por isso — acertar "impacto" em
      dezessete termos dá 0,12. Esta terceira olha do lado de quem perguntou:
      das palavras que a pessoa escreveu, quantas este trecho conhece. Palavra
      curta conta metade, porque "dado" e "mes" casam em qualquer lugar.
    */
    const vocabulario = [...trecho.termos, ...termos(trecho.titulo)];
    let cobertas = 0;
    let peso = 0;
    for (const palavra of palavrasDaPergunta) {
      const valor = palavra.length >= 5 ? 1 : 0.5;
      peso += valor;
      if (vocabulario.some((t) => t === palavra || t.split(" ").includes(palavra))) {
        cobertas += valor;
      }
    }
    // Descontado em 10%: um acerto direto de vocabulário continua valendo mais
    // que a cobertura, e o desconto é o que preserva a ordem entre os dois.
    const porPergunta = peso > 0 ? (cobertas / peso) * 0.9 : 0;

    const ligado =
      trecho.atributos.some((a) => atributosPedidos.has(a)) ||
      trecho.parametros.some((p) => parametrosPedidos.has(normalizar(p)));

    /*
      A ligação vale meio ponto — dividido por quantas coisas o trecho declara.

      Quem declara sessenta colunas está ligado a quase toda pergunta, e isso
      não é sinal de nada. Era o que fazia "como funciona IPVA?" ser respondida
      pelo cartão "Carreta" — o inventário inteiro do implemento, que menciona
      IPVA entre outras cinquenta e nove colunas — em vez do artigo que se chama
      "A armadilha do IPVA mensal × anual". O cartão específico continua
      ganhando o empurrão quase inteiro; o cartão-catálogo ganha um resíduo.
    */
    const declarados = trecho.parametros.length + trecho.atributos.length;
    const forcaDaLigacao = ligado ? 0.5 / (1 + declarados / 8) : 0;

    // O bastante para passar o limiar sozinha, nunca o bastante para colocar um
    // trecho irrelevante à frente de um relevante.
    /*
      O título entra como reforço, nunca como nota principal.

      Como nota principal ele decidia a ordem pelo motivo errado: `pontuar`
      divide pelo tamanho do assunto, então um título curto com uma palavra
      comum ganhava de um artigo que casava duas palavras específicas. Foi assim
      que "por que o impacto é acumulado por periodicidade?" veio a ser
      respondida com o artigo de cobertura da apuração — cujo título tem
      "impacto" e cinco palavras — em vez do artigo que se chama, literalmente,
      "Por que nunca existe um total único de impacto".

      Como reforço ele faz o que se espera dele: desempata entre dois trechos que
      cobrem a pergunta igualmente bem, a favor do que a anuncia no título.
    */
    const pontos =
      Math.max(porTermo, porPergunta) + porTitulo * 0.3 + forcaDaLigacao;

    if (pontos >= LIMIAR) achados.push({ trecho, pontos });
  }

  return achados.sort((a, b) => b.pontos - a.pontos).slice(0, limite);
}

/** Um trecho por id, para citar a fonte de uma resposta já dada. */
export function trechoPorId(id: string): Trecho | undefined {
  return TRECHOS.find((t) => t.id === id);
}
