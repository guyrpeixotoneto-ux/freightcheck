/**
 * O vocabulário do fechamento de remuneração.
 *
 * Este arquivo existe porque as cinco fontes do fechamento dizem as mesmas
 * coisas com palavras diferentes: o canal é `Rota`/`AS` no 2Art, `Rota`/`AS`
 * no CSV de requisições, e vira seção de relatório (`RESUMO CT-e ROTA`) no
 * TXT do Promax; a frota é `Padrao`/`Spot`/`Fixo`/`Espec.` no 2Art e `FF`/`Van`
 * na disponibilidade. Traduzir cada uma na porta de entrada é o que permite
 * somar as cinco na mesma conta sem que a origem contamine a apuração.
 *
 * A regra que rege o módulo inteiro: **nada é inferido**. Um canal que não
 * reconhecemos não vira "Rota por padrão" — vira recusa com o texto original
 * dentro, porque um fechamento que adivinha é pior do que um que não fecha.
 */

/**
 * O canal de distribuição, o primeiro eixo de agregação de tudo.
 *
 * `ROTA` é a distribuição urbana diária; `AS` é a área de serviço, que atende
 * o interior. Toda fonte separa as duas, toda verba pertence a uma delas, e a
 * conciliação do Promax vem literalmente em duas seções — uma por canal.
 */
export type Canal = "ROTA" | "AS";

/**
 * O tipo de frota, o segundo eixo.
 *
 * `PADRAO` é a frota fixa contratada; `SPOT` é o veículo avulso acionado no
 * dia; `FIXO` é a van dedicada; `ESPECIAL` cobre o que o 2Art marca `Espec.`.
 * A distinção importa porque a remuneração de cada uma nasce de uma regra
 * diferente — e porque as abas diárias da planilha que este módulo substitui
 * abrem exatamente em `TOTAL PADRAO` e `TOTAL SPOT`.
 */
export type Frota = "PADRAO" | "SPOT" | "FIXO" | "ESPECIAL";

/** O tipo de frota na ótica da disponibilidade: caminhão (FF) ou van. */
export type TipoDeFrotaContratada = "FF" | "VAN";

/**
 * As seis fontes que um fechamento consome.
 *
 * Os nomes são os do processo, não os dos arquivos: quem opera chama o
 * relatório pelo número da rotina (`03.08.15`), mas o número é do Promax e
 * pode mudar de versão. O que não muda é o papel de cada um na conta.
 *
 * São seis no catálogo e nem sempre seis na quinzena: a primeira só tem as
 * quatro primeiras — ver `FONTES_DA_QUINZENA`.
 */
export type TipoDeFonte =
  /** 2Art — o diário operacional, uma linha por viagem. Origem do variável. */
  | "OPERACAO"
  /** 03.08.15 — os CT-es emitidos por verba. O extrato fiscal. */
  | "CTE"
  /** 03.08.20 — o demonstrativo de pagamento. A única fonte que abre o fixo. */
  | "PAGAMENTO"
  /** 03.08.18 — frota contratada × realizada. Origem dos descontos no fixo. */
  | "DISPONIBILIDADE"
  /** 03.08.12.09 — requisições de despesa aprovadas. Origem do complementar. Só na 2ª quinzena. */
  | "REQUISICOES"
  /** 03.02.59.02 — a conciliação do Promax. O fecho do mês, e por isso só na 2ª quinzena. */
  | "CONCILIACAO";

export const TIPOS_DE_FONTE: TipoDeFonte[] = [
  "OPERACAO",
  "CTE",
  "PAGAMENTO",
  "DISPONIBILIDADE",
  "REQUISICOES",
  "CONCILIACAO",
];

/**
 * Quais das seis fontes cada quinzena tem.
 *
 * **A primeira quinzena fecha com quatro relatórios; a segunda, com os seis.**
 * As requisições de despesa (03.08.12.09) e a conciliação do Promax
 * (03.02.59.02) chegam com o fechamento da segunda quinzena, e não existem na
 * primeira.
 *
 * A distinção importa porque `fontesAusentes` é lido pela tela: sem ela, toda
 * primeira quinzena do ano nasceria com duas pendências que ninguém pode
 * resolver, e "falta importar" — que é trabalho de alguém — passaria a se
 * confundir com "não há o que importar", que não é. O catálogo por quinzena é o
 * que mantém a lista da tela igual à pilha de arquivos que a Ambev entregou.
 *
 * O que a lista **não** faz é recusar: uma fonte que chegue fora da quinzena
 * dela é lida, apurada e mostrada como qualquer outra. A lista diz o que se
 * espera, não o que se admite — a mesma regra que rege o módulo inteiro, de que
 * a conta roda com o que houver.
 */
export const FONTES_DA_QUINZENA: Record<1 | 2, TipoDeFonte[]> = {
  1: ["OPERACAO", "CTE", "PAGAMENTO", "DISPONIBILIDADE"],
  2: [...TIPOS_DE_FONTE],
};

