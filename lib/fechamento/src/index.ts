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
/*
  O lado da transportadora — as três últimas linhas do `RESUMO GERAL`. Fica ao
  lado do mapa e não dentro dele porque o mapa é o **devido**, e isto é o que a
  outra parte apresenta: duas fontes que precisam continuar independentes para
  a diferença entre elas valer alguma coisa.
*/
export * from "./faturado";
export * from "./inconsistencias";
/*
  A prova de equivalência contra a planilha. Vai no índice porque quem consome o
  motor precisa poder conferi-lo — e porque a alternativa, um script solto, é
  como se chega a duas verdades sobre o mesmo número.
*/
export * from "./reconciliacao";
/*
  A matriz completa — as vinte e duas linhas do `RESUMO GERAL` com veredito.
  A reconciliação prova catorze; esta obriga as vinte e duas a ter status, e é
  ela que responde "de onde veio este número e por que ele é igual — ou
  justificadamente diferente — ao da planilha?".
*/
export * from "./matriz";

/*
  A aferição — precisão e lastro, derivados do próprio painel.

  Depois da matriz de propósito: ela consome `resumo.ts` e `matriz.ts`, e a
  ordem do arquivo é a ordem em que se lê o que cada módulo sabe.
*/
export * from "./afericao";
export * from "./cadastro-porta";
export * from "./identidade-da-competencia";
/*
  A régua de conferência. Sai da raiz do pacote porque a rota e a tela precisam
  dela; **não** sai daqui nada que o cálculo consuma — ver a nota de
  contaminação em `painel-referencia.ts`. A persistência da referência mora em
  `./referencia-persistencia` e é exportada à parte, pelo mesmo motivo por que
  `persistencia.ts` também é: quem só quer os tipos não arrasta o banco junto.
*/
export * from "./referencia";
export * from "./painel-referencia";
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
/*
  Por que um 03.08.20 não virou verba. Vai no índice porque a pergunta é da
  tela, e não do terminal: enquanto a análise só existiu num CLI, responder
  "importei e não apareceu" exigia terminal e `DATABASE_URL`.
*/
export {
  diagnosticarPagamento,
  type DiagnosticoDoPagamento,
  type CausaDoPagamentoSemVerba,
  type LinhaSuspeita,
} from "./diagnostico-pagamento";
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
