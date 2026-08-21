import { pgTable, text, timestamp, uuid, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * A UNIDADE CANÔNICA — a autoridade única sobre "qual unidade é esta".
 *
 * Ver `lib/db/src/unidade.ts` para o porquê. Em uma linha: o produto tinha
 * quatro representações independentes da mesma unidade e nenhuma era autoridade
 * sobre as outras, então o fechamento *adivinhava* se dois textos eram a mesma
 * coisa. A identidade passa a ser o `id` desta tabela.
 *
 * **Mora num arquivo próprio, e não no schema do fechamento.** Ela é de todo o
 * produto: Fechamento e Remuneração a referenciam igualmente, e pô-la dentro de
 * um dos dois faria o outro importar o schema do primeiro para saber quem é a
 * unidade — a mesma subordinação que esta tabela existe para desfazer.
 *
 * **Nasce vazia, e é de propósito.** Nenhum backfill a popula: nem de `443`,
 * nem de nome, nem dos snapshots. Uma unidade canônica é um **cadastro** — ato
 * explícito de uma pessoa —, e derivá-la de um arquivo faria o acervo criar
 * identidade sozinho, que é exatamente o desenho que estamos desfazendo. O
 * `canonical_scope` de um snapshot é evidência determinística e vira *sugestão*
 * na tela, com o CNPJ preenchido; quem confirma é gente.
 */
export const unidadeTable = pgTable(
  "unidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** O nome legível — descrição, nunca identidade. `CDD BELÉM`. */
    nome: text("nome").notNull(),
    /**
     * Os catorze dígitos do CNPJ, sem máscara — a identidade.
     *
     * Sem máscara porque `12.345.678/0001-99` e `12345678000199` são o mesmo
     * documento e guardar a forma digitada faria a mesma unidade existir duas
     * vezes. Quem valida é `lerCnpj`, e o `check` abaixo é a segunda linha de
     * defesa: nenhum caminho da aplicação consegue gravar outra coisa.
     */
    cnpj: text("cnpj").notNull(),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unidade_cnpj_uq").on(t.cnpj),
    check("unidade_cnpj_canonico", sql`${t.cnpj} ~ '^[0-9]{14}$'`),
  ],
);
