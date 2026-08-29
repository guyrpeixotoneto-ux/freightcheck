import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { classificacao, semJit } from "./classificacao";

/**
 * O censo de destinos de **uma** importação, gravado quando ela termina.
 *
 * ---------------------------------------------------------------------------
 * O problema que este arquivo resolve
 * ---------------------------------------------------------------------------
 *
 * `listarBalancos` respondia a "a massa fecha em cada importação?" varrendo o
 * acervo inteiro de células cruas a cada requisição. Medido em 29/08/2026,
 * sobre 12 importações e 6 unidades:
 *
 * | | |
 * |---|--:|
 * | Linhas lidas do Postgres por requisição | **1.022.946** |
 * | das quais `raw_cell` (varredura completa) | 514.878 |
 * | das quais `staged_fact` (varredura completa) | 499.446 |
 * | Resposta | **2,5 KB** |
 * | Latência quente | **2.267 ms** |
 *
 * O custo não é do tamanho da resposta nem do número de importações mostradas:
 * é do **histórico inteiro de células já importadas**. Cada importação nova o
 * aumenta, para sempre, e ninguém que abre o Resumo executivo pediu por ele —
 * a tela usa a resposta para um cartão de percentual de cobertura.
 *
 * ---------------------------------------------------------------------------
 * Por que gravar é exato, e não uma aproximação
 * ---------------------------------------------------------------------------
 *
 * Porque **a classificação de uma célula não depende de nenhuma outra
 * importação**. Cada entrada de `classificacao()` é escopada ao run:
 *
 * | CTE | de onde vem | escopo |
 * |---|---|---|
 * | `aba` | `raw_sheet` | do run |
 * | `celula` | `raw_row` ⋈ `raw_cell` das abas do run | do run |
 * | `preparado` | `staged_fact WHERE import_run_id IN (…)` | do run |
 * | `linha_em_branco` | derivada de `celula` | do run |
 * | `linha_recusada` | `validation_issue WHERE import_run_id IN (…)` | do run |
 * | `aba_sem_grao` | derivada de `aba`, `celula`, `preparado` | do run |
 * | `column_mapping` | por `raw_sheet_id` | do run |
 *
 * Conferido, e não deduzido: rodar `classificacao()` sem filtro e rodá-la uma
 * vez por importação produz **as mesmas 36 linhas**, idênticas
 * (`__tests__/censo-decomposicao.test.ts`). É isso que torna a soma dos censos
 * gravados igual — e não parecida — ao que a varredura global calculava.
 *
 * ---------------------------------------------------------------------------
 * Quando gravar, e por que só aí
 * ---------------------------------------------------------------------------
 *
 * No fim de `stage()`, e o motivo é que **é ali que a última entrada da conta
 * para de mudar**:
 *
 * - `raw_sheet`, `raw_row` e `raw_cell` são escritas por `captureRaw()` e são
 *   **imutáveis por trigger** (`freightcheck_raw_is_immutable`): UPDATE e
 *   DELETE são recusados com `restrict_violation`, e a única exceção é o purge
 *   de exclusão de importação, que leva o run junto.
 * - `column_mapping`, `staged_fact` e as duas recusas de linha
 *   (`ROW_MISSING_GRAIN_KEY`, `UNPARSEABLE_VIGENCIA_LABEL`) são escritas por
 *   `stage()`. Nenhum caminho do produto as apaga ou atualiza depois —
 *   conferido: não existe `delete(stagedFactTable)`, `delete(columnMappingTable)`
 *   nem `delete(validationIssueTable)` em lugar nenhum de `lib/ingest`.
 * - `promote()` escreve `fact` e `snapshot`, que **não entram** nesta conta.
 * - O único outro emissor de `validation_issue` é `recordChassisIdentifiers`,
 *   e o código dele é `ENTITY_IDENTIFIER_CONFLICT` — que não é uma das duas
 *   recusas de linha que a classificação lê.
 *
 * Depois de `stage()`, portanto, o censo de um run é uma constante. Gravá-lo
 * não é cache: é registro de um fato que não muda mais.
 *
 * ---------------------------------------------------------------------------
 * O que **não** invalida o censo
 * ---------------------------------------------------------------------------
 *
 * - **Ocultar/reexibir uma importação.** `hidden_at` é filtro de *leitura* —
 *   `listarBalancos` já escolhe quais runs mostrar; o censo de cada um segue
 *   igual. Reexibir devolve a linha sem recalcular nada.
 * - **Promover.** Não toca em nenhuma entrada da conta.
 * - **Curar uma semântica.** Idem: semântica é etapa 3 do balanço, e a etapa 3
 *   não passa por aqui.
 * - **Nova importação.** É outro run, com censo próprio.
 *
 * E o que invalida:
 *
 * - **Excluir a importação.** O purge apaga as linhas de RAW e o próprio run;
 *   a `ON DELETE CASCADE` desta tabela leva o censo junto.
 * - **Reprocessar.** Um reprocessamento é um **run novo** (`reprocess_of_run_id`
 *   aponta para o anterior), com raw próprio e censo próprio. O run anterior
 *   continua com o censo dele, que continua verdadeiro sobre o que ele fez.
 *
 * ---------------------------------------------------------------------------
 * Idempotência, retry e dupla contagem
 * ---------------------------------------------------------------------------
 *
 * `gravarCenso` apaga as linhas do run e regrava, **na mesma transação**. Rodar
 * duas vezes sobre o mesmo run deixa exatamente o mesmo estado — que é o que
 * um retry de `stage()` precisa. Não há caminho em que uma célula seja contada
 * duas vezes: a contagem sai de um `GROUP BY` sobre `raw_cell.id`, e o
 * `DELETE` anterior garante que nenhuma linha antiga sobreviva à regravação.
 *
 * A marca de "já recenseado" são as próprias linhas, e não uma coluna à parte.
 * Isso só é honesto porque "recenseado, e deu zero célula" não existe: uma
 * importação só chega a `stage()` depois de ler pelo menos uma célula, então um
 * run recenseado tem sempre pelo menos uma linha aqui. Nenhuma linha é, sem
 * ambiguidade, "ainda não recenseado" — e o pior que acontece com um run que
 * (por algum caminho que hoje não existe) recenseasse em zero é ele voltar a
 * ser calculado ao vivo, que devolve o mesmo número.
 */

