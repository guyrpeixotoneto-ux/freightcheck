import { sql, type SQL } from "drizzle-orm";
import { changeTable, factTable } from "./schema";

/**
 * Quando um fato conta — a mesma regra que a view `fato_visivel` aplica.
 *
 * A view (`0061`) é a definição, e é por onde passa toda leitura escrita em SQL
 * cru. Este predicado existe para o punhado de consultas montadas pelo query
 * builder, onde trocar a tabela pela view exigiria um segundo modelo de `fact`
 * só para elas — e dois modelos da mesma tabela são duas verdades esperando
 * divergir.
 *
 * As duas formas dizem a mesma coisa, e é isso que `fato-visivel.test.ts`
 * prende: sobre o mesmo banco, contar por aqui e contar pela view tem de dar o
 * mesmo número. Se um dia não der, é porque a regra passou a morar em dois
 * lugares — que é exatamente o que este arquivo existe para evitar.
 */
export const FATO_DE_ORIGEM_VISIVEL: SQL = sql`${factTable.originImportRunId} NOT IN (
  SELECT ir.id FROM import_run ir WHERE ir.hidden_at IS NOT NULL
)`;

/**
 * Quando uma alteração conta — a mesma regra que a view `alteracao_visivel`
 * aplica, pelos mesmos motivos do predicado acima.
 *
 * Uma alteração cita dois fatos, e nulo não esconde: os eixos de entidade e de
 * atributo (entrou, saiu) não têm fato dos dois lados, e o `NOT EXISTS` só
 * alcança a linha que existe e nasceu oculta.
 */
export const ALTERACAO_DE_ORIGEM_VISIVEL: SQL = sql`(
  (${changeTable.factAId} IS NULL OR ${changeTable.factAId} NOT IN (SELECT id FROM fato_oculto))
  AND
  (${changeTable.factBId} IS NULL OR ${changeTable.factBId} NOT IN (SELECT id FROM fato_oculto))
)`;
