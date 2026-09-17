import {
  pgTable,
  text,
  uuid,
  numeric,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUserTable } from "./auth";

/**
 * AGENTE DE COMPRAS — a cotação que o acervo não tem, e a premissa que ele não
 * sabe.
 *
 * O FreightCheck importa **remuneração**: o que a Ambev paga por um ativo, por
 * uma vigência, coluna a coluna. Ele não importa nota fiscal de compra, não
 * conhece fornecedor e nunca viu uma proposta comercial. Foi por isso que a
 * tela Remunerado se recusou, desde o primeiro dia, a dizer "pode comprar" —
 * o comentário está lá, em `routes/compras.ts`: *o pedido não está no banco*.
 *
 * Estas duas tabelas são o outro lado dessa frase. Elas não trazem o pedido
 * para dentro da auditoria — nada aqui vira fato canônico, nada entra em
 * vigência, nada altera uma comparação. Elas guardam **o que quem compra
 * digitou**, para que a pergunta "quanto eu deveria pagar por isso?" possa ser
 * respondida duas vezes com o mesmo número, e para que o painel do Agente de
 * Compras consiga contar quantas cotações esperam análise sem inventar a
 * contagem.
 *
 * **A fronteira que estas tabelas não cruzam.** Uma cotação é declaração de
 * quem a digitou; um fato é o que o arquivo da Ambev disse. Misturá-los faria o
 * impacto apurado de uma vigência depender de um preço que ninguém auditou.
 * Por isso elas vivem fora do grafo canônico: sem `snapshot_id`, sem
 * `entity_id`, sem participar de reconvergência. O elo com o acervo é o
 * `item` — a chave do catálogo de compras (`lib/compras/src/catalogo.ts`) —, e
 * ele é texto de propósito: o catálogo é código, se lê inteiro e ganha um
 * produto com uma linha, e um `CHECK` aqui cobraria uma migration por produto
 * novo.
 */

/**
 * Uma proposta recebida de um fornecedor, à espera de veredito.
 *
 * O veredito **não** está guardado. `situacao` diz onde a cotação está no
 * fluxo de quem compra — aguardando, negociando, decidida —, e é isso que a
 * pessoa controla. Se está acima do teto ou dentro dele é conta do motor
 * econômico, refeita a cada leitura sobre a vigência corrente: gravar o
 * veredito o congelaria contra uma remuneração que muda de vigência em
 * vigência, e a tela passaria a mostrar "aprovada" para uma compra que a
 * vigência de hoje já não cobre.
 */
export const compraCotacaoTable = pgTable(
  "compra_cotacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A chave do produto no catálogo de compras. Ver `@workspace/compras`. */
    item: text("item").notNull(),
    /** O que exatamente está sendo comprado — "295/80 R22.5 recapado". */
    descricao: text("descricao"),
    fornecedor: text("fornecedor").notNull(),
    /** O preço por unidade, em reais, como a proposta o traz. */
    precoUnitario: numeric("preco_unitario", {
      precision: 14,
      scale: 2,
    }).notNull(),
    quantidade: integer("quantidade"),
    /**
     * O recorte em que a cotação faz sentido — a operação e a unidade.
     *
     * Texto solto, e não chave estrangeira para `unidade`: a cotação nasce
     * antes de a compra existir, e exigir uma unidade cadastrada para digitar
     * uma proposta transformaria o cadastro num pedágio. Quando vazio, a
     * cotação vale para todo o recorte de quem a lê.
     */
    operacao: text("operacao"),
    unidade: text("unidade"),
    /** AGUARDANDO, EM_NEGOCIACAO, APROVADA ou RECUSADA. */
    situacao: text("situacao").notNull().default("AGUARDANDO"),
    /**
     * Onde está o documento que sustenta o preço.
     *
     * Um caminho, um número de proposta, um link do portal do fornecedor — o
     * que quem digitou puder citar. O Agente de Compras devolve este campo
     * verbatim quando pedem a evidência; ele nunca o interpreta e nunca o
     * inventa.
     */
    evidencia: text("evidencia"),
    /** A validade da proposta, quando o fornecedor a declara. */
    validaAte: timestamp("valida_ate", { withTimezone: true }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appUserTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Excluir é arquivar, como no Assistente e no Book. Nunca há DELETE. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("compra_cotacao_item_idx").on(t.item, t.createdAt),
    index("compra_cotacao_owner_idx").on(t.ownerId, t.createdAt),
    /*
      Preço zero ou negativo não é proposta: é campo em branco que passou. O
      painel o somaria como economia infinita, e o motor devolveria margem de
      100% com cara de conta.
    */
    check("compra_cotacao_preco_ck", sql`${t.precoUnitario} > 0`),
    check(
      "compra_cotacao_quantidade_ck",
      sql`${t.quantidade} IS NULL OR ${t.quantidade} > 0`,
    ),
    check(
      "compra_cotacao_situacao_ck",
      sql`${t.situacao} IN ('AGUARDANDO', 'EM_NEGOCIACAO', 'APROVADA', 'RECUSADA')`,
    ),
  ],
);

