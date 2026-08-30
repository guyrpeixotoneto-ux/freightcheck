/**
 * A presença da vigência — quem estava lá, gravado quando a vigência fecha.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo escreve, e por quê
 * ---------------------------------------------------------------------------
 * Uma linha por par (vigência, entidade), carimbada com a origem do fato. É a
 * matéria-prima de "quantas entidades de cada tipo esta vigência tem" — a
 * pergunta que o seletor de tipos e a Visão Geral fazem a cada carregamento, e
 * que custava 83.241 linhas de `fact` para produzir 18 números (medido em
 * 30/08/2026 sobre o export real: 110 a 172 ms, duas vezes por tela).
 *
 * A escrita **não** guarda a contagem pronta. Guardar o número por vigência
 * seria o desenho do censo do balanço (`0080`), e aqui ele daria número errado:
 * `fato_visivel` esconde o fato pela origem dele, não pela importação do
 * snapshot, e metade dos snapshots do acervo carrega fato herdado de outra
 * importação. Ocultar um arquivo muda a contagem de vigências que não são dele.
 * Por isso o grão é a presença, e a visibilidade fica na leitura — ver
 * `tipos-da-vigencia.ts`, do outro lado.
 *
 * ---------------------------------------------------------------------------
 * Por que aqui, e não do lado de quem lê
 * ---------------------------------------------------------------------------
 * Porque `@workspace/comparison`, que lê, já depende de `@workspace/ingest` — o
 * caminho contrário seria ciclo. Quem escreve é quem promove, e quem promove
 * mora aqui.
 *
 * ---------------------------------------------------------------------------
 * Quando é gravada
 * ---------------------------------------------------------------------------
 * Dentro da transação da promoção, **antes** de o snapshot virar `CLOSED` — a
 * mesma janela e a mesma razão do agregado de cobertura que já é gravado ali:
 * depois do `CLOSED` o gatilho `fact_immutable` congela o que esta leitura lê,
 * e os fatos acabaram de ser escritos, então estão à mão. Na mesma transação,
 * também, para que não exista vigência fechada sem presença nem presença de
 * vigência que não fechou.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * Um `tx` da transação da promoção, ou o `db` — as duas pontas usam o mesmo
 * `execute`, e nomear o mínimo evita amarrar este módulo ao tipo interno do
 * Drizzle para transação, que muda de versão para versão.
 */
type ExecutorSql = Pick<Database, "execute">;

/**
 * Grava a presença de um snapshot a partir dos fatos dele.
 *
 * Apaga e reinsere o próprio snapshot: é o que torna a regravação idempotente
 * sem depender de `ON CONFLICT`, e o que faz um retry da promoção — ou um
 * backfill que roda duas vezes — terminar no mesmo estado em vez de somar.
 *
 * Lê `fact` cru, e não `fato_visivel`, de propósito: o que se registra aqui é o
 * que **aconteceu**, com a origem de cada presença; quem decide o que **conta**
 * é a leitura, que filtra as origens ocultas. Gravar já filtrado congelaria a
 * visibilidade do instante da importação e voltaria a quebrar quando alguém
 * ocultasse um arquivo depois.
 */
export async function gravarPresenca(
  tx: ExecutorSql,
  snapshotId: string,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM snapshot_presenca WHERE snapshot_id = ${snapshotId}::uuid
  `);
  await tx.execute(sql`
    INSERT INTO snapshot_presenca (snapshot_id, entity_id, entity_type, origin_import_run_id)
    SELECT DISTINCT f.snapshot_id, f.entity_id, e.entity_type, f.origin_import_run_id
      FROM fact f
      JOIN entity e ON e.id = f.entity_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
  `);
}

/**
 * Preenche a presença das vigências que ainda não a têm — o backfill.
 *
 * Chamada na partida do servidor, em segundo plano. Um snapshot por vez, e não
 * um `INSERT ... SELECT` sobre o acervo inteiro: o custo do segundo cresce com
 * o histórico, e uma partida que não termina é pior do que uma leitura lenta.
 *
 * Reentrante e interrompível: cada snapshot é uma transação, e o que já entrou
 * não é refeito. Cair no meio custa recomeçar de onde parou, nunca do começo.
 *
 * "Ainda não a tem" é medido pela ausência de linha, e não por um carimbo em
 * `snapshot` — uma coluna nova ali sobreviveria ao `down` do bridge que
 * derrubasse esta tabela, e a leitura passaria a confiar num vazio que não é
 * vazio. Um snapshot promovido sempre tem pelo menos uma entidade, então
 * "nenhuma linha" e "nunca preenchido" são a mesma coisa aqui, e é o que faz a
 * ausência ser resposta suficiente.
 *
 * @returns quantas vigências foram preenchidas nesta passada.
 */
export async function preencherPresencasPendentes(
  db: Database,
): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT s.id
      FROM snapshot s
     WHERE s.status <> 'DRAFT'
       AND NOT EXISTS (SELECT 1 FROM snapshot_presenca p WHERE p.snapshot_id = s.id)
       AND EXISTS (SELECT 1 FROM fact f WHERE f.snapshot_id = s.id)
     ORDER BY s.effective_date
  `);

  let feitas = 0;
  for (const { id } of rows) {
    await gravarPresenca(db, id);
    feitas += 1;
  }
  return feitas;
}
