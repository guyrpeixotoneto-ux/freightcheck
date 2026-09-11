import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * O REGISTRO DOS REPAROS DE DADO — o que já rodou, uma vez, e com que saldo.
 *
 * ---------------------------------------------------------------------------
 * Por que uma tabela, e não uma varredura a cada partida
 * ---------------------------------------------------------------------------
 *
 * Há dois tipos de trabalho que a partida faz depois da fila, e este produto já
 * tinha o primeiro: a varredura **naturalmente limitada**, como o censo do
 * balanço (`0080`) e a presença das vigências (`0081`). Ali o alvo é "a linha
 * que ainda não tem o valor derivado", então cada passada encolhe a próxima até
 * não sobrar nada, e a consulta de partida custa um índice.
 *
 * O reparo de série não é assim, e a diferença é o motivo desta tabela existir.
 * O alvo é "o envio cuja série é nula", e **nem todo envio sai desse estado**:
 * um arquivo sem coluna `Unidade`, com nome que não nomeia unidade nenhuma e
 * sem ninguém para declarar fica legitimamente indeterminado. Sem registro, ele
 * seria reprocessado em **toda** partida, para sempre, para chegar à mesma
 * resposta — e o custo não é o `SELECT`, é o recálculo das comparações de todos
 * os envios daquela série, que é trabalho de verdade sobre dado derivado.
 *
 * Com registro, o reparo é um evento datado: roda uma vez, deixa o saldo
 * escrito, e as partidas seguintes leem uma linha e seguem. É também o que
 * torna a resposta auditável — "quantos envios este reparo encontrou, quantos
 * corrigiu, quantos deixou como estavam e em quantos falhou" é uma pergunta que
 * alguém faz **depois**, e um log de partida não a responde três deploys
 * adiante.
 *
 * ---------------------------------------------------------------------------
 * O que ela não é
 * ---------------------------------------------------------------------------
 *
 * **Não é a fila de migrations, e não pretende ser.** `__drizzle_migrations`
 * carimba DDL versionado, aplicado numa transação, cuja falha impede a partida.
 * Um reparo de dado é o oposto em todas as três: ele lê regra de aplicação
 * (a derivação da série mora em `lib/comparison`, não em SQL), leva o tempo que
 * o acervo exigir, e **não pode** derrubar o servidor se falhar. Misturar os
 * dois faria a fila passar a depender de dado, que é a inversão que
 * `drizzle-kit.config.ts` existe para impedir.
 *
 * **Não é decisão de gente.** Por isso está em `TABELAS_DESCARTAVEIS`, no
 * bridge: perder uma linha daqui faz o reparo rodar de novo, e rodar de novo é
 * inócuo por construção — ele só sai do indeterminado para um nome, e nunca
 * toca numa série já estabelecida.
 */
export const reparoDeDadosTable = pgTable("reparo_de_dados", {
  /**
   * O nome versionado do reparo — `0095_serie_indeterminada`.
   *
   * É a chave primária, e é isso que faz a execução ser única: a linha existe
   * ou não existe, e quem a encontra não roda. O prefixo numérico amarra o
   * reparo à migration que o introduziu, para que a ordem de leitura seja a
   * mesma da fila quando um segundo reparo aparecer.
   */
  nome: text("nome").primaryKey(),
  aplicadoEm: timestamp("aplicado_em", { withTimezone: true }).notNull().defaultNow(),
  /** Quantos envios o recorte alcançou. */
  encontrados: integer("encontrados").notNull().default(0),
  /** Quantos saíram da série indeterminada para um nome. */
  corrigidos: integer("corrigidos").notNull().default(0),
  /**
   * Quantos continuaram indeterminados — e isso **não** é falha.
   *
   * É o envio que o arquivo não nomeia, cujo nome não nomeia unidade nenhuma e
   * que ninguém declarou. A resposta certa para ele é continuar indeterminado;
   * atribuí-lo a uma unidade por proximidade seria a única coisa pior do que
   * não repará-lo.
   */
  ignorados: integer("ignorados").notNull().default(0),
  /** Em quantos a transação daquele envio foi desfeita, com o erro. */
  falhas: integer("falhas").notNull().default(0),
  /**
   * O que aconteceu com cada envio, nomeado.
   *
   * `{ ticketImportId, filename, de, para, origem, erro? }`. Sem isto, o saldo
   * diz "corrigiu 1" e não diz qual — e a primeira pergunta de quem confere um
   * reparo é sempre *qual*.
   */
  detalhe: jsonb("detalhe").notNull().default([]),
});
