/**
 * A ESPECIFICAÇÃO — o que exatamente se vai pesquisar, montado do que o
 * FreightCheck já sabe.
 *
 * Pesquisar "pneu" devolve o mercado inteiro e nenhuma cotação comparável.
 * Pesquisar "Pneu 295/80 R22.5, aplicação rodoviária, 40 unidades, entrega em
 * Camaçari/BA" devolve ofertas que se pode comparar entre si e contra a
 * remuneração. A diferença entre as duas buscas não é esperteza do modelo: é
 * **dado interno que este produto já tem** — o item do catálogo, a descrição
 * que quem cotou escreveu, a quantidade do pedido, a unidade da operação.
 *
 * Este arquivo é quem junta isso, **antes** de qualquer chamada ao mercado, e é
 * por isso que ele é determinístico e testável sem rede: a mesma cotação produz
 * sempre a mesma especificação, e é ela que viaja como evidência da busca.
 *
 * **Atributo é lido por regra, não por interpretação.** Medida de pneu, volume,
 * peso, tensão e norma técnica têm forma escrita, e a forma é o que se casa —
 * `295/80 R22.5` é uma medida, `295 reais` não é. O que a regra não reconhecer
 * fica no texto livre da especificação, que continua indo para a busca; o que
 * ela reconhecer vira {@link AtributoDaEspecificacao}, e aí passa a **valer
 * para o match** (ver `match.ts`). É a diferença entre uma palavra na consulta
 * e um critério de comparabilidade.
 */

import { produtoDe, type ProdutoDeCompra } from "../catalogo";

/** Um atributo reconhecido por regra, com a forma canônica que o match compara. */
export interface AtributoDaEspecificacao {
  /** `medida-pneu`, `volume`, `peso`, `tensao`, `norma`… */
  tipo: TipoDeAtributo;
  /** Como o texto o escreveu — a evidência. */
  bruto: string;
  /** A forma canônica, para comparar sem depender de grafia. */
  canonico: string;
  /** De onde saiu: a descrição da cotação, o rótulo do item, o pedido. */
  origem: string;
}

export type TipoDeAtributo =
  | "MEDIDA_PNEU"
  | "VOLUME"
  | "PESO"
  | "TENSAO"
  | "POTENCIA"
  | "NORMA"
  | "TAMANHO";

export const ROTULO_DO_ATRIBUTO: Record<TipoDeAtributo, string> = {
  MEDIDA_PNEU: "Medida",
  VOLUME: "Volume",
  PESO: "Peso",
  TENSAO: "Tensão",
  POTENCIA: "Potência",
  NORMA: "Norma técnica",
  TAMANHO: "Tamanho",
};

/**
 * Os reconhecedores, na ordem em que são tentados.
 *
 * Cada um é uma expressão e uma canonização. A ordem importa onde dois padrões
 * podem casar o mesmo texto: a medida de pneu vem antes do tamanho genérico,
 * porque `295/80 R22.5` também casaria com "um número seguido de letra".
 *
 * **A âncora de palavra em toda expressão não é zelo**: sem ela, `22.5` dentro
 * de `R$ 1.022,50` viraria uma medida, e a busca sairia atrás de um pneu que
 * ninguém mencionou.
 */
