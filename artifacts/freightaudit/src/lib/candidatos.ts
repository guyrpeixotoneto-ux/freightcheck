import { periodicitySuffix } from "@workspace/comparison/labels";
import type { NaturezaEconomica } from "@workspace/comparison/monitor-custo-fixo";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * OS NÚMEROS DE CADA CANDIDATA A "DE" — e a regra de quando não escrever nada.
 *
 * ---------------------------------------------------------------------------
 * Por que este módulo não mora em `lib/finame.ts`
 * ---------------------------------------------------------------------------
 * Porque quem o lê é o seletor de par (`components/comparacao/seletor-do-par`),
 * que desde a Auditoria de IPVA serve **duas** telas. Um componente
 * compartilhado importando do módulo de uma rubrica é a seta apontando para o
 * lado errado: bastaria a segunda tela querer a mesma coluna para o FINAME
 * virar dependência de quem não fala de FINAME.
 *
 * Aqui não há nada de FINAME — é a forma de uma resposta de candidatas e a
 * regra de como ela vira texto. Uma rota `/ipva/candidatos` que devolva esta
 * mesma forma entra sem tocar em nada.
 */

/**
 * Um balde de dinheiro de um par — a periodicidade, a natureza e o líquido.
 *
 * `natureza` é `null` no recorte de uma rubrica só, e a linha sai como sempre
 * saiu: `+R$ 7.238,85/mês`, sem prefixo. Numa tela cujo nome já é o da rubrica,
 * dizer "Custo" ao lado do número é repetir o que a tela inteira diz.
 *
 * Ela vem preenchida do único recorte que mistura as duas naturezas — o Monitor
 * Custo Fixo —, e ali o prefixo é obrigatório: um número só, com o custo que
 * subiu somado à receita que subiu, é o "impacto líquido" que os cartões
 * daquela tela recusam publicar em letra grande. O espelho do tipo que a rota
 * publica (`api-server/src/lib/candidatas-do-par.ts`).
 */
export interface BaldeDoImpacto {
  periodicidade: string;
  natureza: NaturezaEconomica | null;
  valor: number;
}

/** O que uma rota de candidatas devolve. */
export interface CandidatosDoPar {
  para: string;
  candidatos: {
    id: string;
    numeros: {
      alteracoes: number;
      /*
        Só os baldes, e é o que a linha precisa.

        A primeira versão deste tipo copiou o impacto do FINAME inteiro, com
        `cobertasPorParcelas` junto — e o IPVA, que chama o mesmo campo de
        `foraDaSoma`, não caberia aqui sem inventar uma conversão. Pedir só o
        que se lê é o que torna esta forma comum de verdade: cada rubrica
        acrescenta o que quiser no resto, e nada disso chega ao menu.
      */
      impacto: { baldes: BaldeDoImpacto[] };
    } | null;
  }[];
  /** Quantas candidatas não couberam no orçamento desta chamada. */
  pendentes: number;
}

/**
 * Como uma linha de dinheiro se lê — e é isto que a pinta.
 *
 * A régua é o **sinal**: positivo é ganho, negativo é perda, zero não é nem um
 * nem outro. Ela sai daqui em vez de o seletor a redescobrir do número porque
 * cor e palavra têm de dizer a mesma coisa: "Perda" em verde é pior do que
 * qualquer uma das duas sozinha, e duas réguas em dois arquivos divergem no
 * primeiro que alguém mexer.
 */
export type LeituraDoValor = "GANHO" | "PERDA" | "NEUTRO";

export function leituraDoValor(valor: number): LeituraDoValor {
  if (valor > 0) return "GANHO";
  if (valor < 0) return "PERDA";
  return "NEUTRO";
}

/** O que uma linha do menu mostra à direita da vigência. */
export interface NumerosDaLinha {
  /**
   * Uma linha de dinheiro por periodicidade, já escrita — **nunca vazia**.
   *
   * Quando o par não move dinheiro nenhum, a lista é `R$ 0,00`: a coluna
   * zerada é a resposta, e a coluna em branco era a ausência dela. Ver
   * {@link numerosDaLinha}.
   */
  valores: { texto: string; bruto: number; leitura: LeituraDoValor }[];
  /** "457 alterações", "1 alteração", "0 alterações". */
  alteracoes: string;
}

