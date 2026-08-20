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
 * Auditoria. Por isso a tela é do Fechamento e a leitura é do canônico.
 *
 * A aritmética inteira é pura e vive em `medicao.ts`, `montagem.ts` e
 * `informado.ts`; `db` só aparece em `leitura.ts` e `planilha.ts`. É o que
 * permite testar as trinta linhas do cadastro sem Postgres, e é a mesma
 * fronteira que `@workspace/fechamento` mantém entre a apuração e a
 * persistência dela.
 *
 * **A tabela que este módulo passou a ter, e por que ela não contradiz o
 * parágrafo acima.** Até a `0045` a frase era "sem nenhuma tabela nova", e ela
 * valia: uma tabela de *frota* aqui seria uma terceira verdade sobre a frota,
 * ao lado do que o export declara e do que a apuração usa — e continua sendo, e
 * continua não existindo. `remuneracao_planilha` guarda outra coisa: **o que a
 * aba de Excel declara**, digitado por quem a preenche.
 *
 * Ela nasceu de uma constatação de uso. O cadastro tem trinta linhas e o acervo
 * sustenta onze; as outras dezenove não esperam arquivo nenhum — esperam
 * decisões de negócio que ninguém registrou. Enquanto elas não chegam, o número
 * existe na planilha que a transportadora manda todo mês, e mantê-lo fora do
 * produto não o torna mais verdadeiro: só o mantém onde ninguém o confere.
 *
 * O que impede a mistura é o estado: o que entra por ali sai como `INFORMADO`,
 * com autor e data, nunca como `APURADO`; e onde o acervo também responde, o
 * valor da linha continua sendo o medido, com o declarado ao lado como
 * conferência. Ver `informado.ts`.
 *
 * **A segunda tabela, `remuneracao_unidade`, e a regra que ela dobra.** Uma
 * unidade sempre nasceu de um `snapshot`: quem nunca mandou export não existia
 * em tela nenhuma. Na Auditoria isso está certo — lá a pergunta é o que os
 * arquivos sustentam, e uma unidade sem arquivo não sustenta nada. No
 * Fechamento é uma parede: a quinzena é de várias unidades, a aba de Excel
 * costuma chegar antes do export, e a unidade que só tem aba não tinha onde ser
 * digitada.
 *
 * A tabela guarda **identidade, e não número**: nome, código, tipo de operação
 * e a quinzena em que se começou a preencher. Os números continuam na
 * `remuneracao_planilha`, com o mesmo estado `INFORMADO` de sempre.
 *
 * E o identificador dela não é sorteado: é o mesmo `hashScopeSet` da
 * importação, somado na borda sobre o código que o export também carrega. É o
 * que faz o dia da primeira importação de uma unidade registrada ser um dia em
 * que nada acontece na tela — o rótulo passa a vir do arquivo, a planilha
 * digitada continua onde estava, e ninguém precisa juntar duas linhas. Ver
 * `unidade.ts`.
 */

export * from "./catalogo";
export * from "./colunas";
export * from "./medicao";
export * from "./informado";
export * from "./montagem";
export * from "./situacao";
export * from "./unidade";
export * from "./comparacao";
export * from "./vigencia";
export * from "./planilha";
export * from "./leitura";
