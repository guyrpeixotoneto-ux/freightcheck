import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  check,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { appUserTable } from "./auth";

/**
 * PERMISSÃO — o que cada pessoa alcança, e quem decidiu isso.
 *
 * O schema de `auth.ts` dizia, por escrito, que não havia permissão por tela
 * porque a decisão de produto ainda não tinha sido tomada. Ela foi: um
 * administrador passa a poder dizer, por pessoa e por módulo do menu, se o
 * acesso é de **edição**, **somente leitura** ou **nenhum**.
 *
 * Três decisões estão neste arquivo, e nenhuma é técnica.
 *
 * 1. **A ausência de linha é acesso de edição**, e não bloqueio. É o que toda
 *    conta já tinha antes desta tabela existir; fazer o contrário transformaria
 *    a migration num apagão para todo mundo que estivesse logado. Permissão
 *    aqui é o que se **tira**, e uma linha só existe quando alguém decidiu
 *    tirar algo — por isso a tabela é esparsa, e por isso ler "sem linha" como
 *    "sem acesso" seria ler o silêncio como decisão.
 *
 * 2. **A chave do módulo é o endereço do item no menu** (`/curadoria`,
 *    `/importacoes`). Não há tabela de módulos: o menu é o catálogo, e uma
 *    segunda lista no banco só teria como destino divergir dele. Módulo que sai
 *    do menu deixa a linha órfã, e uma linha órfã não concede nada — ela é
 *    ignorada por quem lê.
 *
 * 3. **Toda mudança fica no histórico, com autor e carimbo.** Mexer no acesso
 *    de alguém é ato administrativo, e ato administrativo sem autor é o que
 *    este produto recusa em todas as outras telas. `permissao_de_modulo` diz o
 *    estado de hoje; `permissao_de_modulo_evento` diz como se chegou nele, e
 *    nunca é apagado.
 */

export const permissaoDeModuloTable = pgTable(
  "permissao_de_modulo",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUserTable.id, { onDelete: "cascade" }),
    /** O `href` do item no menu — ver a decisão 2 acima. */
    modulo: text("modulo").notNull(),
    /** EDITAR, VISUALIZAR ou SEM_ACESSO. */
    nivel: text("nivel").notNull(),
    definidoEm: timestamp("definido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** O e-mail de quem decidiu, no mesmo formato do `actor` do resto. */
    definidoPor: text("definido_por").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.modulo] }),
    index("permissao_de_modulo_user_idx").on(t.userId),
    /*
      Os três níveis também no banco, e não só no código que grava. É a mesma
      razão do default fail-closed de `role`: um INSERT vindo de outro lugar —
      um script, um backfill, um psql — não inventa um quarto nível que a
      interface não sabe ler e o portão não sabe recusar.
    */
    check(
      "permissao_de_modulo_nivel_check",
      sql`${t.nivel} IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO')`,
    ),
  ],
);

/**
 * O histórico, que só cresce.
 *
 * Guarda também o nível anterior porque a pergunta que se faz meses depois não
 * é "o que ficou valendo" — isso a tabela de estado responde — e sim "o que
 * mudou naquele dia". `null` em `nivelAnterior` é a primeira decisão sobre
 * aquele par pessoa+módulo, que até então valia o padrão (edição).
 */
export const permissaoDeModuloEventoTable = pgTable(
  "permissao_de_modulo_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUserTable.id, { onDelete: "cascade" }),
    modulo: text("modulo").notNull(),
    nivelAnterior: text("nivel_anterior"),
    nivel: text("nivel").notNull(),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
    por: text("por").notNull(),
  },
  (t) => [
    index("permissao_de_modulo_evento_user_idx").on(t.userId),
    index("permissao_de_modulo_evento_em_idx").on(t.em),
    check(
      "permissao_de_modulo_evento_nivel_check",
      sql`${t.nivel} IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO')`,
    ),
  ],
);
