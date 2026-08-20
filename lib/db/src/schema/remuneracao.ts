import {
  pgTable,
  text,
  uuid,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A PLANILHA DE REMUNERAÇÃO COMO ALGUÉM A PREENCHEU — o que a aba diz, não o
 * que o acervo mede.
 *
 * **Por que esta tabela existe, se `@workspace/remuneracao` dizia não ter
 * nenhuma.** Ela dizia, e a frase estava certa para o que o módulo fazia então:
 * ler o acervo da Auditoria e escrever o cadastro que ele sustenta. Uma tabela
 * de *frota* ali seria uma terceira verdade sobre a frota, ao lado do export e
 * da apuração — e continua sendo, e continua não existindo.
 *
 * O que esta tabela guarda é outra coisa: **o que a planilha declara**. Hoje o
 * cadastro tem trinta linhas e o acervo sustenta onze; as outras dezenove não
 * esperam arquivo nenhum — esperam uma decisão de negócio que ninguém registrou
 * (qual conjunto de colunas forma "Remuneração Fixa - Frota Fixa Ativa", qual
 * valor marca a rota noturna, o que separa van de cavalo). Enquanto isso, o
 * número existe: está digitado na aba de Excel que a transportadora manda todo
 * mês. Recusá-lo não o torna mais verdadeiro — só o mantém fora do produto,
 * onde ninguém pode conferi-lo.
 *
 * **A regra que a torna segura é a mesma do módulo inteiro: nenhuma linha
 * inventa a sua origem.** O que entra aqui sai da tela marcado como
 * `INFORMADO`, com o nome de quem digitou e a data — nunca como `APURADO`. E
 * onde o acervo *também* responde, o valor da tela continua sendo o medido: o
 * declarado vira **conferência** ao lado dele, e a diferença entre os dois é
 * exatamente o que este produto existe para achar. Um número digitado nunca
 * apaga um número medido.
 *
 * **Por escopo e vigência, e não por competência.** A aba descreve o que a
 * Ambev contratou para aquela unidade naquela vigência — o mesmo eixo do resto
 * do módulo. Repetir o valor para a vigência seguinte é um ato de quem
 * preenche, e a tela tem um botão para copiar; o que não existe é herança
 * silenciosa, que faria a planilha de julho responder por agosto sem que
 * ninguém tivesse dito isso.
 *
 * **`canal` é `''` e não `NULL`** para a série sem canal. A chave da unidade é
 * (escopo, canal), o canal é opcional, e no Postgres dois `NULL` não colidem
 * num índice único — a unicidade que impede duas linhas para a mesma célula
 * simplesmente não valeria para as séries sem canal, que são a maioria. O
 * mesmo `channel ?? ""` que `chaveDoAlvo` usa em `lib/remuneracao/src/leitura.ts`,
 * aqui aplicado na coluna.
 *
 * **Sem gatilho de congelamento**, pela razão da `fechamento_parte`: isto não é
 * conteúdo de competência nenhuma. Encerrar a quinzena congela a conta que se
 * cobrou; a planilha da vigência seguinte continua sendo preenchível.
 */
export const remuneracaoPlanilhaTable = pgTable(
  "remuneracao_planilha",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** O escopo da unidade — o mesmo `scope_hash` de `snapshot`. */
    scopeHash: text("scope_hash").notNull(),
    /** O canal da série. `''` é a série sem canal — ver o cabeçalho. */
    canal: text("canal").notNull().default(""),
    /** A vigência que esta planilha descreve. */
    effectiveDate: date("effective_date").notNull(),
    /**
     * A chave da linha no catálogo (`aliquota_pis`, `van_custo_fixo`, …).
     *
     * Sem FK, porque o catálogo é código versionado e não tabela — ver
     * `lib/remuneracao/src/catalogo.ts` para por que ele é código. Quem recusa
     * uma chave desconhecida é a rota, na escrita, e é lá que a recusa tem
     * como ser escrita em português para quem a provocou.
     */
    chave: text("chave").notNull(),
    /**
     * O número como a planilha o traz, na unidade da linha: reais em linha de
     * dinheiro, pontos percentuais em linha de percentual, cabeças em linha de
     * quantidade.
     *
     * `numeric` sem precisão declarada, como as demais colunas monetárias do
     * produto: quem arredonda é a leitura, conforme o que a linha mede.
     */
    valor: numeric("valor").notNull(),
    /**
     * De onde veio o número, nas palavras de quem digitou.
     *
     * Opcional, e não é enfeite: é o campo onde cabe "célula D14 da aba de
     * agosto" ou "acordo comercial de 12/08". Numa linha que o acervo não
     * sustenta, é a única procedência que vai existir.
     */
    observacao: text("observacao"),
    /**
     * Quem informou. Sem FK para `app_user` de propósito: a conta pode ser
     * desativada, e o histórico do número não pode depender disso.
     */
    autorId: uuid("autor_id"),
    /** O nome de quem informou, congelado no momento em que informou. */
    autorNome: text("autor_nome"),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadaEm: timestamp("atualizada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Uma célula da planilha é uma linha. Reinformar é reescrever esta. */
    uniqueIndex("remuneracao_planilha_unica").on(
      t.scopeHash,
      t.canal,
      t.effectiveDate,
      t.chave,
    ),
    /** A leitura é sempre "a planilha desta unidade nesta vigência". */
    index("remuneracao_planilha_por_vigencia").on(t.scopeHash, t.canal, t.effectiveDate),
  ],
);