/**
 * As premissas de um item — o que o export não traz e a conta precisa.
 *
 * Vida útil e unidades por ativo decidem o preço-alvo tanto quanto a
 * remuneração decide: dezoito meses ou trinta e seis mudam o teto pela metade.
 * O export da Ambev não traz nenhuma das duas — traz a medida do pneu, não o
 * ciclo de troca —, e o catálogo oferece um padrão **estimado** para que a
 * pergunta tenha resposta no primeiro dia.
 *
 * Uma linha aqui é a operação dizendo: *esta é a minha, e ela é confirmada*. É
 * a diferença entre um preço-alvo de confiabilidade BAIXA e um de ALTA, e é o
 * caminho pelo qual o Agente de Compras deixa de depender de estimativa sem
 * ninguém precisar tocar em código.
 *
 * A política — margem-alvo e margem mínima — mora aqui pelo mesmo motivo, e
 * nula quer dizer "use a da instalação". Ela é decisão comercial por item: a
 * margem que se aceita num pneu não é a que se aceita num contrato de
 * manutenção.
 */
export const compraPremissaTable = pgTable(
  "compra_premissa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item: text("item").notNull(),
    /**
     * A operação a que esta premissa pertence, ou nulo para todas.
     *
     * Vazio é o padrão da casa; preenchido, ele vence sobre o padrão na
     * operação que nomeia. Duas linhas para o mesmo par não existem — ver o
     * índice único abaixo.
     */
    operacao: text("operacao"),
    vidaUtilMeses: integer("vida_util_meses"),
    unidadesPorAtivo: integer("unidades_por_ativo"),
    /** Frações de 0 a 1. Nulas usam a política da instalação. */
    margemAlvo: numeric("margem_alvo", { precision: 5, scale: 4 }),
    margemMinima: numeric("margem_minima", { precision: 5, scale: 4 }),
    /** Por que estes números. É o que a resposta cita ao listar as premissas. */
    justificativa: text("justificativa"),
    atualizadoPor: uuid("atualizado_por")
      .notNull()
      .references(() => appUserTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /*
      Uma premissa por item e operação. `COALESCE` porque `NULL` não colide com
      `NULL` num índice único comum, e duas linhas "para todas as operações" do
      mesmo item seriam duas verdades sobre a vida útil de um pneu — a leitura
      pegaria uma das duas conforme a ordem do plano.
    */
    uniqueIndex("compra_premissa_item_operacao_uq").on(
      t.item,
      sql`COALESCE(${t.operacao}, '')`,
    ),
    check(
      "compra_premissa_vida_ck",
      sql`${t.vidaUtilMeses} IS NULL OR ${t.vidaUtilMeses} > 0`,
    ),
    check(
      "compra_premissa_unidades_ck",
      sql`${t.unidadesPorAtivo} IS NULL OR ${t.unidadesPorAtivo} > 0`,
    ),
    /*
      Margem fora de (0,1) produz preço-alvo negativo ou maior que o valor
      econômico — os dois casos em que o motor reprovaria ou aprovaria toda
      compra com cara de conta. O motor já se defende disso em código; o banco
      se defende aqui para que o defeito não chegue a ser gravado.
    */
    check(
      "compra_premissa_margem_alvo_ck",
      sql`${t.margemAlvo} IS NULL OR (${t.margemAlvo} > 0 AND ${t.margemAlvo} < 1)`,
    ),
    check(
      "compra_premissa_margem_minima_ck",
      sql`${t.margemMinima} IS NULL OR (${t.margemMinima} > 0 AND ${t.margemMinima} < 1)`,
    ),
  ],
);
