import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { changeSetTable } from "./comparison";

/**
 * O LOTE — o registro de **qual universo** uma justificativa em lote alcançou.
 *
 * ---------------------------------------------------------------------------
 * Por que uma tabela, e não uma coluna em `justificativa`
 * ---------------------------------------------------------------------------
 * Porque o que se quer registrar não é um atributo de cada linha: é o gesto que
 * produziu todas elas. Quem clica em "Selecionar todos os 206 resultados" e
 * aplica uma frase não escolheu 206 alterações — escolheu um **recorte**, e a
 * pergunta que alguém vai fazer daqui a seis meses é sobre ele: *o que essa
 * frase alcançou, e por quê?* Guardada como coluna repetida em 206 linhas, a
 * resposta seria 206 cópias do mesmo recorte, sem nada dizendo que elas são um
 * ato só — e sem lugar para o que é do ato e não da linha: quantas já estavam
 * justificadas, quantas foram preservadas, quantas foram substituídas.
 *
 * `justificativa.lote_id` aponta para cá, e é nulo em tudo que foi escrito uma
 * a uma — que continua sendo o caminho normal e o mais comum. O nulo aqui
 * significa exatamente isto, e não "não se sabe".
 *
 * ---------------------------------------------------------------------------
 * `recorte` é o objeto, `descricao` é a frase
 * ---------------------------------------------------------------------------
 * Os dois, e não um: o `jsonb` é exato e ilegível — é ele que permite reabrir o
 * mesmo universo —, e a frase é o que uma pessoa confere contra a tela sem
 * decodificar nada. Uma sem a outra deixaria a auditoria dependendo ou de quem
 * sabe ler JSON, ou de uma frase que ninguém pode verificar.
 *
 * ---------------------------------------------------------------------------
 * As contagens são do momento da gravação
 * ---------------------------------------------------------------------------
 * `alteracoes_no_universo`, `aplicadas`, `preservadas` e `sobrescritas` são o
 * retrato do que aconteceu — não se recalculam, e não devem bater com uma
 * contagem feita hoje sobre o mesmo filtro: a vigência pode ter sido
 * recalculada, e alterações podem ter sido justificadas depois. É o ponto: o
 * registro é do ato, na hora dele.
 */
export const justificativaLoteTable = pgTable(
  "justificativa_lote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changeSetId: uuid("change_set_id")
      .notNull()
      .references(() => changeSetTable.id, { onDelete: "cascade" }),
    /** `SELECAO` (a lista escolhida a dedo) ou `FILTRO` (o recorte inteiro). */
    escopo: text("escopo").notNull(),
    /** O escopo como a requisição o trouxe, já validado — ver `EscopoDoLote`. */
    recorte: jsonb("recorte").notNull(),
    /** O mesmo universo em português — ver `descreverEscopoDoLote`. */
    descricao: text("descricao").notNull(),
    /** Quantas alterações justificáveis o universo tinha quando o lote rodou. */
    alteracoesNoUniverso: integer("alteracoes_no_universo").notNull(),
    /** Quantas receberam a justificativa. */
    aplicadas: integer("aplicadas").notNull(),
    /** Quantas já estavam justificadas e **não** foram tocadas. */
    preservadas: integer("preservadas").notNull(),
    /** Quantas já estavam justificadas e foram substituídas — só com aval. */
    sobrescritas: integer("sobrescritas").notNull(),
    /**
     * Quem pediu a substituição — o pedido, não o efeito.
     *
     * Verdadeiro com `sobrescritas = 0` é um desfecho possível e honesto:
     * alguém autorizou substituir, e nenhuma das linhas do universo tinha
     * justificativa anterior.
     */
    sobrescrever: boolean("sobrescrever").notNull().default(false),
    /** Nunca nulo: um lote sem autor não é auditável. */
    criadoPor: text("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("justificativa_lote_change_set_idx").on(t.changeSetId)],
);
