import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * A classificação de cada célula, em SQL — e o único lugar onde ela existe.
 *
 * Saiu de `balanco.ts` para cá quando o censo por importação
 * (`censo.ts`) passou a precisar exatamente da mesma consulta: uma para
 * gravar, outra para ler o detalhe de uma importação. Duas cópias do `CASE`
 * que decide o destino de uma célula divergiriam no primeiro ramo que alguém
 * acrescentasse a uma e não à outra — e a divergência apareceria como um
 * número menor na tela, sem erro nenhum.
 */

export const RECUSAS_DE_LINHA = [
  "ROW_MISSING_GRAIN_KEY",
  "UNPARSEABLE_VIGENCIA_LABEL",
];

/**
 * A classificação de cada célula, em SQL, num lugar só.
 *
 * O `CASE` abaixo é a ordem declarada em `destinos.ts`, e as duas precisam
 * continuar iguais — há teste. Ele é montado como fragmento porque três
 * consultas diferentes precisam da mesma classificação (o total, a quebra por
 * aba e as amostras): reescrevê-lo em cada uma seria garantir que um dia elas
 * discordem, e três telas discordando sobre para onde foi a mesma célula é pior
 * que não ter a tela.
 */
export function classificacao(importRunId?: string): SQL {
  const filtro = importRunId
    ? sql`WHERE s.import_run_id = ${importRunId}::uuid`
    : sql``;

  return sql`
    WITH aba AS (
      SELECT s.id, s.import_run_id, s.sheet_name, s.sheet_index, s.role, s.role_reason
      FROM raw_sheet s
      ${filtro}
    ),
    celula AS (
      SELECT
        c.id,
        a.import_run_id AS run_id,
        a.id            AS aba_id,
        a.role          AS aba_role,
        r.id            AS linha_id,
        r.is_header,
        c.column_index,
        c.raw_value
      FROM aba a
      JOIN raw_row r  ON r.raw_sheet_id = a.id
      JOIN raw_cell c ON c.raw_row_id = r.id
    ),
    preparado AS (
      SELECT sf.raw_cell_id AS celula_id, count(*)::int AS fatos
      FROM staged_fact sf
      WHERE sf.import_run_id IN (SELECT DISTINCT import_run_id FROM aba)
      GROUP BY sf.raw_cell_id
    ),
    linha_em_branco AS (
      SELECT linha_id
      FROM celula
      GROUP BY linha_id
      HAVING bool_and(raw_value IS NULL OR btrim(raw_value) = '')
    ),
    linha_recusada AS (
      SELECT DISTINCT vi.raw_row_id AS linha_id
      FROM validation_issue vi
      WHERE vi.raw_row_id IS NOT NULL
        AND vi.code IN (${sql.join(
          RECUSAS_DE_LINHA.map((code) => sql`${code}`),
          sql`, `,
        )})
        AND vi.import_run_id IN (SELECT DISTINCT import_run_id FROM aba)
    ),
    aba_sem_grao AS (
      SELECT a.id AS aba_id
      FROM aba a
      WHERE a.role = 'SOURCE'
        AND NOT EXISTS (
          SELECT 1
          FROM celula c
          JOIN preparado p ON p.celula_id = c.id
          WHERE c.aba_id = a.id
        )
    ),
    classificada AS (
      SELECT
        c.id,
        c.run_id,
        c.aba_id,
        c.linha_id,
        c.column_index,
        CASE
          WHEN p.celula_id IS NOT NULL   THEN 'FATO_PREPARADO'
          WHEN c.aba_role <> 'SOURCE'    THEN 'ABA_DE_APOIO'
          WHEN c.is_header               THEN 'CABECALHO'
          WHEN lb.linha_id IS NOT NULL   THEN 'LINHA_EM_BRANCO'
          WHEN lr.linha_id IS NOT NULL   THEN 'LINHA_RECUSADA'
          WHEN cm.id IS NULL             THEN 'COLUNA_SEM_CABECALHO'
          WHEN cm.status = 'AMBIGUOUS'   THEN 'COLUNA_AMBIGUA'
          WHEN cm.status = 'IGNORED'     THEN 'COLUNA_DE_GRAO'
          WHEN asg.aba_id IS NOT NULL    THEN 'ABA_SEM_GRAO'
          ELSE 'SEM_DESTINO'
        END AS destino
      FROM celula c
      LEFT JOIN preparado p        ON p.celula_id = c.id
      LEFT JOIN linha_em_branco lb ON lb.linha_id = c.linha_id
      LEFT JOIN linha_recusada lr  ON lr.linha_id = c.linha_id
      LEFT JOIN column_mapping cm  ON cm.raw_sheet_id = c.aba_id
                                  AND cm.column_index = c.column_index
      LEFT JOIN aba_sem_grao asg   ON asg.aba_id = c.aba_id
    )
  `;
}

