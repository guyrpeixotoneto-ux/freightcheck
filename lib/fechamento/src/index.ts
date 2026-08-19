/**
 * `@workspace/fechamento` — o fechamento de remuneração sem planilha.
 *
 * O pacote lê as cinco fontes que a Ambev entrega a cada quinzena, reconstrói
 * a conta que a transportadora hoje monta à mão numa pasta de Excel de 44 abas,
 * e diz — verba a verba, com a memória de cálculo de cada parcela — se o que
 * será pago é o que é devido.
 *
 * Ele não fala com banco nem com HTTP de propósito: as cinco fontes são
 * arquivos e a conta é aritmética sobre eles. Manter o núcleo assim é o que
 * permite conferir a apuração inteira num teste, contra um fechamento real, sem
 * subir nada.
 *
 * ```ts
 * const apuracao = apurar(competencia(2026, 7, 2), {
 *   operacao: lerOperacao(bytesDo2Art).linhas,
 *   ctes: lerCtes(bytesDo0308_15).linhas,
 *   requisicoes: lerRequisicoes(bytesDo0308_12_09).linhas,
 *   disponibilidade: lerDisponibilidade(bytesDo0308_18).linhas,
 *   conciliacao: lerConciliacao(bytesDo0302_59_02),
 * });
 * ```
 */

export * from "./dominio";
export * from "./periodo";
export * from "./verbas";
export * from "./aliquota";
export * from "./apuracao";
export * from "./diario";
export { lerOperacao, type DetalheDaViagem, type Viagem } from "./leitores/operacao";
export { lerCtes, type LinhaDeCte } from "./leitores/cte";
export { lerRequisicoes, STATUS_QUE_PAGA, type Requisicao } from "./leitores/requisicoes";
export { lerDisponibilidade, type DiaDeDisponibilidade } from "./leitores/disponibilidade";
export {
  lerConciliacao,
  valorDe,
  type Conciliacao,
  type ItemDaConciliacao,
  type ColunaDaConciliacao,
} from "./leitores/conciliacao";
export { CabecalhoNaoEncontrado, nomesDasAbas } from "./leitores/planilha";
