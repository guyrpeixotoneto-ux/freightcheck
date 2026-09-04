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
 * 3. **A chave tem três formas** — o endereço do item no menu, `@` mais o id do
 *    ambiente, e `#` mais o id da seção. As três são disjuntas por construção,
 *    e é isso que permite as três decisões conviverem numa coluna de texto sem
 *    coluna de tipo. O vocabulário está escrito uma vez, em
 *    `@workspace/acesso`, e é lido pelo menu e pelo portão de escrita.
 *
 *    A seção **não** tinha chave, e a razão escrita na `0086` era boa: desligar
 *    "Processos" era desligar os módulos dela, e a seção sumia sozinha quando
 *    ficava vazia (`filtrarGrupos`, do lado da interface). O que aquela razão
 *    não previu foi o tempo. A decisão gravava as chaves dos módulos que
 *    existiam **naquele instante**; um módulo novo dentro da seção nascia
 *    ligado — chave sem linha é chave ligada, que é o silêncio que concede
 *    nesta camada inteira — e devolvia a seção ao menu de quem a tinha
 *    desligado. Aconteceu três vezes em quatro dias, em setembro de 2026.
 *
 *    A precedência agora é: **seção desligada vence módulo ligado**. O módulo
 *    que nascer amanhã dentro de uma seção desligada nasce invisível, e para
 *    devolver um módulo ao menu a seção precisa primeiro estar ligada. O id da
 *    seção não sai do título dela (ver `NavGroup.id`, na interface): a mesma
 *    seção já se chamou "Plano de Ação", "Chamados" e "Chamados Ambev" em um
 *    mês, e uma chave derivada do rótulo teria apagado a decisão a cada
 *    renomeação — o mesmo defeito, por outra porta.
 *
 *    O portão de escrita **sabe** ler a chave nova: `secaoGovernadaDe`, em
 *    `@workspace/acesso`, diz de que seção é cada módulo que ele gateia, e um
 *    teste da interface confere essa tabela contra o menu de verdade.
 *
 * O histórico vale pela mesma razão que vale nas outras duas, e mais um pouco:
 * este é o ato mais amplo que o produto oferece — ele muda o menu de todo mundo
 * ao mesmo tempo, inclusive de quem nunca foi mencionado em decisão nenhuma.
 */

export const moduloUniversalTable = pgTable(
  "modulo_universal",
  {
    /**
     * O `href` do item no menu, `@ambiente` ou `#secao`. Linha aqui =
     * desligado; a ausência de linha é ligado.
     */
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
