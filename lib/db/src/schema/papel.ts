import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  check,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * PAPEL — o acesso que se cadastra uma vez e vale para muita gente.
 *
 * `permissao.ts` deu ao produto a permissão **por pessoa**, e ela resolveu o
 * caso de tirar um módulo de alguém. O que ela não resolve é o caso comum: a
 * conta nova. Quem cria a décima conta de conferente repete, módulo a módulo,
 * as mesmas trinta decisões que tomou nas nove anteriores — e erra uma, em
 * silêncio, porque não há com o que comparar.
 *
 * Um papel é essa lista de decisões com nome. `Conferente` diz o que um
 * conferente alcança; a conta aponta para o papel; e mudar o papel muda o
 * acesso de todo mundo que o usa, na mesma hora. **É vínculo, e não carimbo**:
 * um modelo que só copiasse valores na criação envelheceria calado — no dia em
 * que a Curadoria saísse do alcance dos conferentes, alguém teria de abrir as
 * dez contas, e a décima primeira, criada na semana seguinte, nasceria com o
 * acesso antigo.
 *
 * Três decisões, e nenhuma é técnica.
 *
 * 1. **A ausência de linha continua concedendo.** Um papel sem nenhuma linha em
 *    `papel_permissao` alcança tudo, como toda conta alcançava antes de haver
 *    permissão. Papel aqui é o que se **tira** de um grupo de pessoas, na mesma
 *    direção de `permissao_de_modulo` — e as duas tabelas somam-se lendo o
 *    silêncio do mesmo jeito, que é o que permite empilhá-las sem que a soma
 *    signifique coisas diferentes em cada camada.
 * 2. **A linha da pessoa é exceção, e vence a do papel.** Quem escolhe um papel
 *    para alguém decide o caso geral; quem abre Permissões e mexe num módulo
 *    daquela pessoa decide o caso dela, depois e sabendo do papel. Inverter
 *    isso — o papel vencendo a exceção — faria a tela de Permissões mostrar uma
 *    decisão que não vale, que é a única coisa pior do que não ter a tela.
 * 3. **`gerencia_contas` é do papel, e não um nível de módulo.** "Cria contas,
 *    desativa e redefine senha" é o portão que `app_user.role` guarda em dezenas
 *    de lugares do servidor; espremê-lo na matriz de módulos o transformaria
 *    numa restrição de menu — quer dizer, em nada. O papel diz se administra, e
 *    `app_user.role` continua sendo a coluna que o servidor lê, mantida em dia
 *    a partir daqui (ver `lib/papeis.ts`, no api-server): uma resposta só, num
 *    lugar só, com um dono declarado.
 *
 * O que **não** está aqui, de propósito: hierarquia entre papéis, herança de um
 * papel por outro e papel por ambiente. Os três são desenho, não pedido — e
 * cada um deles multiplicaria as respostas possíveis para "o que esta pessoa
 * alcança", que hoje são duas e se leem em ordem.
 */

export const papelTable = pgTable(
  "papel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * O nome que aparece no seletor de Usuários — `Conferente`, `Analista de
     * frete`. Único, sem diferenciar maiúsculas: dois papéis `Conferente` e
     * `CONFERENTE` seriam duas listas de acesso concorrentes com o mesmo nome
     * na tela, e o defeito que o cadastro de cargos existiu para acabar.
     */
    nome: text("nome").notNull(),
    /** Uma linha sobre quem usa este papel. Nulo é legítimo: o nome basta. */
    descricao: text("descricao"),
    /**
     * Este papel gerencia contas? É o antigo ADMIN, agora um atributo do papel.
     *
     * Default `false`, fail-closed, pela mesma razão do default de
     * `app_user.role`: um INSERT que esqueça a coluna — um script, um backfill —
     * não fabrica um papel que administra o sistema.
     */
    gerenciaContas: boolean("gerencia_contas").notNull().default(false),
    /**
     * Papel do sistema: `Operador` e `Administrador`, os dois que já existiam
     * como `role` e que a `0082` semeou.
     *
     * Não se apaga e não se renomeia — toda conta anterior a esta tabela aponta
     * para um dos dois, e um produto sem nenhum papel que administre contas é a
     * porta trancada por dentro. As permissões deles, essas sim, se editam:
     * é o que faz o cadastro valer também para quem nunca criar um papel novo.
     */
    sistema: boolean("sistema").notNull().default(false),
    criadoEm: timestamp("criado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** O e-mail de quem cadastrou. Nulo é o que a `0082` semeou. */
    criadoPor: text("criado_por"),
  },
  (t) => [
    uniqueIndex("papel_nome_key").on(sql`lower(${t.nome})`),
  ],
);

/**
 * O que o papel tira, chave a chave.
 *
 * A chave é a mesma de `permissao_de_modulo` — o endereço do item no menu, ou
 * `@` mais o id do ambiente —, e é a mesma de propósito: as duas camadas são
 * lidas juntas, e uma chave que só existisse de um lado seria uma restrição
 * que a tela mostra e o portão ignora.
 */
export const papelPermissaoTable = pgTable(
  "papel_permissao",
  {
    papelId: uuid("papel_id")
      .notNull()
      .references(() => papelTable.id, { onDelete: "cascade" }),
    /** O `href` do item no menu, ou `@ambiente`. */
    chave: text("chave").notNull(),
    /** EDITAR, VISUALIZAR ou SEM_ACESSO. */
    nivel: text("nivel").notNull(),
    definidoEm: timestamp("definido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    definidoPor: text("definido_por").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.papelId, t.chave] }),
    index("papel_permissao_papel_idx").on(t.papelId),
    check(
      "papel_permissao_nivel_check",
      sql`${t.nivel} IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO')`,
    ),
  ],
);

/**
 * O histórico do papel, que só cresce.
 *
 * Mexer num papel muda o acesso de todo mundo que o usa — é o ato mais amplo
 * que esta parte do produto oferece, e o que mais precisa dizer de quem foi.
 * Guarda também o que não é permissão: criar o papel, renomeá-lo e dar-lhe (ou
 * tirar-lhe) o poder de gerenciar contas. `chave` nulo é exatamente isso — um
 * ato sobre o papel inteiro, e não sobre um módulo dele.
 */
export const papelEventoTable = pgTable(
  "papel_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    papelId: uuid("papel_id")
      .notNull()
      .references(() => papelTable.id, { onDelete: "cascade" }),
    /** Nulo quando o ato é sobre o papel inteiro — ver o `tipo`. */
    chave: text("chave"),
    /** CRIADO, RENOMEADO, ADMINISTRACAO ou PERMISSAO. */
    tipo: text("tipo").notNull(),
    /** O nível anterior, quando o ato é de permissão. */
    nivelAnterior: text("nivel_anterior"),
    nivel: text("nivel"),
    /** O que o ato diz em uma linha, para o histórico da tela. */
    detalhe: text("detalhe"),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
    por: text("por").notNull(),
  },
  (t) => [
    index("papel_evento_papel_idx").on(t.papelId),
    index("papel_evento_em_idx").on(t.em),
    check(
      "papel_evento_tipo_check",
      sql`${t.tipo} IN ('CRIADO', 'RENOMEADO', 'ADMINISTRACAO', 'PERMISSAO')`,
    ),
  ],
);
