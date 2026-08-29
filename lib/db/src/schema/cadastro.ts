import { type AnyPgColumn, pgTable, text, timestamp, uuid, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * O CADASTRO DA CASA — departamento, cargo e negócio como coisas, não como texto.
 *
 * As três telas existiam em `pages/telas-em-preparo.ts` e diziam a mesma frase
 * de formas diferentes: *o cargo é o que a célula disser, e duas grafias do
 * mesmo cargo são dois cargos para o motor*. Estas tabelas são a resposta a
 * isso, e o desenho segue o da unidade canônica (`schema/unidade.ts`) por ser o
 * mesmo problema: **identidade é cadastro, não é o que um arquivo trouxe.**
 *
 * **`nome_canonico` é a identidade; `nome` é a grafia.** O que a pessoa digitou
 * fica em `nome` e é o que a tela mostra — `Analista Administrativo`, com as
 * maiúsculas e o acento que ela escolheu. O que decide se dois cadastros são o
 * mesmo é `nome_canonico`: sem acento, sem caixa e sem espaço dobrado
 * (`canonizarNome`, em `lib/db/src/cadastro.ts`). `ANALISTA ADM` e
 * `analista adm` colidem no índice único e a segunda é recusada com o nome da
 * primeira — em vez de virar a segunda linha silenciosa que a tela de Cargos
 * existia para denunciar.
 *
 * A canonização mora no código e não num trigger porque é a **mesma função**
 * que a busca da tela usa para casar o que foi digitado; duas
 * implementações — uma em SQL, outra em TS — divergiriam no primeiro caractere
 * que uma tratasse e a outra não.
 *
 * **Nascem vazias, e nenhuma importação as popula.** Um export que traz a
 * palavra `Motorista` numa célula é evidência de que alguém escreveu isso, não
 * de que o cargo existe na casa. Criar cadastro a partir de arquivo é o desenho
 * que a unidade canônica desfez, e repeti-lo aqui devolveria a autoridade à
 * planilha.
 *
 * **O que estas tabelas deliberadamente ainda não têm.** Faixa salarial por
 * cargo, e vínculo entre departamento e classe de custo. Os dois estão escritos
 * como pendência no catálogo de telas em preparo, e os dois são vigência —
 * valor que muda com data e precisa deixar rastro datado, como toda vigência
 * deste produto deixa. Guardar um salário solto numa coluna aqui daria à tela
 * um número sem data e sem origem, que é o tipo de número que este produto
 * recusa. Enquanto não existirem, a tela de Cargos diz que não sabe o custo.
 */

/**
 * O departamento — a divisão interna, com hierarquia.
 *
 * `pai_id` é o que faz dela hierarquia e não lista: *Controladoria* dentro de
 * *Administrativo* é uma afirmação sobre quem responde por quem. É nulo na
 * raiz, e `RESTRICT` na exclusão porque apagar um pai deixaria os filhos
 * pendurados numa referência morta — quem quiser apagar move os filhos antes,
 * de propósito.
 *
 * A profundidade não é limitada aqui, e o ciclo (`A` dentro de `B` dentro de
 * `A`) é recusado em `cadastro.ts`: o banco não tem como ver o caminho inteiro
 * sem uma recursiva em trigger, e a recusa precisa chegar à tela como frase,
 * não como violação de constraint.
 */
export const departamentoTable = pgTable(
  "departamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A grafia escolhida por quem cadastrou. `Controladoria`. */
    nome: text("nome").notNull(),
    /** A identidade: sem acento, sem caixa, sem espaço dobrado. `CONTROLADORIA`. */
    nomeCanonico: text("nome_canonico").notNull(),
    /** O departamento acima deste. Nulo na raiz. */
    paiId: uuid("pai_id").references((): AnyPgColumn => departamentoTable.id, {
      onDelete: "restrict",
    }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    /** O e-mail de quem cadastrou — o mesmo `actor` do resto do produto. */
    criadoPor: text("criado_por"),
  },
  (t) => [
    uniqueIndex("departamento_nome_canonico_uq").on(t.nomeCanonico),
    index("departamento_pai_idx").on(t.paiId),
    check("departamento_nome_canonico_nao_vazio", sql`length(${t.nomeCanonico}) > 0`),
  ],
);

/**
 * O cargo — o que uma pessoa faz, como cadastro.
 *
 * `departamento_id` é opcional e é a única coluna que liga os dois cadastros.
 * Opcional porque o cargo existe antes de alguém decidir onde ele fica, e
 * obrigá-lo transformaria "cadastrar um cargo" em "cadastrar a estrutura
 * inteira primeiro" — a barreira que faz gente desistir do cadastro e voltar a
 * digitar texto na planilha, que é o que estamos desfazendo.
 */
export const cargoTable = pgTable(
  "cargo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    nomeCanonico: text("nome_canonico").notNull(),
    /** Onde este cargo está lotado. Nulo enquanto ninguém disse. */
    departamentoId: uuid("departamento_id").references(() => departamentoTable.id, {
      onDelete: "restrict",
    }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    criadoPor: text("criado_por"),
  },
  (t) => [
    uniqueIndex("cargo_nome_canonico_uq").on(t.nomeCanonico),
    index("cargo_departamento_idx").on(t.departamentoId),
    check("cargo_nome_canonico_nao_vazio", sql`length(${t.nomeCanonico}) > 0`),
  ],
);

/**
 * O negócio — a operação atendida.
 *
 * Rota, Empurrada, AS e Apoio são hoje bases de fechamento escritas no código:
 * criar um negócio novo é um deploy. Esta tabela **não** muda isso, e é
 * importante que a tela diga: o que ela dá é o cadastro — o negócio como coisa
 * nomeada, com autor e data —, não a capacidade de o motor calcular sobre um
 * negócio que ele não conhece. Prometer a segunda coisa numa tela de cadastro
 * seria a mentira que o catálogo de telas em preparo recusava.
 */
export const negocioTable = pgTable(
  "negocio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    nomeCanonico: text("nome_canonico").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    criadoPor: text("criado_por"),
  },
  (t) => [
    uniqueIndex("negocio_nome_canonico_uq").on(t.nomeCanonico),
    check("negocio_nome_canonico_nao_vazio", sql`length(${t.nomeCanonico}) > 0`),
  ],
);
