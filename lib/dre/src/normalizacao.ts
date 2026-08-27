/**
 * A camada explícita de normalização de periodicidade (§20).
 *
 * A DRE é apurada numa competência — hoje sempre mensal — e o export entrega
 * valores mensais, anuais e pontuais na mesma linha do mesmo ativo. Somá-los
 * sem conversão é o erro que este produto já cometeu uma vez:
 * `change_set.impacto_oficial_by_periodicity` existe porque um escalar único
 * apresentou "R$ −757.009,57" para um conjunto que era R$ −735 mil por **ano**
 * mais R$ −88 mil por **mês**.
 *
 * Nada aqui reimplementa a conversão. `convertPeriodicity` já é a autoridade em
 * `@workspace/simulation`, já devolve a natureza do resultado
 * (`EXATA | PROJECAO_LINEAR | PONTUAL_INTEGRAL`) e já **recusa** o que não se
 * converte. O que este arquivo acrescenta é o rastro: o valor original nunca
 * é perdido, e a transformação aplicada acompanha o número até a tela.
 */

import {
  convertPeriodicity,
  formatFactor,
  type Periodicity,
} from "@workspace/simulation";
import { DUAS_CASAS } from "@workspace/knowledge/formato";

/** A competência em que a DRE é apurada. Hoje só existe mensal. */
export type CompetenciaDaDRE = "MENSAL";

/**
 * A transformação que um valor sofreu para entrar na DRE.
 *
 * `null` em `fator` nunca acontece num valor que entrou: quando a conversão é
 * recusada, o componente não entra e vira uma linha `NAO_DISPONIVEL` com o
 * motivo. Guardar a transformação separada do número é o que permite a tela
 * responder "de onde veio este valor?" sem recalcular nada.
 */
export interface Transformacao {
  /** O valor como a fonte o entregou. Nunca sobrescrito. */
  valorOriginal: number;
  periodicidadeOriginal: Periodicity;
  competencia: CompetenciaDaDRE;
  fator: number;
  /** EXATA quando nada foi assumido. */
  natureza: "EXATA" | "PROJECAO_LINEAR" | "PONTUAL_INTEGRAL";
  /** A frase que a tela mostra ao abrir a linha. */
  explicacao: string;
  /** A aritmética, legível: "12.000,00 ÷ 12". Nulo quando o fator é 1. */
  formula: string | null;
}

export interface Normalizado {
  ok: true;
  valor: number;
  transformacao: Transformacao;
}

export interface Recusado {
  ok: false;
  /** O código da recusa, vindo de `convertPeriodicity`. */
  codigo: string;
  explicacao: string;
}

export type ResultadoDaNormalizacao = Normalizado | Recusado;

/**
 * Traz um valor para a competência da DRE.
 *
 * A recusa é um resultado legítimo e frequente: um valor `PONTUAL` — o preço da
 * nota de compra — **não** vira R$/mês, porque dividi-lo por doze produziria
 * uma depreciação com uma vida útil que ninguém informou. Ele fica fora da
 * demonstração de resultado e aparece na seção patrimonial, do mesmo jeito que
 * a gaveta `AQUISICAO` já faz na Composição.
 */
export function normalizarParaCompetencia(
  valor: number,
  periodicidade: string | null,
  competencia: CompetenciaDaDRE = "MENSAL",
): ResultadoDaNormalizacao {
  if (periodicidade !== "MENSAL" && periodicidade !== "ANUAL" && periodicidade !== "PONTUAL") {
    return {
      ok: false,
      codigo: "PERIODICIDADE_NAO_CONFIRMADA",
      explicacao:
        "O valor é monetário, mas ninguém confirmou se ele é mensal ou anual. " +
        "Sem isso não há em que competência colocá-lo.",
    };
  }

  const conversao = convertPeriodicity(periodicidade, competencia);
  if (!conversao.allowed) {
    return { ok: false, codigo: conversao.code, explicacao: conversao.explanation };
  }

  const convertido = Number((valor * conversao.factor).toFixed(2));
  return {
    ok: true,
    valor: convertido,
    transformacao: {
      valorOriginal: valor,
      periodicidadeOriginal: periodicidade,
      competencia,
      fator: conversao.factor,
      natureza: conversao.nature,
      explicacao: conversao.explanation,
      formula:
        conversao.factor === 1
          ? null
          : conversao.factor < 1
            ? `${formatarNumero(valor)} ÷ ${formatFactor(1 / conversao.factor)}`
            : `${formatarNumero(valor)} × ${formatFactor(conversao.factor)}`,
    },
  };
}

export function formatarNumero(valor: number): string {
  return DUAS_CASAS.format(valor);
}
