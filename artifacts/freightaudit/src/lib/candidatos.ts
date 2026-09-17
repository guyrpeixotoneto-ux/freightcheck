import { periodicitySuffix } from "@workspace/comparison/labels";
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
 * Um balde de dinheiro de um par — a periodicidade e o líquido dela.
 *
 * Teve um terceiro campo, `natureza`, enquanto o Monitor Custo Fixo separava
 * custo de receita e uma periodicidade chegava aqui em duas linhas. Não chega
 * mais: as rubricas falam o idioma de quem recebe, positivo é ganho e negativo
 * é perda, e a linha do menu volta a ser uma por periodicidade — `+R$
 * 7.238,85/mês`, o sinal e a cor dizendo a direção. O espelho do tipo que a
 * rota publica (`api-server/src/lib/candidatas-do-par.ts`).
 */
export interface BaldeDoImpacto {
  periodicidade: string;
  valor: number;
}

/**
 * O movimento de um percentual declarado no par — o espelho de
 * `MovimentoDePercentual` (`api-server/src/lib/candidatas-do-par.ts`).
 *
 * Pontos percentuais, nunca dinheiro: o `maior` é o maior movimento do tributo,
 * com sinal, e não a soma dos movimentos — somar alíquota é o que o servidor se
 * recusa a fazer, e repetir a recusa aqui é o que impede a tela de desfazê-la.
 */
export interface MovimentoDePercentual {
  /** Como a linha chama este percentual — "ICMS", "PIS/COFINS". */
  rotulo: string;
  alteradas: number;
  /** `null` quando nenhuma das alteradas trouxe medida do motor. */
  maior: number | null;
  /** Subiu num ativo e caiu noutro: o sinal de `maior` não descreve o conjunto. */
  ambasDirecoes: boolean;
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
      /**
       * Por que este recorte **não publica dinheiro** — e não "publicou zero".
       *
       * Só o QLP manda: as colunas do quadro chegam sem semântica confirmada, e
       * somar o que a curadoria não confirmou seria adivinhação. A frase é a
       * mesma que aquela tela publica no lugar do impacto.
       *
       * Ausente, `baldes` vazio quer dizer o que sempre quis: calculei, e deu
       * zero.
       */
      semImpacto?: string;
      /**
       * O movimento dos percentuais declarados — o espelho de
       * `MovimentoDePercentual` (`api-server/src/lib/candidatas-do-par.ts`).
       *
       * Opcional, e a distinção importa: **ausente** é o recorte que não audita
       * percentual (as outras quatro rubricas, cuja linha segue como era),
       * **vazio** é o que audita e não viu nenhum se mover — que numa tela de
       * imposto é notícia, e por isso sai escrito.
       */
      percentuais?: MovimentoDePercentual[];
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
   * Uma linha de dinheiro por periodicidade, já escrita.
   *
   * Quando o par não move dinheiro nenhum, a lista é `R$ 0,00`: a coluna zerada
   * é a resposta, e a coluna em branco era a ausência dela. Ver
   * {@link numerosDaLinha}.
   *
   * Ela é vazia num caso só, e é o oposto daquele: quando o recorte **não mede**
   * dinheiro (`semImpacto`). Ali a linha mostra a contagem sozinha, porque um
   * `R$ 0,00` afirmaria uma conta que ninguém fez.
   */
  valores: { texto: string; bruto: number; leitura: LeituraDoValor }[];
  /** "457 alterações", "1 alteração", "0 alterações". */
  alteracoes: string;
  /**
   * O movimento das alíquotas, já escrito — uma linha por tributo que andou.
   *
   * Vazia nos recortes que não auditam percentual, que é como as outras quatro
   * rubricas seguem sem linha nova. Nos que auditam, ela nunca fica vazia:
   * quando nenhuma alíquota se moveu, a frase é "sem movimento de alíquota" —
   * a mesma régua do `R$ 0,00` logo acima, onde a conta que deu zero se escreve
   * em vez de deixar a casa em branco.
   */
  percentuais: string[];
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
 * Um recorte que **não mede** dinheiro (`semImpacto`, hoje só o QLP) é o avesso
 * disso, e escreve só a contagem. O `R$ 0,00` daqui de baixo é uma conta que deu
 * zero; escrevê-lo onde conta nenhuma foi feita seria a tela afirmando que o
 * dinheiro não se moveu numa comparação que nunca olhou para ele — a mesma
 * mentira por omissão, com o sinal trocado.
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
    .sort((a, b) => a.periodicidade.localeCompare(b.periodicidade))
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

