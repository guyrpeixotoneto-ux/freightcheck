import { centavos, type Canal } from "./dominio";

/**
 * O LADO DA TRANSPORTADORA — o `TOTAL GERAL SRTRANS` sem a planilha.
 *
 * O `RESUMO GERAL` fecha com três linhas que o produto não tinha: o que a
 * **unidade** calcula (`TOTAL GERAL UNIDADE`), o que o **SRTrans** apresenta
 * (`TOTAL GERAL SRTRANS`) e a diferença entre os dois. A primeira o motor já
 * produzia; as outras duas não existiam, e a leitura que o produto tinha era
 * que o número da transportadora "só existe na planilha, em `Abertura!F45`".
 *
 * **Ele existe, é publicado por um relatório que o sistema já importa, e bate
 * ao centavo.** O `Total Remuneração` do **03.08.20** do canal Rota, na 1ª
 * quinzena de julho/2026, é R$ 1.084.580,45 — exatamente o que `Abertura!F45`
 * traz e o que `Resumo Geral!AI38` imprime. Não é aproximação nem coincidência
 * de arredondamento: é o mesmo número.
 *
 * ---------------------------------------------------------------------------
 * Por que o 03.08.20 é a fonte canônica, e a `Abertura` é a conferência
 * ---------------------------------------------------------------------------
 *
 * As duas produzem o mesmo total por caminhos diferentes, e a diferença entre
 * elas é de natureza, não de valor:
 *
 * - o **03.08.20 publica** o total. É um documento da Ambev que diz, numa
 *   linha, quanto será pago no canal. Nada é montado por nós;
 * - a **`Abertura` reconstrói** o total somando os documentos que a
 *   transportadora emitiu: notas fiscais de serviço (série 748), CT-es da
 *   quinzena (03.08.15) e os ajustes diários do 03.02.59.02.
 *
 * Um número publicado é melhor fonte do que um número remontado — o remontado
 * depende de a lista de documentos estar completa, e a publicada não. Por isso
 * a canônica é o 03.08.20 e a decomposição entra como **conferência**: ela não
 * produz o total, ela o explica.
 *
 * **A decomposição foi verificada, e o resíduo tem nome.** Na 2ª quinzena ela
 * fecha ao centavo:
 *
 * ```
 * 03.08.15 (soma de Valor CT-e)      1.346.131,65
 * + notas fiscais da série 748          26.839,98
 * + NF-e sem CT-e na quinzena              109,52   ┐ 03.02.59.02
 * − desconto de saldo complementar      17.398,54   ┘
 * ────────────────────────────────────────────────
 * = 1.355.682,61  = Abertura!N45 = Resumo Geral!AJ38
 * ```
 *
 * Na 1ª quinzena a mesma conta sobra **R$ 8,07** — um CT-e de VBZ 05 emitido no
 * dia 1º que a `Abertura` não conta, porque o primeiro dia da quinzena também
 * recebe documento do fechamento anterior. A sobra é medida e dita, nunca
 * absorvida.
 *
 * **O que falta para a conferência rodar sozinha:** a série 748. Conferi que
 * ela não está embutida no 03.08.15 — nenhum dos treze valores de NF que a
 * `Abertura` lista aparece em qualquer uma das 57.012 linhas dele. São
 * documentos de outra natureza: NF de serviço, emitida dentro do município, o
 * lado ISS do faturamento, enquanto o 03.08.15 traz o lado CT-e. Sem ela, o
 * total canônico continua existindo (vem do 03.08.20) e o que fica indisponível
 * é apenas a **decomposição** — ver {@link ONDE_INFORMAR_AS_NOTAS}.
 */

/** De onde uma parcela da conferência sai — ou por que ela não sai de lugar nenhum. */
export type FonteDaParte =
  /** Um relatório que o sistema importa hoje. */
  | { tipo: "RELATORIO"; relatorio: string; regra: string }
  /**
   * Nenhum relatório importado traz esta parcela.
   *
   * `ondeInformar` é obrigatório aqui, e é a diferença entre registrar uma
   * lacuna e apenas reclamar dela.
   */
  | { tipo: "SEM_FONTE"; porque: string; ondeInformar: string };

/** Uma parcela da reconstrução do faturado — a conferência, não a fonte. */
export interface ParteDoFaturado {
  chave: string;
  rotulo: string;
  /** A célula da planilha que publica esta parcela — para conferir no arquivo. */
  celulaDaPlanilha: string;
  fonte: FonteDaParte;
  /** `null` quando a fonte não respondeu. Nunca zero por ausência. */
  valor: number | null;
}

/**
 * O `TOTAL GERAL SRTRANS` de uma quinzena.
 *
 * `total` é o número canônico e sai do 03.08.20. `partes` e `somaDasPartes` são
 * a conferência — a reconstrução pelos documentos emitidos —, e `residuo` é a
 * distância entre as duas leituras. Ele existir separado do total é o que
 * impede a conferência de virar fonte: se a decomposição estiver incompleta, o
 * resíduo cresce e o total não se move.
 */
export interface FaturadoDaTransportadora {
  canal: Canal;
  quinzena: 1 | 2;
  /** O `Total Remuneração` do 03.08.20 do canal. `null` sem o relatório. */
  total: number | null;
  partes: ParteDoFaturado[];
  /** A soma das parcelas da conferência. `null` se **qualquer** uma faltar. */
  somaDasPartes: number | null;
  /** `total − somaDasPartes`. `null` quando um dos dois não existe. */
  residuo: number | null;
  /** Os rótulos das parcelas sem fonte — o que falta para a conferência fechar. */
  faltamNaConferencia: string[];
}