/**
 * O que escrever ao lado de uma vigência — ou **nada**, que é o caso que
 * importa.
 *
 * A regra inteira está no tipo de retorno: `null` quer dizer *não escreva
 * número nenhum nesta linha*, e é o que sai para quem ainda não foi calculado.
 * Ausência de cálculo e "nada mudou" são fatos diferentes, e é essa fronteira
 * — e só ela — que separa a linha muda da linha zerada. Um número escrito por
 * cima de uma conta que não aconteceu **mente com números**, que é a pior
 * forma de mentir numa tela de auditoria; um número escrito sobre uma conta
 * que aconteceu e deu zero é a notícia que quem audita veio buscar.
 *
 * Calculado, o par **sempre** escreve as duas coisas: o dinheiro e a contagem.
 * A versão anterior filtrava os baldes zerados e, quando nada mudava, sobrava
 * a coluna do dinheiro em branco ao lado de um "nenhuma alteração" — duas
 * linhas vizinhas, uma com `+R$ 7.238,85/mês` e outra com espaço vazio, que é
 * exatamente a leitura que o seletor não pode oferecer: espaço em branco na
 * coluna do dinheiro já significa *ainda não calculei* nesta tela, e a mesma
 * casa não pode significar *calculei e deu zero*. `R$ 0,00` e `0 alterações`
 * dizem a segunda em voz alta, na mesma régua em que as outras linhas dizem a
 * delas.
 *
 * O zero não leva sinal: `+` e `−` são a direção do movimento, e não há direção
 * quando não houve movimento. Quem pinta a linha é o seletor, e ele lê
 * `leitura` — a mesma que escolheu o sinal, de modo que a cor nunca pode
 * discordar dele. Zero não é positivo nem negativo, e não recebe a cor de
 * nenhum dos dois.
 *
 * O dinheiro sai por periodicidade, cada balde na sua linha, com o sufixo do
 * motor (`/mês`, `/ano`, `(valor único)`). Somar os baldes num número só é o
 * que `impactoPorPeriodicidade` se recusa a fazer — a parcela é mensal e a base
 * de compra é do ato da compra —, e uma tela que somasse aqui publicaria um
 * total que nenhuma outra do produto reconhece.
 */
/**
 * O prefixo de cada leitura — **o sinal, e não a palavra**.
 *
 * O neutro não leva sinal: `R$ 0,00` já é a notícia inteira, e um `+` ou um `−`
 * ali afirmaria uma direção que não houve.
 */
const SINAL_DA_LEITURA: Record<LeituraDoValor, string> = {
  GANHO: "+",
  PERDA: "−",
  NEUTRO: "",
};

export function numerosDaLinha(
  numeros: CandidatosDoPar["candidatos"][number]["numeros"],
): NumerosDaLinha | null {
  if (!numeros) return null;

  const valores = numeros.impacto.baldes
    .filter((b) => b.valor !== 0)
    .sort(
      (a, b) =>
        a.periodicidade.localeCompare(b.periodicidade) ||
        /* Custo antes de receita, a ordem dos quadros do Monitor. */
        (a.natureza ?? "").localeCompare(b.natureza ?? ""),
    )
    .map((b) => ({
      /*
        O sinal no lugar da palavra — `+` e `−`, e não "Ganho" e "Perda".

        Houve aqui a escolha inversa, pela ideia de que o símbolo exigia uma
        tradução antes do relance. Exige o contrário: `−R$ 1.000,00` em vermelho
        já é perda para quem lê, e a palavra ao lado repetia em quatro letras o
        que o sinal e a cor diziam juntos — três marcas para uma informação só,
        numa coluna que precisa caber no canto da linha.

        O valor sai com o sinal e em módulo: o prefixo é quem carrega a direção,
        de modo que nenhuma linha escreva `−` duas vezes.

        A régua é o sinal do líquido, e ela é a mesma em todas as linhas — no
        Monitor, onde uma periodicidade traz dois baldes, os dois se leem pelo
        mesmo sinal.
      */
      texto: `${SINAL_DA_LEITURA[leituraDoValor(b.valor)]}${formatBrl(
        Math.abs(b.valor),
      )}${periodicitySuffix(b.periodicidade)}`,
      bruto: b.valor,
      leitura: leituraDoValor(b.valor),
    }));

  /*
    Nenhum balde valorado — e a linha diz isso com um número, não com o vazio.

    Sem periodicidade nenhuma no bolso, o zero também não ganha sufixo: escrever
    `R$ 0,00/mês` afirmaria que o que não mudou era mensal, e não há balde que
    sustente a frase. Quando algum balde tem valor, o zero dos outros continua
    filtrado: ali o que responde é o movimento, e `R$ 0,00/ano` embaixo de
    `+R$ 7.238,85/mês` só rouba a linha de quem tem notícia.
  */
  if (valores.length === 0) {
    valores.push({ texto: formatBrl(0), bruto: 0, leitura: "NEUTRO" });
  }

  const alteracoes = `${formatNumber(numeros.alteracoes, 0)} ${
    numeros.alteracoes === 1 ? "alteração" : "alterações"
  }`;

  return { valores, alteracoes };
}
