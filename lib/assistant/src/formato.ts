/**
 * Como um número deste produto se escreve — e o que nunca se omite ao lado dele.
 *
 * Duas regras, e as duas são recusas do FreightCheck, não preferências de
 * formatação. Valor em dinheiro **nunca** aparece sem a periodicidade: R$ 100
 * por mês e R$ 100 por ano não são o mesmo dinheiro, e escrever "R$ 100" deixa
 * quem lê escolher qual dos dois entendeu. E a contagem de alterações **nunca**
 * aparece sem a fatia que tem preço: "267 alterações" ao lado de "+R$ 28 mil"
 * sugere que os dois números falam do mesmo conjunto, quando o segundo cobre 19
 * das 267.
 */

import type { ImpactSummary } from "@workspace/comparison";
import { estadoDaApuracao } from "@workspace/comparison/contrato-de-impacto";

export const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

export const INTEIRO = new Intl.NumberFormat("pt-BR");

/** "/mês", "/ano" — nunca omitido ao lado de um valor. */
export function sufixo(periodicidade: string): string {
  const mapa: Record<string, string> = {
    MENSAL: "/mês",
    ANUAL: "/ano",
    PONTUAL: " (valor único)",
  };
  return mapa[periodicidade] ?? ` (${periodicidade.toLowerCase()})`;
}

