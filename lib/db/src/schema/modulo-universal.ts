import { pgTable, text, uuid, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * MÓDULO UNIVERSAL — o que a instalação inteira desliga, para todo mundo.
 *
 * `permissao.ts` decide por pessoa, `papel.ts` decide por grupo de pessoas. As
 * duas respondem "quem alcança o quê", e nenhuma responde a pergunta que veio
 * depois: **esta casa usa esta parte do produto?** Uma instalação que não
 * trabalha com Processos, QLP e Frota não quer decidir isso papel a papel — e
 * decidir papel a papel envelhece calado, porque o papel criado na semana
 * seguinte nasce com as seções que ninguém usa de volta no menu.
 *
 * Esta tabela é essa terceira camada, e ela é **acima** das outras duas: o que
 * está desligado aqui não aparece para ninguém, qualquer que seja o papel ou a
 * exceção da conta. É a camada da instalação, e não a de uma pessoa.
 *
 * Três decisões, e nenhuma é técnica.
 *
 * 1. **Ela só tira.** Não há nível: uma chave está ligada ou desligada.
 *    Desligada, todo mundo recebe `SEM_ACESSO` naquela chave; ligada, ela não
 *    diz nada, e quem decide continua sendo o papel e a exceção — como sempre
 *    foi. Dar a esta camada os três níveis a faria competir com as outras duas
 *    pela mesma resposta, e "quem venceu" viraria uma pergunta com três
 *    candidatos onde hoje ela tem dois e se lê em ordem.
 * 2. **A ausência de linha é ligado**, na mesma direção do silêncio das outras
 *    duas tabelas: uma linha só existe quando alguém decidiu desligar. É o que
 *    faz a migration não mudar o menu de ninguém no dia em que ela roda.
 * 3. **A chave é a mesma das outras duas** — o endereço do item no menu, ou `@`
 *    mais o id do ambiente. Uma seção do menu não tem chave própria: desligar
 *    "Processos" é desligar os módulos dela, e a seção some sozinha quando fica
 *    vazia (`filtrarGrupos`, do lado da interface). Uma chave de seção seria um
 *    quarto tipo de chave que o portão de escrita não saberia ler.
 *
 * O histórico vale pela mesma razão que vale nas outras duas, e mais um pouco:
 * este é o ato mais amplo que o produto oferece — ele muda o menu de todo mundo
 * ao mesmo tempo, inclusive de quem nunca foi mencionado em decisão nenhuma.
 */

export const moduloUniversalTable = pgTable(
  "modulo_universal",
  {
    /** O `href` do item no menu, ou `@ambiente`. Linha aqui = desligado. */
    chave: text("chave").primaryKey(),
    desligadoEm: timestamp("desligado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** O e-mail de quem desligou, no mesmo formato do `actor` do resto. */
    desligadoPor: text("desligado_por").notNull(),
    /**
     * Por que esta parte não é usada aqui. Nulo é legítimo — o desligamento
     * vale sem justificativa —, mas quem escreve poupa meses de "por que esta
     * tela sumiu?" a quem chegar depois.
     */
    motivo: text("motivo"),
  },
  (t) => [index("modulo_universal_chave_idx").on(t.chave)],
);

/**
 * O histórico, que só cresce.
 *
 * Guarda o estado que passou a valer, e não o anterior: com dois estados, o
 * anterior é o outro — e o que a pergunta de meses depois quer saber é "quem
 * desligou o QLP, e quando", que é exatamente uma linha destas.
 */
export const moduloUniversalEventoTable = pgTable(
  "modulo_universal_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chave: text("chave").notNull(),
    /** `false` é o desligamento; `true`, a volta ao menu. */
    ligado: boolean("ligado").notNull(),
    motivo: text("motivo"),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
    por: text("por").notNull(),
  },
  (t) => [
    index("modulo_universal_evento_chave_idx").on(t.chave),
    index("modulo_universal_evento_em_idx").on(t.em),
  ],
);
