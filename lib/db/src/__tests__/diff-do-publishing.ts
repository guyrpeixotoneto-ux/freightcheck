import type pg from "pg";

/**
 * O diff que o Publishing calcularia entre dois bancos, por categoria.
 *
 * É a mesma comparação que ele faz — introspecção dos dois lados —, reduzida
 * ao que decide se o DDL é seguro: o que ele criaria, o que ele removeria, e o
 * que ele alteraria. Morava dentro de `bridge.test.ts`; saiu para cá quando os
 * cenários de deploy da `0037` precisaram medir o mesmo diff — duas redações
 * da mesma introspecção divergiriam exatamente no objeto que uma delas
 * esquecesse de olhar.
 */
export async function diffDoPublishing(dev: pg.Pool, prod: pg.Pool) {
  const ler = async (p: pg.Pool, sql: string) => {
    const { rows } = await p.query<{ k: string; v: string }>(sql);
    return new Map(rows.map((r) => [r.k, r.v]));
  };
  const COLS = `SELECT c.table_name||'.'||c.column_name AS k,
      c.data_type||'|'||c.is_nullable||'|'||coalesce(c.column_default,'-') AS v
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema
       AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
     WHERE c.table_schema='public'`;
  const TBL = `SELECT table_name AS k, 'x' AS v FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'`;
  const IDX = `SELECT indexname AS k, indexdef AS v FROM pg_indexes WHERE schemaname='public'`;
  const CON = `SELECT conname AS k, contype::text||' '||pg_get_constraintdef(oid) AS v
                 FROM pg_constraint WHERE connamespace='public'::regnamespace`;

  // Views, funções e colunas geradas entram na conta de propósito: são
  // exatamente o que um diff de schema não modela, e portanto o que passaria
  // despercebido numa comparação que só olhasse tabela e coluna.
  const VW = `SELECT viewname AS k, md5(definition) AS v FROM pg_views WHERE schemaname='public'`;
  const FN = `SELECT p.oid::regprocedure::text AS k, 'fn' AS v FROM pg_proc p
               WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'freightcheck%'`;
  const GEN = `SELECT k.relname||'.'||a.attname AS k, a.attgenerated::text AS v
                 FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid
                  AND k.relnamespace='public'::regnamespace
                WHERE a.attgenerated <> '' AND NOT a.attisdropped`;

  const saida = { addTable: [] as string[], addColumn: [] as string[],
                  addIndex: [] as string[], addConstraint: [] as string[],
                  addView: [] as string[], addFunction: [] as string[],
                  addGenerated: [] as string[],
                  drop: [] as string[], alter: [] as string[] };

  for (const [sql, destinoAdd] of [
    [TBL, saida.addTable], [COLS, saida.addColumn],
    [IDX, saida.addIndex], [CON, saida.addConstraint],
    [VW, saida.addView], [FN, saida.addFunction], [GEN, saida.addGenerated],
  ] as const) {
    const d = await ler(dev, sql);
    const p = await ler(prod, sql);
    for (const k of d.keys()) if (!p.has(k)) destinoAdd.push(k);
    for (const k of p.keys()) if (!d.has(k)) saida.drop.push(k);
    for (const [k, v] of d) if (p.has(k) && p.get(k) !== v) saida.alter.push(k);
  }
  // Colunas de tabela nova não são "ADD COLUMN": vêm com o CREATE TABLE.
  const novas = new Set(saida.addTable);
  saida.addColumn = saida.addColumn.filter((c) => !novas.has(c.split(".")[0]!));
  saida.addIndex = saida.addIndex.filter((i) => !i.startsWith("pg_"));
  return saida;
}