export function dinheiro(valor: number, periodicidade: string): string {
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${sinal}${REAIS.format(Math.abs(valor))}${sufixo(periodicidade)}`;
}

/**
 * O impacto como o produto o exibe: uma linha por periodicidade.
 *
 * `null` quando não há nenhuma apurada — e quem chama é obrigado a tratar esse
 * `null`, porque é ele que separa "não mudou nada em dinheiro" de "mudou e não
 * sabemos quanto".
 */
export function impactoEmTexto(impacto: ImpactSummary): string | null {
  const linhas = Object.entries(impacto.byPeriodicity)
    .filter(([, valor]) => valor !== 0)
    .map(([periodicidade, valor]) => dinheiro(valor, periodicidade));
  return linhas.length > 0 ? linhas.join(" · ") : null;
}

/**
 * O impacto como **frase**, com o estado da apuração embutido.
 *
 * ---------------------------------------------------------------------------
 * O que o `null` de `impactoEmTexto` não distinguia
 * ---------------------------------------------------------------------------
 * Ele voltava `null` em dois casos opostos, e as ferramentas escreviam a mesma
 * coisa nos dois — "não apurável com este export":
 *
 * - **nada foi apurado**: as alterações existem e nenhuma tem preço. Aí a frase
 *   está certa;
 * - **tudo foi apurado e deu zero**: a conta aconteceu. Chamar isso de "não
 *   apurável" é o assistente negando um trabalho que o produto fez.
 *
 * E havia um terceiro caso que nenhuma das duas cobria: a apuração **parcial**,
 * em que o valor é verdadeiro e incompleto. O assistente publicava o número sem
 * dizer que ele cobre 70% das alterações — que é a afirmação que faz alguém
 * decidir errado.
 *
 * O estado vem do contrato (`estadoDaApuracao`), o mesmo que a interface lê.
 * Nenhuma redação nova de regra mora aqui: só a redação das palavras.
 */
export function impactoDescrito(
  impacto: ImpactSummary,
  /** As alterações do recorte — `totals.changes`, `summary.changes`. */
  alteracoes: number,
): { valor: string; detalhe: string } {
  const texto = impactoEmTexto(impacto);
  const estado = estadoDaApuracao(alteracoes, impacto);

  switch (estado) {
    case "SEM_ALTERACAO":
      return {
        valor: "sem alteração",
        detalhe: "nenhuma alteração neste recorte — não há impacto a apurar",
      };
    case "NAO_CALCULAVEL":
      return {
        valor: "ainda não calculado",
        detalhe:
          `${INTEIRO.format(impacto.notCalculable)} alterações sem preço apurado — ` +
          "o resultado não é zero, é desconhecido",
      };
    case "PARCIALMENTE_CALCULADO":
      return {
        valor: texto ?? "R$ 0,00",
        detalhe:
          `parcial: ${INTEIRO.format(impacto.calculatedChanges)} de ${INTEIRO.format(alteracoes)} ` +
          `alterações calculadas · ${INTEIRO.format(impacto.notCalculable)} ainda sem preço`,
      };
    case "CALCULADO":
      return texto === null
        ? {
            valor: "R$ 0,00",
            detalhe: "todas as alterações foram apuradas e não mudaram a remuneração",
          }
        : {
            valor: texto,
            detalhe: "por periodicidade, nunca somado entre elas",
          };
  }
}

/** Os números crus de um impacto, para a validação conferir. */
export function numerosDoImpacto(impacto: ImpactSummary): number[] {
  return Object.values(impacto.byPeriodicity).filter((v) => v !== 0);
}

/**
 * O resumo de impacto **inteiro** — e não só a soma que entra no total.
 *
 * Existem os dois porque servem a duas perguntas. `numerosDoImpacto` responde
 * "o que este recorte custou", que é o que a redação determinística escreve, e
 * por isso ele traz só `byPeriodicity`. Esta responde "o que a ferramenta
 * mostrou", que é a pergunta da trava — e a ferramenta mostra o resumo todo:
 * o que ficou de fora da soma por já estar contado nas parcelas, quantas
 * alterações ficaram sem preço, quantas foram apuradas.
 *
 * A distinção não é acadêmica. `excludedByPeriodicity` é justamente o valor que
 * o modelo precisa poder dizer para explicar por que a soma não bate com a
 * lista — "R$ 11.425,04 não entram porque já estão nas parcelas". Mostrado e
 * não autorizado, ele produz o pior resultado dos três possíveis: o modelo lê,
 * conclui a partir dele, escreve a frase certa, e a trava a poda.
 *
 * Alargar `numerosDoImpacto` faria o mesmo serviço em menos linhas e mexeria no
 * lastro do caminho determinístico, que é a linha de base contra a qual o
 * agente está sendo medido. Uma medição cujo "antes" se move junto com o
 * "depois" não mede nada.
 */
export function numerosDoResumoDeImpacto(impacto: ImpactSummary): number[] {
  return [
    ...Object.values(impacto.byPeriodicity),
    ...Object.values(impacto.brutoByPeriodicity),
    /*
      O rastro **inteiro**, e não só o dinheiro dele.

      Os degraus vão para o conteúdo com todos os seus campos, e `mudancasRemovidas`
      é um deles: um inteiro, ao lado dos valores. Autorizar só as periodicidades
      deixava esse número visível ao modelo e fora do lastro — e a trava podava a
      frase em que ele dissesse "onze alterações saíram por dupla contagem", que é
      um resultado correto punido como se fosse invenção.

      A regra é a do arquivo: ou sai do conteúdo, ou entra no lastro. Como o rastro
      existe justamente para ser lido, ele entra inteiro.
    */
    ...impacto.rastro.degraus.flatMap((d) => [
      ...Object.values(d.removidoByPeriodicity),
      ...Object.values(d.subtotalByPeriodicity),
      d.mudancasRemovidas,
    ]),
    ...Object.values(impacto.rastro.brutoByPeriodicity),
    ...Object.values(impacto.rastro.oficialByPeriodicity),
    impacto.excludedChanges,
    impacto.notCalculable,
    impacto.calculatedChanges,
    // As apuradas em R$ 0,00 entram pela mesma regra: elas aparecem no conteúdo
    // (é o que separa "deu zero" de "ninguém apurou"), e o que aparece precisa
    // estar no lastro, ou a trava poda a frase certa.
    impacto.zeroChanges,
  ].filter((v) => typeof v === "number");
}

export function cobertura(calculadas: number, total: number): string {
  if (total === 0) return "sem alterações neste recorte";
  const pct = Math.round((calculadas / total) * 100);
  return `${pct}% do que mudou tem impacto calculável (${INTEIRO.format(calculadas)} de ${INTEIRO.format(total)})`;
}

/** Um trecho legível, sem cortar no meio de uma palavra. */
export function trecho(texto: string, limite = 600): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, espaco > 0 ? espaco : limite)}…`;
}

/**
 * O mesmo corte, com as quebras de linha do original preservadas.
 *
 * `trecho` colapsa todo espaço em branco, e é o que se quer para um parágrafo
 * de artigo. Não é o que se quer para um documento: uma regra costuma ser uma
 * lista de cláusulas, e achatá-la numa linha só entrega ao leitor um bloco
 * corrido em que nada se distingue — a mesma perda que a extração já cobra da
 * diagramação, cobrada duas vezes.
 */
export function trechoComLinhas(texto: string, limite = 1200): string {
  const limpo = texto
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (limpo.length <= limite) return limpo;

  const corte = limpo.slice(0, limite);
  const fronteira = Math.max(corte.lastIndexOf(" "), corte.lastIndexOf("\n"));
  return `${corte.slice(0, fronteira > 0 ? fronteira : limite)}…`;
}

/** "2026-08-01" → "agosto/2026" */
export function rotuloDoPeriodo(data: string): string {
  const [ano, mes] = data.split("-");
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const nome = nomes[Number(mes) - 1];
  return nome ? `${nome}/${ano}` : data;
}
