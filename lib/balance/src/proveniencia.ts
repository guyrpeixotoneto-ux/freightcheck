import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * De quais importações veio o que esta tela mostra.
 *
 * A cobertura auditada global responde "qual a saúde de todo o acervo". Ela não
 * responde — e não deveria fingir responder — "qual a qualidade das fontes que
 * alimentam o recorte aberto": dentro de uma unidade e de uma vigência, um
 * percentual calculado sobre todas as importações do banco mistura arquivos que
 * não têm relação nenhuma com o que está na tela. Era por isso que PERNAMBUCO e
 * a Visão Geral exibiam a mesma cobertura: ela nunca foi da unidade.
 *
 * Este módulo produz o conjunto de `import_run` de um recorte. Ele **não**
 * atribui célula a unidade, e a distinção é o que torna a regra defensável: não
 * se afirma que uma célula residual "pertence a PERNAMBUCO", e sim que ela
 * pertence a um arquivo que alimentou PERNAMBUCO naquele recorte. Um arquivo que
 * alimenta cinco unidades entra legitimamente na cobertura das cinco — a métrica
 * passa a ser *qualidade das fontes deste recorte*, não uma partição exclusiva
 * da massa.
 */

/**
 * As importações que de fato trouxeram os fatos destes snapshots.
 *
 * **`fact.origin_import_run_id`, nunca `snapshot.import_run_id`.** O segundo é
 * um valor só por vigência e vira o da última revisão que a tocou: numa revisão
 * parcial — o arquivo que corrige só os cavalos e herda as carretas — ele
 * atribuiria as carretas ao arquivo que não as trouxe e deixaria de fora o
 * arquivo que de fato alimentou aquela metade da tela. A coluna de origem existe
 * precisamente para sobreviver à herança (ver o comentário dela em
 * `lib/db/src/schema/canonical.ts`), e usá-la aqui é o que faz a proveniência
 * ser da *fonte* e não do *dono da vigência*.
 *
 * Run oculto não entra. É o mesmo predicado de `FATO_DE_ORIGEM_VISIVEL` e da
 * view `fato_visivel`: um fato de origem oculta não é lido por tela nenhuma, e a
 * importação dele não pode entrar por uma porta lateral na cobertura do recorte.
 * Um fato **herdado** de um run que foi ocultado depois também não entra — é
 * exatamente o caso que a origem real alcança e o dono da vigência não.
 *
 * Snapshots `SUPERSEDED` não têm fatos lidos por ninguém; quem chama passa os
 * snapshots vivos do recorte, e a ausência deles cai fora por consequência.
 */
export async function runsDeProveniencia(
  db: Database,
  snapshotIds: readonly string[],
): Promise<string[]> {
  if (snapshotIds.length === 0) return [];

  const { rows } = await db.execute<{ run: string }>(sql`
    SELECT DISTINCT f.origin_import_run_id::text AS run
      FROM fact f
     WHERE f.snapshot_id IN (${sql.join(
       snapshotIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = f.origin_import_run_id
                AND ir.hidden_at IS NOT NULL
           )
     ORDER BY 1
  `);

  return rows.map((r) => r.run);
}

/**
 * Quantas células RAW distintas viraram fato **nestes snapshots**.
 *
 * É a única grandeza deste módulo que é do recorte, e não das fontes dele. A
 * conservação (`listarBalancos`) é do arquivo — resíduo só significa algo ali,
 * porque célula sem destino nunca virou fato e portanto não tem unidade nem
 * vigência a que pertencer. Esta conta é o outro lado: o fato **tem** snapshot,
 * e snapshot tem unidade, canal e vigência.
 *
 * **`fact`, e não `staged_fact`.** O staging é candidato: ele guarda o que a
 * leitura preparou, inclusive o que a promoção não levou. Quem responde "o que
 * é deste recorte" é o promovido, e `fact.raw_cell_id` é `NOT NULL` desde a
 * `0061` — *"every fact points at its originating cell"* —, de modo que a conta
 * não precisa de uma segunda junção até o RAW para existir.
 *
 * **`COUNT(DISTINCT raw_cell_id)`, nunca `count(*)`.** A grade de `fact` é
 * `(snapshot_id, entity_id, attribute_id)`: a mesma célula pode sustentar mais
 * de um fato, e um recorte pode ter mais de um snapshot vivo — `scope_hash` e
 * `canonical_scope` são colunas diferentes, e dois escopos canônicos distintos
 * sob o mesmo `scope_hash` são o caso do CNPJ mascarado que a `0015` descreve.
 * `count(*)` contaria a célula uma vez por fato e devolveria mais células do que
 * o arquivo trouxe — um número que passa de 100% sem nada acusando.
 *
 * Run de origem oculto fica fora, pelo mesmo predicado de
 * {@link runsDeProveniencia}: um fato cuja origem foi ocultada não é lido por
 * tela nenhuma, e não pode entrar por uma porta lateral nesta conta.
 */
export async function celulasEmFato(
  db: Database,
  snapshotIds: readonly string[],
): Promise<number> {
  if (snapshotIds.length === 0) return 0;

  const { rows } = await db.execute<{ celulas: number }>(sql`
    SELECT count(DISTINCT f.raw_cell_id)::int AS celulas
      FROM fact f
     WHERE f.snapshot_id IN (${sql.join(
       snapshotIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = f.origin_import_run_id
                AND ir.hidden_at IS NOT NULL
           )
  `);

  return rows[0]?.celulas ?? 0;
}