/**
 * O inverso: em que quinzenas cada fonte é esperada.
 *
 * É esta forma que o catálogo da API carrega, porque a tela pergunta pela
 * fonte ("o 03.02.59.02 entra nesta quinzena?") e não pela quinzena. Derivada
 * de `FONTES_DA_QUINZENA` de propósito: duas listas escritas à mão divergiriam
 * no dia em que uma sétima fonte aparecesse.
 */
export const QUINZENAS_DA_FONTE: Record<TipoDeFonte, (1 | 2)[]> = Object.fromEntries(
  TIPOS_DE_FONTE.map((tipo) => [
    tipo,
    ([1, 2] as const).filter((quinzena) => FONTES_DA_QUINZENA[quinzena].includes(tipo)),
  ]),
) as Record<TipoDeFonte, (1 | 2)[]>;

/** A fonte é esperada nesta quinzena? */
export function fonteEsperadaNaQuinzena(quinzena: 1 | 2, tipo: TipoDeFonte): boolean {
  return FONTES_DA_QUINZENA[quinzena].includes(tipo);
}

/** Como cada fonte se chama na tela, e o que ela responde. */
export const DESCRICAO_DA_FONTE: Record<TipoDeFonte, { rotina: string; nome: string; papel: string }> = {
  OPERACAO: {
    rotina: "2Art",
    nome: "Relatório operacional",
    papel: "Uma linha por viagem: é daqui que sai o frete variável da quinzena.",
  },
  CTE: {
    rotina: "03.08.15",
    nome: "CT-es por verba",
    papel: "Tudo que foi faturado, verba a verba — o que a Ambev diz ter emitido.",
  },
  PAGAMENTO: {
    rotina: "03.08.20",
    nome: "Demonstrativo de pagamento",
    papel:
      "O que a Ambev diz que vai pagar, verba a verba — a única fonte que abre a parcela fixa.",
  },
  DISPONIBILIDADE: {
    rotina: "03.08.18",
    nome: "Disponibilidade de frota",
    papel: "Frota contratada contra a realizada: é daqui que saem os descontos no fixo.",
  },
  REQUISICOES: {
    rotina: "03.08.12.09",
    nome: "Requisições de despesa",
    papel: "As despesas extras aprovadas — o complementar que não nasce do cálculo automático.",
  },
  CONCILIACAO: {
    rotina: "03.02.59.02",
    nome: "Conciliação CT-e × SRTrans",
    papel: "O fecho: emitido contra calculado, com os saldos que atravessam a quinzena.",
  },
};

/**
 * Uma leitura que não pôde ser feita, com o texto original preservado.
 *
 * O módulo devolve recusas em vez de lançar exceção porque um arquivo com uma
 * linha ilegível entre vinte e três mil ainda é um arquivo útil: a apuração
 * roda com o que foi lido e a tela mostra, nominalmente, o que ficou de fora.
 * O que nunca acontece é a linha ilegível virar zero silencioso.
 */
export interface Recusa {
  /** Onde: a linha física do arquivo, 1-based, como o Excel a numera. */
  linha: number;
  /** O que não deu para ler, em uma frase que quem opera entende. */
  motivo: string;
  /** O texto original, para que a decisão possa ser revista sem reabrir o arquivo. */
  original: string;
}

/** O resultado de ler uma fonte: o que entrou, e o que foi recusado. */
export interface Leitura<T> {
  linhas: T[];
  recusas: Recusa[];
}

const CANAIS: Record<string, Canal> = {
  rota: "ROTA",
  as: "AS",
};

/**
 * Traduz o canal como a fonte o escreve.
 *
 * Devolve `null` em vez de um palpite: quem chama decide se a linha vira
 * recusa (quase sempre) ou se o canal vem de outro lugar.
 */
export function lerCanal(bruto: unknown): Canal | null {
  if (typeof bruto !== "string") return null;
  return CANAIS[bruto.trim().toLowerCase()] ?? null;
}

const FROTAS: Record<string, Frota> = {
  padrao: "PADRAO",
  padrão: "PADRAO",
  spot: "SPOT",
  fixo: "FIXO",
  "espec.": "ESPECIAL",
  espec: "ESPECIAL",
  especial: "ESPECIAL",
};

/** Traduz o tipo de frota como o 2Art o escreve. `null` quando não reconhece. */
export function lerFrota(bruto: unknown): Frota | null {
  if (typeof bruto !== "string") return null;
  return FROTAS[bruto.trim().toLowerCase()] ?? null;
}

/**
 * Lê um número como as fontes brasileiras o escrevem.
 *
 * O CSV do SRTrans escreve `7.049,93` — ponto de milhar, vírgula decimal — e
 * as planilhas entregam número nativo. As duas formas passam por aqui, e
 * qualquer outra coisa devolve `null`, nunca `0`: a diferença entre "não paga
 * nada" e "não consegui ler" é o tipo de erro que custa dinheiro no
 * fechamento.
 */
export function lerNumero(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (texto === "") return null;
  // `1.234,56` (pt-BR) vira `1234.56`; `1234.56` (já normalizado) passa direto.
  const normalizado = /,/.test(texto)
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/** Arredonda para centavos — a moeda do fechamento não tem casa decimal escondida. */
export function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}
