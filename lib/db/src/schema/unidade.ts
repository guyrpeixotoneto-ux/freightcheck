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
 *
 * **Duas colunas de identidade, e não uma.** O CNPJ era obrigatório, e a
 * exigência parava o cadastro de unidade que o negócio conhece por um código
 * gerencial — a que ainda não tem CNPJ próprio, a que opera sob o CNPJ de
 * outra, a que a operação nomeia por `081-0443` e mais nada. Exigir o
 * documento nesses casos não produzia cadastro melhor: produzia cadastro
 * nenhum, e a unidade voltava a existir como texto livre nas quatro
 * representações que esta tabela veio substituir. O `check` abaixo é o que
 * mantém a regra que importa — **alguma** identidade tem de haver —, sem
 * mandar inventar documento.
 */
export const unidadeTable = pgTable(
  "unidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** O nome legível — descrição, nunca identidade. `CDD BELÉM`. */
    nome: text("nome").notNull(),
    /**
     * Os catorze dígitos do CNPJ, sem máscara — a identidade preferida.
     *
     * Sem máscara porque `12.345.678/0001-99` e `12345678000199` são o mesmo
     * documento e guardar a forma digitada faria a mesma unidade existir duas
     * vezes. Quem valida é `lerCnpj`, e o `check` abaixo é a segunda linha de
     * defesa: nenhum caminho da aplicação consegue gravar outra coisa.
     *
     * `NULL` quando a unidade é identificada só pelo código gerencial — e
     * `NULL` é a resposta honesta ali, e não uma string vazia: o índice único
     * trata cada `NULL` como distinto, então nenhuma unidade sem CNPJ bloqueia
     * a próxima, enquanto duas com o mesmo CNPJ continuam impossíveis.
     */
    cnpj: text("cnpj"),
    /**
     * O código com que a operação chama esta unidade — a outra identidade.
     *
     * Único como o CNPJ, e pela mesma razão: se dois cadastros pudessem
     * responder pelo mesmo código, "qual unidade é esta" voltaria a ter duas
     * respostas. Guardado como {@link lerCodigoGerencial} o normaliza — sem
     * espaço em volta e em caixa alta —, porque `443`, `443 ` e `443` de outra
     * caixa são o mesmo código para quem digita e três linhas para o banco.
     *
     * **Não é o `codigo` de `remuneracao_unidade` nem o texto que o export
     * traz.** Aqueles continuam sendo o que a fonte escreveu, e nada aqui os
     * converte: este é o código do *cadastro*, e o que ele faz é dar
     * identidade a uma unidade cujo documento ninguém tem para digitar.
     */
    codigoGerencial: text("codigo_gerencial"),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unidade_cnpj_uq").on(t.cnpj),
    uniqueIndex("unidade_codigo_gerencial_uq").on(t.codigoGerencial),
    check("unidade_cnpj_canonico", sql`${t.cnpj} IS NULL OR ${t.cnpj} ~ '^[0-9]{14}$'`),
    /*
      O código gerencial é texto de gente, então o `check` guarda só o que a
      normalização promete: nada em volta, nada vazio. Um formato mais estreito
      seria inventar uma gramática que a operação não tem.
    */
    check(
      "unidade_codigo_gerencial_normalizado",
      sql`${t.codigoGerencial} IS NULL OR ${t.codigoGerencial} ~ '^[^[:space:]](.*[^[:space:]])?$'`,
    ),
    /*
      A regra que sobrou de "o CNPJ é obrigatório", e a única que era mesmo
      indispensável: uma unidade sem identidade nenhuma não é cadastro — é uma
      linha que nada encontra e que nada pode referenciar sem adivinhar.
    */
    check(
      "unidade_tem_identidade",
      sql`${t.cnpj} IS NOT NULL OR ${t.codigoGerencial} IS NOT NULL`,
    ),
  ],
);
