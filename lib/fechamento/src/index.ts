/**
 * `@workspace/fechamento` — o fechamento de remuneração sem planilha.
 *
 * O pacote lê as seis fontes que a Ambev entrega a cada quinzena, reconstrói
 * a conta que a transportadora hoje monta à mão numa pasta de Excel de 44 abas,
 * e diz — verba a verba, com a memória de cálculo de cada parcela — se o que
 * será pago é o que é devido.
 *
 * Ele não fala com banco nem com HTTP de propósito: as seis fontes são
 * arquivos e a conta é aritmética sobre eles. Manter o núcleo assim é o que
 * permite conferir a apuração inteira num teste, contra um fechamento real, sem
 * subir nada.
 *
 * ```ts
 * const apuracao = apurar(competencia(2026, 7, 2), {
 *   operacao: lerOperacao(bytesDo2Art).linhas,
 *   ctes: lerCtes(bytesDo0308_15).linhas,
 *   pagamento: lerPagamento(bytesDo0308_20),
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
export * from "./resumo";
export * from "./de-para";
export * from "./mapa-rota";
export { lerOperacao, type DetalheDaViagem, type Viagem } from "./leitores/operacao";
export {
  lerCadastro,
  CadastroNaoEncontrado,
  RotuloDoCadastroNaoEncontrado,
  type CadastroDaQuinzena,
} from "./leitores/cadastro";
export { lerCtes, type LinhaDeCte } from "./leitores/cte";
export {
  lerPagamento,
  ctrcPorVerba,
  vbzsCitadasNoRotulo,
  type Pagamento,
  type ItemDePagamento,
  type DescontoDoPagamento,
  type BlocoDoPagamento,
  type TipoDeDescontoDoPagamento,
} from "./leitores/pagamento";
export { lerRequisicoes, STATUS_QUE_PAGA, type Requisicao } from "./leitores/requisicoes";
export { lerDisponibilidade, type DiaDeDisponibilidade } from "./leitores/disponibilidade";
export {
  lerConciliacao,
  valorDe,
  ColunasDaConciliacaoIndefinidas,
  type Conciliacao,
  type ItemDaConciliacao,
  type ColunaDaConciliacao,
} from "./leitores/conciliacao";
export {
  CabecalhoNaoEncontrado,
  TabelaNaoDelimitada,
  nomesDasAbas,
} from "./leitores/planilha";
/*
  O formato do arquivo é decidido pelo conteúdo, e não pela extensão. Quem
  recebe upload precisa das duas primeiras para dizer a quem enviou o que
  chegou; `FORMATOS_DA_FONTE` (em `dominio`) diz o que cada fonte aceita.
*/
export { ehPlanilha, separadorDe, decodificarTexto } from "./leitores/formato";