const RECONHECEDORES: {
  tipo: TipoDeAtributo;
  padrao: RegExp;
  canonizar: (casa: RegExpMatchArray) => string;
}[] = [
  {
    /*
      295/80 R22.5, 295/80R22,5, 1100x20 — e **295-80R22.5**, que é a mesma
      medida escrita com hífen.
      
      O hífen entrou depois de uma pesquisa real: um anúncio do Magazine Luiza
      escrevia "295-80R22.5" e a oferta caiu de EXATO para COMPATIVEL por causa
      de um caractere. Não é detalhe de formatação — a classe do match decide se
      a oferta entra na conta como confirmada, e o e-commerce brasileiro
      escreve medida dos três jeitos.
    */
    tipo: "MEDIDA_PNEU",
    padrao: /\b(\d{3})\s*[/x-]\s*(\d{2,3})\s*[- ]?\s*r?\s*(\d{2}(?:[.,]\d)?)\b/i,
    canonizar: (c) => `${c[1]}/${c[2]}R${(c[3] ?? "").replace(",", ".")}`,
  },
  {
    tipo: "VOLUME",
    padrao: /\b(\d+(?:[.,]\d+)?)\s*(l|lt|litros?|ml)\b/i,
    canonizar: (c) => {
      const n = Number((c[1] ?? "0").replace(",", "."));
      const unidade = (c[2] ?? "").toLowerCase();
      const litros = unidade === "ml" ? n / 1000 : n;
      return `${litros}L`;
    },
  },
  {
    tipo: "PESO",
    padrao: /\b(\d+(?:[.,]\d+)?)\s*(kg|quilos?|g|gramas?)\b/i,
    canonizar: (c) => {
      const n = Number((c[1] ?? "0").replace(",", "."));
      const unidade = (c[2] ?? "").toLowerCase();
      const quilos = unidade.startsWith("g") ? n / 1000 : n;
      return `${quilos}kg`;
    },
  },
  {
    tipo: "TENSAO",
    padrao: /\b(\d{2,3})\s*v(?:olts?)?\b/i,
    canonizar: (c) => `${c[1]}V`,
  },
  {
    tipo: "POTENCIA",
    padrao: /\b(\d+(?:[.,]\d+)?)\s*(cv|hp|kw)\b/i,
    canonizar: (c) =>
      `${(c[1] ?? "").replace(",", ".")}${(c[2] ?? "").toUpperCase()}`,
  },
  {
    /* NBR 20345, ISO 9001, CA 12345 — o que define conformidade do EPI e afins. */
    tipo: "NORMA",
    padrao: /\b((?:nbr|iso|din|sae|ca)\s*-?\s*\d{3,6})\b/i,
    canonizar: (c) => (c[1] ?? "").toUpperCase().replace(/[\s-]+/g, " "),
  },
  {
    /* Tamanho de vestuário: "tamanho 42", "tam. G". */
    tipo: "TAMANHO",
    padrao: /\btam(?:anho)?\.?\s*([0-9]{2}|pp|p|m|g|gg|xg)\b/i,
    canonizar: (c) => (c[1] ?? "").toUpperCase(),
  },
];

/** Os atributos que um texto declara, sem repetir tipo. */
export function atributosDoTexto(
  texto: string | null | undefined,
  origem: string,
): AtributoDaEspecificacao[] {
  if (!texto) return [];
  const achados: AtributoDaEspecificacao[] = [];
  for (const r of RECONHECEDORES) {
    if (achados.some((a) => a.tipo === r.tipo)) continue;
    const casa = texto.match(r.padrao);
    if (!casa) continue;
    achados.push({
      tipo: r.tipo,
      bruto: casa[0].trim(),
      canonico: r.canonizar(casa),
      origem,
    });
  }
  return achados;
}

/** O que vai para a busca de mercado. */
export interface EspecificacaoDeCompra {
  /** A chave do produto no catálogo. */
  item: string;
  produto: ProdutoDeCompra | null;
  /** O nome que se pesquisa — o rótulo do item, ou a descrição quando ela existe. */
  titulo: string;
  /** A descrição livre que quem cotou escreveu. Vale texto, não critério. */
  descricao: string | null;
  atributos: AtributoDaEspecificacao[];
  quantidade: number | null;
  /** Onde entregar — a unidade da operação, quando declarada. */
  regiao: string | null;
  /**
   * A consulta escrita, como ela vai para o mercado.
   *
   * Uma só, e não uma lista de variações: a variação é trabalho do buscador, e
   * gerar cinco consultas aqui multiplicaria o custo da pesquisa por cinco sem
   * acrescentar um critério de comparabilidade sequer.
   */
  consulta: string;
  /**
   * O que ficou faltando para a especificação ser precisa.
   *
   * Não é erro: é o que a resposta mostra quando as cotações vierem largas.
   * Uma busca por "Pneus" sem medida **encontra** ofertas, e nenhuma delas é
   * comparável — e é melhor dizer isso antes do que explicar depois.
   */
  lacunas: string[];
}

