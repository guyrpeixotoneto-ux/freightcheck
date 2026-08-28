/**
 * FLUXOS OPERACIONAIS — o motor genérico.
 *
 * O que este pacote é: o catálogo do vocabulário, o modelo, a validação, o
 * layout, o repositório escopado por empresa e os modelos declarativos. Tudo
 * que sabe o que é um fluxo mora aqui; a rota HTTP (`artifacts/api-server`) só
 * traduz requisição em chamada, e a tela (`artifacts/freightaudit`) só desenha.
 *
 * O que este pacote **não** é: nada sobre CTe. `exemplos/cte-ate-recebimento.ts`
 * é dado, exatamente como `exemplos/nf-ate-pagamento.ts`, e nenhuma função aqui
 * sabe qual dos dois está carregado.
 */
export * from "./catalogo";
export * from "./modelo";
export * from "./validacao";
export * from "./layout";
export * from "./roteiro";
export * from "./repositorio";
export * from "./semear";
export * from "./monitoramento";
export {
  MODELOS,
  CTE_ATE_RECEBIMENTO,
  NF_ATE_PAGAMENTO,
  OPERACAO_EMPURRADA,
  type ModeloDeFluxo,
} from "./exemplos";