/**
 * Roda uma consulta do balanço com o JIT do Postgres desligado, e só ela.
 *
 * ---------------------------------------------------------------------------
 * Por que esta consulta específica precisa disso
 * ---------------------------------------------------------------------------
 *
 * `classificacao()` custa **1.036ms**, e 690 deles são o Postgres compilando a
 * consulta em vez de executá-la. Com o JIT desligado a mesma consulta, com o
 * mesmo plano e o mesmo resultado, responde em **347ms**. Medido com
 * `EXPLAIN (ANALYZE, BUFFERS)` sobre o acervo real (85.813 células, 83.241
 * fatos preparados).
 *
 * O gatilho é uma estimativa errada, não o tamanho do trabalho. O planejador
 * avalia a junção entre `preparado` e `celula` em **100.016.143 linhas** —
 * exatamente `240.305 × 83.241 / 200` — quando o resultado real são 85.813. O
 * `200` é o palpite padrão do Postgres para o número de valores distintos de
 * uma coluna de CTE: ele não tem estatística de `preparado.celula_id` e não
 * sabe que a coluna é única. Com a estimativa mil vezes maior, o custo estimado
 * passa de 14 milhões, cruza o `jit_above_cost` (100.000) por larga margem, e o
 * Postgres decide compilar uma consulta que roda em um terço de segundo.
 *
 * ---------------------------------------------------------------------------
 * Por que é isto, e não outra coisa
 * ---------------------------------------------------------------------------
 *
 * As alternativas foram testadas e nenhuma resolve:
 *
 * - `NOT MATERIALIZED` na CTE `preparado`: estimativa idêntica (100.016.143) e
 *   execução **pior** — 1.160ms, porque a CTE é referenciada duas vezes e passa
 *   a ser avaliada duas vezes.
 * - Trocar o `GROUP BY` por `SELECT DISTINCT` (a contagem `fatos` nunca é
 *   lida): estimativa idêntica, 1.060ms. O Postgres não propaga unicidade
 *   através de uma CTE, seja qual for a forma.
 *
 * Sobra desligar o JIT — e **só aqui**. `ALTER DATABASE … SET jit = off`
 * resolveria esta consulta e mudaria o plano de todas as outras do produto,
 * incluindo as que não foram medidas; `SET LOCAL` vale até o fim desta
 * transação e não atravessa nem para a próxima consulta da mesma conexão.
 *
 * Uma transação por consulta, e não uma para todas: `balancoDaImportacao`
 * dispara cinco leituras em `Promise.all`, e uma transação só as serializaria
 * numa conexão — trocaria o ganho do JIT pelo custo do paralelismo perdido.
 *
 * Se o Postgres desta publicação já vier com `jit = off`, isto não faz nada:
 * desligar o que já está desligado é uma linha a mais no log e nenhum efeito.
 */
export async function semJit<T extends Record<string, unknown>>(
  db: Database,
  consulta: SQL,
): Promise<{ rows: T[] }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL jit = off`);
    const { rows } = await tx.execute<T>(consulta);
    return { rows: rows as T[] };
  });
}

