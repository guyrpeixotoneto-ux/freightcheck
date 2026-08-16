import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * O denominador que se perde, e o caminho de volta.
 *
 * `snapshot_entity_type` é o único insumo da matriz que não é lido da vigência:
 * ele é **contado** uma vez, na promoção, e guardado. Por isso a cobertura
 * consegue abrir com a fact table em milhões de linhas — e por isso ela tem um
 * modo de falha que nenhuma outra tela do produto tem: a vigência continua
 * inteira no banco e a medição dela desaparece.
 *
 * O estado é real e foi visto na tela. Todas as vigências ativas presentes, o
 * seletor de unidade mostrando Camaçari com a vigência de ago/2026, e Cobertura
 * de dados anunciando "nenhuma vigência importada ainda" — porque `linhas` volta
 * vazia quando **nenhuma** vigência tem agregado, e vazia é indistinguível de
 * "não há nada" para quem só olha o tamanho da lista.
 *
 * Como a tabela se esvazia sem que ninguém apague dado:
 *
 * - o `down` do bridge a descarta de propósito (`TABELAS_DERIVADAS`), porque
 *   cada linha dela é uma contagem refazível, e o `up` só a repovoa se a
 *   `0021_cobertura` estiver **registrada** no banco — num banco cujo registro
 *   parou antes dela, a estrutura volta e o conteúdo fica para a fila;
 * - uma vigência promovida por um caminho que não passou pelo `INSERT` da
 *   promoção — ou promovida antes de a `0021` existir, num banco onde o
 *   backfill dela não chegou a rodar.
 *
 * Em nenhum desses casos há dado perdido: a contagem sai de `fact`, que está
 * lá. O que faltava era alguém capaz de refazê-la sem uma migration nova, e é
 * isso — e só isso — que este arquivo é.
 *
 * **Não é uma segunda autoridade sobre cobertura.** Ele não mede nada, não
 * classifica nada e não decide o que é esperado. Ele restaura uma contagem
 * cujo valor correto é definido em outro lugar (`promote`, em
 * `lib/ingest/src/pipeline.ts`), e o teste `agregado.test.ts` existe para provar
 * que o número que ele escreve é o mesmo que a promoção teria escrito.
 */

/** Uma vigência que tem fato e não tem agregado. */
export interface VigenciaSemAgregado {
  snapshotId: string;
  sourceLabel: string;
  effectiveDate: string;
  status: string;
  /** Fatos que ela carrega — a prova de que há o que contar. */
  fatos: number;
}

/**
 * As vigências cuja medição sumiu.
 *
 * O predicado é "tem fato e não tem linha em `snapshot_entity_type`", e as duas
 * metades importam. Sem a primeira, uma vigência legitimamente vazia entraria na
 * lista e o reparo prometeria consertar o que não está quebrado; sem a segunda,
 * a lista seria o inventário de vigências, não o das que perderam a conta.
 *
 * Inclui as SUPERSEDED de propósito, pela mesma razão que o backfill da `0021`
 * as inclui: a matriz só lê as ativas, mas o histórico de uma lacuna precisa
 * responder "o que a revisão anterior tinha" sem varrer a fact table.
 */
export async function vigenciasSemAgregado(db: Database): Promise<VigenciaSemAgregado[]> {
  const { rows } = await db.execute<{
    id: string;
    source_label: string;
    effective_date: string;
    status: string;
    fatos: number;
  }>(sql`
    SELECT s.id,
           s.source_label,
           s.effective_date::text AS effective_date,
           s.status::text         AS status,
           count(f.id)::int       AS fatos
      FROM snapshot s
      JOIN fact f ON f.snapshot_id = s.id
     WHERE NOT EXISTS (
             SELECT 1 FROM snapshot_entity_type a WHERE a.snapshot_id = s.id
           )
     GROUP BY s.id, s.source_label, s.effective_date, s.status
     ORDER BY s.effective_date, s.source_label
  `);

  return rows.map((r) => ({
    snapshotId: r.id,
    sourceLabel: r.source_label,
    effectiveDate: r.effective_date,
    status: r.status,
    fatos: Number(r.fatos),
  }));
}

export interface ReparoDoAgregado {
  /** Vigências que estavam sem agregado quando o reparo começou. */
  vigencias: number;
  /** Linhas (vigência × equipamento) escritas. */
  linhas: number;
  /** Os rótulos, para a tela poder dizer quais foram. */
  rotulos: string[];
}

/**
 * Refaz o agregado das vigências que o perderam. Idempotente.
 *
 * **Só escreve onde não há nada.** O `WHERE` restringe às vigências sem
 * nenhuma linha e o `ON CONFLICT DO NOTHING` é a segunda tranca: um agregado
 * existente nunca é sobrescrito por este caminho. A distinção é o que separa
 * "restaurar uma contagem perdida" de "recontar a base" — a segunda operação é
 * legítima, é cara, e não é esta.
 *
 * A contagem é a mesma da promoção, campo por campo, e o teste que as compara
 * é o que impede as duas de divergirem. Ela varre `fact` pelas vigências
 * atingidas, que é exatamente o custo que a promoção paga uma vez e que a
 * matriz nunca paga — aceitável aqui porque isto roda por pedido explícito,
 * numa rota `POST`, e não em toda abertura de tela.
 */
export async function refazerAgregado(db: Database): Promise<ReparoDoAgregado> {
  const pendentes = await vigenciasSemAgregado(db);
  if (pendentes.length === 0) return { vigencias: 0, linhas: 0, rotulos: [] };

  const ids = sql.join(
    pendentes.map((v) => sql`${v.snapshotId}::uuid`),
    sql`, `,
  );

  const { rowCount } = await db.execute(sql`
    INSERT INTO snapshot_entity_type (
      snapshot_id, entity_type, entity_count, attribute_count,
      fact_count, value_count, null_count, inherited_fact_count
    )
    SELECT f.snapshot_id,
           e.entity_type,
           count(DISTINCT f.entity_id)::int,
           count(DISTINCT f.attribute_id)::int,
           count(*)::int,
           count(*) FILTER (WHERE NOT f.is_null)::int,
           count(*) FILTER (WHERE f.is_null)::int,
           count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL)::int
      FROM fact f
      JOIN entity e ON e.id = f.entity_id
     WHERE f.snapshot_id IN (${ids})
     GROUP BY f.snapshot_id, e.entity_type
        ON CONFLICT (snapshot_id, entity_type) DO NOTHING
  `);

  return {
    vigencias: pendentes.length,
    linhas: rowCount ?? 0,
    rotulos: [...new Set(pendentes.map((v) => v.sourceLabel))],
  };
}
