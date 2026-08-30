/**
 * Quem carrega o dinheiro de quem, dentro de uma comparação.
 *
 * A regra de escopo de conjunto é por ativo — só sai a coluna da carreta cujo
 * cavalo vinculado mudou nesta mesma comparação —, e por isso ela precisa do
 * vínculo resolvido em ids, não em placas. Esta é a única leitura que o
 * `@workspace/comparison` faz do vínculo, e ela existe para que
 * `deduplicacao.ts` continue puro: a regra não conhece banco, e o banco não
 * conhece a regra.
 *
 * O vínculo é lido **na vigência da comparação**, e não do cadastro atual: uma
 * carreta troca de cavalo entre um mês e outro, e usar o vínculo de hoje para
 * deduplicar março atribuiria o dinheiro ao par errado.
 */

import { inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { changeSetTable, factTable } from "@workspace/db";
import { indexarVinculos, SEM_VINCULOS, type VinculosDeConjunto } from "./deduplicacao";
import { ESCOPOS_DE_CONJUNTO, PARES_DE_CONJUNTO } from "./composition";

/**
 * O atributo que declara o par — lido da autoridade, e não repetido aqui.
 *
 * Era um literal nesta linha, e outro igual em `tipos-da-vigencia.ts`, e um
 * terceiro na leitura de composição. Agora é `PARES_DE_CONJUNTO`, ao lado de
 * `ESCOPOS_DE_CONJUNTO`, que é onde a evidência do vínculo está escrita.
 */
const CODIGO_DO_VINCULO = PARES_DE_CONJUNTO[0]!.code;

/**
 * Os pares (quem recebe → quem está embutido) dos snapshots informados.
 *
 * `SEM_VINCULOS` quando não há snapshot para ler ou quando nenhuma regra de
 * conjunto está declarada — as duas são respostas, e nenhuma delas é um
 * silêncio: um chamador que receba isto está afirmando que esta comparação não
 * tem lado de conjunto.
 */
export async function carregarVinculosDeConjunto(
  executor: Pick<Database, "execute">,
  snapshotIds: string[],
): Promise<VinculosDeConjunto> {
  if (snapshotIds.length === 0 || ESCOPOS_DE_CONJUNTO.length === 0) return SEM_VINCULOS;

  /*
    `is_current` no identificador da carreta e não na do cavalo: o que se
    procura é a entidade que hoje responde por aquela placa. O `DISTINCT`
    existe porque a mesma placa aparece em várias vigências do intervalo, e o
    índice só quer o par uma vez.
  */
  const { rows } = await executor.execute<{
    entity_id: string;
    embute_entity_id: string;
  }>(sql`
    SELECT DISTINCT
           carreta.entity_id::text          AS entity_id,
           "fact".entity_id::text           AS embute_entity_id
      FROM fato_visivel "fact"
      JOIN attribute a ON a.id = "fact".attribute_id
      JOIN entity_identifier carreta
        ON carreta.identifier_type = 'PLACA'
       AND carreta.is_current
       AND carreta.identifier_value = "fact".value_text
      JOIN entity e ON e.id = carreta.entity_id AND e.entity_type = 'CARRETA'
     WHERE a.code = ${CODIGO_DO_VINCULO}
       AND ${inArray(factTable.snapshotId, snapshotIds)}
       AND NOT "fact".is_null
       AND "fact".value_text IS NOT NULL
  `);

  return indexarVinculos(
    rows.map((r) => ({ entityId: r.entity_id, embuteEntityId: r.embute_entity_id })),
  );
}

/** Os snapshots que uma lista de comparações compara — as duas pontas de cada. */
export async function snapshotsDosChangeSets(
  executor: Pick<Database, "execute">,
  changeSetIds: string[],
): Promise<string[]> {
  if (changeSetIds.length === 0) return [];
  const { rows } = await executor.execute<{ snapshot_id: string }>(sql`
    SELECT DISTINCT snapshot_b_id::text AS snapshot_id
      FROM change_set
     WHERE ${inArray(changeSetTable.id, changeSetIds)}
  `);
  return rows.map((r) => r.snapshot_id);
}