/** O que cada relatório entrega para esta leitura. */
export interface EntradaDoFaturado {
  canal: Canal;
  quinzena: 1 | 2;
  /**
   * O `Total Remuneração` do 03.08.20 do canal — a **fonte canônica**.
   *
   * É o mesmo número que a aba `Verbas` já mostra no fecho dela, e o mesmo que
   * `somarDemonstrativo` grava. `null` quando o 03.08.20 não foi importado.
   */
  totalDoDemonstrativo: number | null;
  /** A soma de `Valor CT-e` do 03.08.15 no canal e na quinzena. */
  cte: number | null;
  /**
   * As notas fiscais de serviço da transportadora na quinzena (série 748).
   *
   * `null` é o estado de hoje: nenhum relatório importado traz esta série.
   */
  notasFiscais: number | null;
  /**
   * Os ajustes do 03.02.59.02: `NF-e sem CT-e na Quinzena` mais o
   * `Desconto Saldo Complementar Negativo`, com o sinal com que o relatório os
   * traz (o desconto é negativo).
   */
  ajustesDaConciliacao: number | null;
}

/** Onde a série 748 deve ser informada, enquanto não houver relatório dela. */
export const ONDE_INFORMAR_AS_NOTAS =
  "Na competência da quinzena, ao lado dos outros relatórios: um importador do " +
  "relatório 748 — que traria nota a nota e dispensaria digitação — ou, como " +
  "passo intermediário, um campo por quinzena para o total das notas fiscais " +
  "de serviço da transportadora, com o mesmo tratamento dos demais documentos " +
  "(quem informou, quando, arquivo de origem anexado). Nada disso é necessário " +
  "para o `TOTAL GERAL SRTRANS` existir — ele vem do 03.08.20 —, e sim para a " +
  "conferência que o decompõe fechar sozinha.";

/**
 * Monta o faturado da transportadora de uma quinzena.
 *
 * Função pura, como todo o resto da aritmética do pacote. Não vai ao banco, não
 * abre planilha e não completa parcela nenhuma.
 */
export function montarFaturado(entrada: EntradaDoFaturado): FaturadoDaTransportadora {
  const partes: ParteDoFaturado[] = [
    {
      chave: "cte_da_quinzena",
      rotulo: "CT-es da quinzena",
      celulaDaPlanilha: "Abertura!F29 / N29",
      fonte: {
        tipo: "RELATORIO",
        relatorio: "03.08.15",
        regra:
          "A soma de `Valor CT-e` das linhas do canal com data dentro da quinzena — o " +
          "mesmo universo que a apuração chama de emitido.",
      },
      valor: entrada.cte,
    },
    {
      chave: "notas_fiscais_748",
      rotulo: "Notas fiscais de serviço (série 748)",
      celulaDaPlanilha: "Abertura!F16 / N16",
      fonte: {
        tipo: "SEM_FONTE",
        porque:
          "Nenhum relatório importado traz a série 748, e ela não está embutida no " +
          "03.08.15: nenhum dos valores de NF que a `Abertura` lista aparece nas 57.012 " +
          "linhas dele. São documentos de outra natureza — NF de serviço, emitida dentro " +
          "do município, o lado ISS do faturamento, enquanto o 03.08.15 traz o lado CT-e.",
        ondeInformar: ONDE_INFORMAR_AS_NOTAS,
      },
      valor: entrada.notasFiscais,
    },
    {
      chave: "ajustes_da_conciliacao",
      rotulo: "Ajustes da conciliação",
      celulaDaPlanilha: "Abertura!F43 / N43",
      fonte: {
        tipo: "RELATORIO",
        relatorio: "03.02.59.02",
        regra:
          "`NF-e sem CT-e na Quinzena` mais o `Desconto Saldo Complementar Negativo` do " +
          "canal, com o sinal com que o relatório os traz. A própria aba `Abertura` nomeia " +
          "o relatório nos dois blocos.",
      },
      valor: entrada.ajustesDaConciliacao,
    },
  ];

  const faltamNaConferencia = partes.filter((p) => p.valor === null).map((p) => p.rotulo);
  /* Uma parcela ausente apaga a soma: duas de três não é a reconstrução. */
  const somaDasPartes =
    faltamNaConferencia.length > 0
      ? null
      : centavos(partes.reduce((soma, p) => soma + (p.valor ?? 0), 0));

  return {
    canal: entrada.canal,
    quinzena: entrada.quinzena,
    total: entrada.totalDoDemonstrativo,
    partes,
    somaDasPartes,
    residuo:
      entrada.totalDoDemonstrativo === null || somaDasPartes === null
        ? null
        : centavos(entrada.totalDoDemonstrativo - somaDasPartes),
    faltamNaConferencia,
  };
}

/**
 * `DIFERENÇA - TOTAL GERAL` — o que o SRTrans apresenta menos o que a unidade
 * calcula.
 *
 * O sinal é o da planilha (`AI40 = AI38 − AI36`): positivo quando a
 * transportadora apresenta mais do que a unidade calculou. `null` quando
 * qualquer um dos dois lados falta.
 */
export function diferencaDoTotalGeral(
  faturado: number | null,
  totalGeralDaUnidade: number | null,
): number | null {
  if (faturado === null || totalGeralDaUnidade === null) return null;
  return centavos(faturado - totalGeralDaUnidade);
}