/**
 * De um item (mais o que se sabe dele) para a especificação da busca.
 *
 * `descricao` é o campo livre da cotação — "295/80 R22.5 recapado" —, e é dele
 * que sai quase todo atributo reconhecido. Sem descrição, a especificação é o
 * rótulo do catálogo, e a lacuna diz isso.
 */
export function especificarCompra(entrada: {
  item: string;
  descricao?: string | null;
  /**
   * Texto de onde se pode **ler atributo**, mas que não descreve o item.
   *
   * É a pergunta digitada. "Pesquise pneu 295/80 R22.5 no mercado, 40 unidades"
   * carrega a medida, e a medida é ouro; a frase inteira, porém, não é o nome
   * do produto — usá-la como título faria a resposta abrir com
   * *"Item: Pesquise pneu… no mercado"*, que é a pergunta de volta.
   *
   * Então ela entra por aqui: vale para reconhecer atributo e não vale para
   * nomear o item. O nome continua vindo da descrição da cotação ou do rótulo
   * do catálogo, que são as duas fontes que de fato descrevem a coisa.
   */
  textoLivre?: string | null;
  quantidade?: number | null;
  regiao?: string | null;
}): EspecificacaoDeCompra {
  const produto = produtoDe(entrada.item) ?? null;
  const descricao = (entrada.descricao ?? "").trim() || null;
  const rotulo = produto?.rotulo ?? entrada.item;

  const atributos = [
    ...atributosDoTexto(descricao, "Descrição da cotação"),
    ...atributosDoTexto(entrada.textoLivre ?? null, "Pergunta"),
    ...atributosDoTexto(rotulo, "Rótulo do item"),
  ].filter((a, i, todos) => todos.findIndex((o) => o.tipo === a.tipo) === i);

  const quantidade =
    typeof entrada.quantidade === "number" && entrada.quantidade > 0
      ? entrada.quantidade
      : null;
  const regiao = (entrada.regiao ?? "").trim() || null;
  const titulo = descricao ?? rotulo;

  const partes = [titulo];
  for (const a of atributos) {
    /* O canônico só entra quando o texto não o traz — senão a consulta repete. */
    if (!titulo.toLowerCase().includes(a.bruto.toLowerCase()))
      partes.push(a.canonico);
  }
  if (quantidade !== null) partes.push(`${quantidade} unidades`);
  if (regiao !== null) partes.push(`entrega em ${regiao}`);
  partes.push("preço fornecedor Brasil");

  const lacunas: string[] = [];
  if (descricao === null) {
    lacunas.push(
      `A cotação não traz descrição do item: a busca sai com "${rotulo}", que é o rótulo do ` +
        "catálogo. Descreva o que exatamente se compra — medida, marca, aplicação — e as " +
        "ofertas passam a ser comparáveis entre si.",
    );
  }
  if (atributos.length === 0) {
    lacunas.push(
      "Nenhum atributo técnico foi reconhecido no texto (medida, volume, peso, norma). " +
        "Sem atributo, nenhuma oferta pode ser classificada como exata — ver o critério de match.",
    );
  }
  if (quantidade === null) {
    lacunas.push(
      "Sem quantidade, o pedido mínimo do fornecedor não pode ser conferido.",
    );
  }
  if (regiao === null) {
    lacunas.push(
      "Sem região de entrega, o frete das ofertas não pode ser comparado.",
    );
  }

  return {
    item: entrada.item,
    produto,
    titulo,
    descricao,
    atributos,
    quantidade,
    regiao,
    consulta: partes.join(", "),
    lacunas,
  };
}