/** Grava (ou regrava) o censo de uma importação. Idempotente. */
export async function gravarCenso(db: Database, importRunId: string): Promise<void> {
  await db.transaction(async (tx) => {
    /*
      O JIT desligado pela mesma razão do resto do módulo (ver `semJit`): a
      estimativa da junção com a CTE `preparado` é ordens de grandeza maior que
      a realidade, e o Postgres compila uma consulta que roda em fração de
      segundo. Aqui já estamos numa transação, então é `SET LOCAL` direto.
    */
    await tx.execute(sql`SET LOCAL jit = off`);
    await tx.execute(sql`
      DELETE FROM import_run_censo WHERE import_run_id = ${importRunId}::uuid
    `);
    await tx.execute(sql`
      ${classificacao(importRunId)}
      INSERT INTO import_run_censo (import_run_id, destino, celulas)
      SELECT run_id, destino, count(*)::int
      FROM classificada
      GROUP BY run_id, destino
    `);
  });
}

/**
 * Recenseia as importações que ainda não foram — e devolve quantas.
 *
 * É o backfill do histórico, e é reentrante: roda de novo sem refazer o que já
 * está feito. Chamado pela partida do servidor e disponível como CLI
 * (`pnpm --filter @workspace/balance run recensear`).
 *
 * Uma por vez, e não todas numa transação só: cada uma custa ~176 ms sobre o
 * acervo medido, e uma transação longa sobre `import_run` bloquearia a
 * importação que estiver acontecendo. Perder o backfill no meio não corrompe
 * nada — o que ficou gravado está gravado, e a próxima passada continua de onde
 * parou.
 */
export async function recensearPendentes(db: Database): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT ir.id::text AS id
    FROM import_run ir
    WHERE NOT EXISTS (SELECT 1 FROM import_run_censo c WHERE c.import_run_id = ir.id)
    ORDER BY ir.started_at
  `);
  for (const { id } of rows) await gravarCenso(db, id);
  return rows.length;
}
