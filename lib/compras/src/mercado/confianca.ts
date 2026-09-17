/**
 * A CONFIANÇA — uma oferta não vale sete.
 *
 * O pedido é explícito e é a coisa certa: *uma única oferta encontrada na
 * internet não deve gerar a mesma confiança de sete ofertas comparáveis.* Este
 * arquivo é onde isso vira número, e ele é determinístico — a confiança é
 * **contada** a partir de sete fatores observáveis, não opinada pelo modelo.
 *
 * O resultado é uma nota de três degraus e, junto dela, a lista dos fatores com
 * o que cada um pesou. A lista importa tanto quanto a nota: "confiança média"
 * sozinho não diz o que fazer, e "confiança média — só duas ofertas, e o frete
 * de uma delas é desconhecido" diz.
 */

import type { Frescor } from "./frescor";

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

export const ROTULO_DA_CONFIANCA: Record<Confianca, string> = {
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
};

/** Um fator, com o que ele observou e quanto tirou. */
export interface FatorDeConfianca {
  fator: string;
  observado: string;
  /** Quanto este fator subtraiu da nota. Zero quando ele não pesou contra. */
  penalidade: number;
}

export interface AvaliacaoDeConfianca {
  confianca: Confianca;
  /** De 0 a 100. É a soma das penalidades subtraída de 100. */
  pontos: number;
  fatores: FatorDeConfianca[];
}

export interface SinaisDaPesquisa {
  /** Ofertas que entraram na conta — comparáveis e com custo. */
  comparaveis: number;
  /** Quantas delas são EXATO. */
  exatas: number;
  /** Quantas vieram de domínios distintos. Sete ofertas de um site são um site. */
  fontesDistintas: number;
  /** Quantas têm o frete conhecido. */
  comFrete: number;
  /** Quantas declaram disponibilidade. */
  comDisponibilidade: number;
  /** O coeficiente de variação dos custos. */
  dispersao: number;
  /** A pior idade do conjunto. */
  frescor: Frescor | null;
  /** Quantas páginas tentaram injetar instrução. Fonte duvidosa é fonte fraca. */
  fontesQueTentaramInstruir: number;
}

/**
 * A nota, e o porquê de cada desconto.
 *
 * Os pesos são escolha declarada, não medição: eles dizem o que esta operação
 * considera grave. Volume e aderência pesam mais que frete e disponibilidade
 * porque um conjunto pequeno ou fora da especificação compromete a recomendação
 * inteira, enquanto frete desconhecido compromete a precisão dela.
 *
 * `ALTA` exige 80, `MEDIA` exige 55. Uma oferta só não chega a 55 nem no melhor
 * caso — é o piso que o pedido descreve, escrito como aritmética.
 */
export function avaliarConfianca(
  sinais: SinaisDaPesquisa,
): AvaliacaoDeConfianca {
  const fatores: FatorDeConfianca[] = [];
  const pesar = (fator: string, observado: string, penalidade: number) =>
    fatores.push({ fator, observado, penalidade });

  // ---- volume -------------------------------------------------------------
  const volume =
    sinais.comparaveis === 0
      ? 60
      : sinais.comparaveis === 1
        ? 45
        : sinais.comparaveis === 2
          ? 25
          : sinais.comparaveis < 5
            ? 12
            : 0;
  pesar(
    "Volume de ofertas",
    sinais.comparaveis === 0
      ? "nenhuma oferta comparável"
      : `${sinais.comparaveis} oferta(s) comparável(is)`,
    volume,
  );

  // ---- aderência à especificação -----------------------------------------
  const aderencia =
    sinais.comparaveis === 0
      ? 0
      : sinais.exatas === 0
        ? 20
        : sinais.exatas / sinais.comparaveis < 0.5
          ? 10
          : 0;
  pesar(
    "Aderência à especificação",
    `${sinais.exatas} de ${sinais.comparaveis} com match exato`,
    aderencia,
  );

  // ---- pluralidade de fontes ---------------------------------------------
  const fontes =
    sinais.fontesDistintas <= 1 ? 15 : sinais.fontesDistintas === 2 ? 7 : 0;
  pesar(
    "Pluralidade de fontes",
    `${sinais.fontesDistintas} domínio(s) distinto(s)`,
    fontes,
  );

  // ---- frete ---------------------------------------------------------------
  const semFrete = Math.max(0, sinais.comparaveis - sinais.comFrete);
  const frete = sinais.comparaveis === 0 ? 0 : Math.min(12, semFrete * 4);
  pesar(
    "Frete conhecido",
    `${sinais.comFrete} de ${sinais.comparaveis} com frete`,
    frete,
  );

  // ---- disponibilidade -----------------------------------------------------
  const semDisponibilidade = Math.max(
    0,
    sinais.comparaveis - sinais.comDisponibilidade,
  );
  const disponibilidade =
    sinais.comparaveis === 0 ? 0 : Math.min(8, semDisponibilidade * 3);
  pesar(
    "Disponibilidade declarada",
    `${sinais.comDisponibilidade} de ${sinais.comparaveis} declaram`,
    disponibilidade,
  );

  // ---- dispersão -----------------------------------------------------------
  const dispersao =
    sinais.dispersao > 0.45 ? 18 : sinais.dispersao > 0.25 ? 9 : 0;
  pesar(
    "Dispersão dos preços",
    `coeficiente de variação de ${(sinais.dispersao * 100).toFixed(0)}%`,
    dispersao,
  );

  // ---- frescor -------------------------------------------------------------
  const idade =
    sinais.frescor === "VELHA"
      ? 25
      : sinais.frescor === "ENVELHECIDA"
        ? 10
        : sinais.frescor === "RECENTE"
          ? 3
          : 0;
  pesar("Atualidade", sinais.frescor ?? "sem captura", idade);

  // ---- qualidade da fonte --------------------------------------------------
  const duvidosa = Math.min(20, sinais.fontesQueTentaramInstruir * 10);
  pesar(
    "Idoneidade das fontes",
    sinais.fontesQueTentaramInstruir === 0
      ? "nenhuma página tentou dar instruções ao agente"
      : `${sinais.fontesQueTentaramInstruir} página(s) tentaram dar instruções ao agente`,
    duvidosa,
  );

  const pontos = Math.max(
    0,
    100 - fatores.reduce((soma, f) => soma + f.penalidade, 0),
  );

  return {
    pontos,
    confianca: pontos >= 80 ? "ALTA" : pontos >= 55 ? "MEDIA" : "BAIXA",
    fatores,
  };
}
