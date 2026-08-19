/**
 * REMUNERAÇÃO — o cadastro da planilha, por unidade.
 *
 * Este pacote responde uma pergunta só: **quais são os parâmetros de
 * remuneração desta unidade, e o que no acervo da Auditoria os sustenta.**
 *
 * Ele fica entre os dois ambientes de propósito. A aba que ele reproduz é o
 * ponto de partida do Fechamento — é dela que a apuração da quinzena puxa
 * alíquotas, tamanho de frota e proporção de documentos —, mas todo número que
 * ela pede é *contratado*, e o que é contratado mora no modelo canônico da
 * Auditoria. Por isso a tela é do Fechamento e a leitura é do canônico, sem
 * nenhuma tabela nova: um cadastro com tabela própria seria uma terceira
 * verdade sobre a frota, ao lado da que o export declara e da que a apuração
 * usa.
 *
 * A aritmética inteira é pura e vive em `medicao.ts` e `montagem.ts`; `db` só
 * aparece em `leitura.ts`. É o que permite testar as trinta linhas do cadastro
 * sem Postgres, e é a mesma fronteira que `@workspace/fechamento` mantém entre
 * a apuração e a persistência dela.
 */

export * from "./catalogo";
export * from "./colunas";
export * from "./medicao";
export * from "./montagem";
export * from "./comparacao";
export * from "./leitura";