        A régua é o sinal do líquido, e ela é a mesma em todas as linhas e em
        todas as telas: positivo é ganho e sai em verde, negativo é perda e sai
        em vermelho.
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
  if (valores.length === 0 && !numeros.semImpacto) {
    valores.push({ texto: formatBrl(0), bruto: 0, leitura: "NEUTRO" });
  }

  const alteracoes = `${formatNumber(numeros.alteracoes, 0)} ${
    numeros.alteracoes === 1 ? "alteração" : "alterações"
  }`;

  return {
    valores,
    alteracoes,
    percentuais: percentuaisDaLinha(numeros.percentuais),
  };
}

/** `2` vira `2,000` — três casas, as mesmas da alíquota na tela de impostos. */
function pontos(valor: number): string {
  return Math.abs(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/**
 * O movimento das alíquotas virando as linhas de texto do menu.
 *
 * Quatro frases, e cada uma responde a um estado diferente do par:
 *
 * - **"sem movimento de alíquota"** — o recorte olhou e nenhuma andou. É o caso
 *   mais comum neste acervo, e é informação: com o montante de ICMS vazio, uma
 *   alíquota parada é a única coisa que sustenta o imposto declarado do mês.
 * - **"ICMS +2,000 p.p."** — uma alíquota só se moveu, e o número é ela.
 * - **"ICMS até +2,000 p.p. · 3 alíquotas"** — várias se moveram para o mesmo
 *   lado. "Até" porque o que sai é o maior, e não uma soma: setenta carretas
 *   que sobem 2 p.p. cada não somam 140 p.p.
 * - **"ICMS até 2,000 p.p. nos dois sentidos · 3 alíquotas"** — uma subiu e
 *   outra caiu. Aqui o sinal some de propósito: `+` afirmaria que a frota andou
 *   para cima quando metade dela andou para baixo.
 *
 * E a quinta, que é a recusa: alterada sem medida vira "movimento não medido",
 * nunca `0,000 p.p.` — zero é uma medição, e o motor não a fez.
 *
 * Nada aqui leva cor. Verde e vermelho são do dinheiro, onde o sinal diz ganho
 * e perda; numa alíquota ele não diz: ICMS que sobe pode ser crédito maior ou
 * custo maior conforme o regime do ativo — que é justamente o que o acervo
 * ainda não tem (ver `docs/ACHADO-IMPOSTOS.md`). Pintar o ponto percentual de
 * verde seria a tela respondendo uma pergunta que ela não pode responder.
 */
function percentuaisDaLinha(
  percentuais: MovimentoDePercentual[] | undefined,
): string[] {
  if (!percentuais) return [];
  if (percentuais.length === 0) return ["sem movimento de alíquota"];

  return percentuais.map((p) => {
    const quantas = `${formatNumber(p.alteradas, 0)} ${
      p.alteradas === 1 ? "alíquota" : "alíquotas"
    }`;
    if (p.maior === null)
      return `${p.rotulo} · ${quantas}, movimento não medido`;

    const sinal = p.ambasDirecoes ? "" : p.maior < 0 ? "−" : "+";
    const sentido = p.ambasDirecoes ? " nos dois sentidos" : "";
    const movimento = `${sinal}${pontos(p.maior)} p.p.`;
    return p.alteradas === 1
      ? `${p.rotulo} ${movimento}`
      : `${p.rotulo} até ${movimento}${sentido} · ${quantas}`;
  });
}
