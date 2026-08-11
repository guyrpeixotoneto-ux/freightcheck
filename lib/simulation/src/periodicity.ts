/**
 * A conversão de periodicidade, isolada de tudo.
 *
 * Este módulo não conhece banco, snapshot nem atributo. Recebe uma quantia com
 * o significado que a torna interpretável e devolve ou uma conversão declarada,
 * ou uma recusa com motivo. Não existe caminho do meio: nenhuma função aqui
 * devolve um número sem dizer por qual fator ele passou e o que esse fator
 * assume.
 *
 * A razão de o domínio ser isolado é que ele é o único ponto do produto onde um
 * número é *produzido* em vez de reportado. Alterações e Comparar escapam da
 * conversão não somando — mostram MENSAL e ANUAL lado a lado. A Simulação não
 * tem essa saída, e é aqui que uma premissa não dita viraria um número errado.
 */

export type Periodicity = "MENSAL" | "ANUAL" | "PONTUAL";

/**
 * Doze meses no ano. Fica nomeado porque não é uma constante de conveniência:
 * é a premissa inteira de `MENSAL ↔ ANUAL`. Um custo mensal só incide doze
 * vezes num ano se incidir o ano inteiro — o FINAME, que tem prazo, não incide.
 * Por isso toda conversão que usa este número sai marcada como projeção.
 */
export const MESES_NO_ANO = 12;

/**
 * A natureza do resultado, que acompanha o número para sempre.
 *
 * - `EXATA` — o fator é 1. Nada foi assumido.
 * - `PROJECAO_LINEAR` — o valor foi esticado ou dividido no tempo, assumindo
 *   incidência constante. É premissa, e a tela precisa dizer isso.
 * - `PONTUAL_INTEGRAL` — um evento único entrou pelo valor cheio, sem rateio.
 */
export type ResultNature = "EXATA" | "PROJECAO_LINEAR" | "PONTUAL_INTEGRAL";

export type RefusalCode =
  /** Recorrente ⇄ pontual: rateio ou recorrência que ninguém declarou. */
  | "PONTUAL_NAO_CONVERTE"
  /** Alíquota não é dinheiro acumulado no tempo. */
  | "TAXA_NAO_TEM_PERIODICIDADE"
  /** Monetário sem periodicidade confirmada. Fora do total, nomeado. */
  | "PERIODICIDADE_NAO_CONFIRMADA"
  /** Pontual sem data: não há como saber se cai no horizonte. */
  | "PONTUAL_SEM_DATA"
  /** Horizonte que não fecha em meses inteiros. */
  | "HORIZONTE_NAO_FECHA_EM_MESES"
  /** Trecho do horizonte sem semântica vigente que o cubra. */
  | "SEMANTICA_AUSENTE_NO_TRECHO";

export interface Allowed {
  allowed: true;
  factor: number;
  nature: ResultNature;
  explanation: string;
}

export interface Refused {
  allowed: false;
  code: RefusalCode;
  explanation: string;
}

export type Conversion = Allowed | Refused;

const NOME: Record<Periodicity, string> = {
  MENSAL: "mensal",
  ANUAL: "anual",
  PONTUAL: "pontual",
};

/**
 * A tabela inteira, 3×3.
 *
 * Três células são recusa explícita, e é o ponto mais importante do módulo.
 * Dividir um valor de aquisição por doze não produz um custo mensal: produz uma
 * depreciação com uma vida útil que ninguém informou. Multiplicar um custo
 * mensal para virar "o valor pontual" é ainda menos defensável.
 *
 *            para MENSAL          para ANUAL           para PONTUAL
 *  MENSAL    ×1        exata      ×12   projeção       recusa
 *  ANUAL     ÷12       projeção   ×1    exata          recusa
 *  PONTUAL   recusa               recusa               ×1  exata
 */
export function convertPeriodicity(
  from: Periodicity,
  to: Periodicity,
): Conversion {
  if (from === to) {
    return {
      allowed: true,
      factor: 1,
      nature: "EXATA",
      explanation: `Mesma periodicidade (${NOME[from]}); nada foi convertido.`,
    };
  }

  if (from === "PONTUAL" || to === "PONTUAL") {
    return {
      allowed: false,
      code: "PONTUAL_NAO_CONVERTE",
      explanation:
        `Um valor pontual não vira ${NOME[to === "PONTUAL" ? from : to]} e ` +
        `vice-versa: converter inventaria um rateio, ou uma recorrência, que a ` +
        `fonte nunca declarou. Ele entra pelo valor cheio ou não entra.`,
    };
  }

  const factor = from === "MENSAL" ? MESES_NO_ANO : 1 / MESES_NO_ANO;
  return {
    allowed: true,
    factor,
    nature: "PROJECAO_LINEAR",
    explanation:
      `Projeção linear de ${NOME[from]} para ${NOME[to]} (×${formatFactor(factor)}), ` +
      `assumindo incidência constante ao longo dos doze meses. É premissa, não ` +
      `custo apurado do período.`,
  };
}

export function formatFactor(factor: number): string {
  return Number.isInteger(factor)
    ? String(factor)
    : factor.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
