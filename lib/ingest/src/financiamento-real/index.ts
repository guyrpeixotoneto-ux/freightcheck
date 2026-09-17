/**
 * O acervo Real, num subcaminho só.
 *
 * Reúne o que a API e as telas precisam do financiamento real — o leitor do
 * extrato, a regra de agregação e o estágio — sem obrigar quem importa o
 * `@workspace/ingest` inteiro a carregar junto o que não usa.
 *
 * A família é reexportada daqui por conveniência de quem já está lendo este
 * módulo; a definição continua uma só, em `tipos.ts`.
 */
export * from "./extrato";
export * from "./agregacao";
export * from "./estagio";
export { DATASET_FAMILY_FINANCIAMENTO_REAL } from "../tipos";
