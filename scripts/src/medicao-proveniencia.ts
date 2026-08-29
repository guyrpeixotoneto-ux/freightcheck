/**
 * MEDIÇÃO DE PROVENIÊNCIA — somente leitura.
 *
 * Responde, com números reais, se a "cobertura das fontes do recorte"
 * (escopo por proveniência da importação) **diferencia** as unidades ou se
 * arquivos multi-unidade fazem os percentuais continuarem praticamente iguais
 * — o risco que decidiu adiar a UX do indicador até que houvesse medida.
 *
 * A regra medida é a que foi acordada, e nada além dela:
 *
 *   1. O recorte de uma unidade é **A ∪ B**: os `import_run` que alimentam o
 *      snapshot da competência exibida (B) e o da competência anterior (A),
 *      porque a tela mostra uma comparação A → B e metade do que ela publica
 *      depende da origem de A.
 *   2. A proveniência sai de **`fact.origin_import_run_id`**, nunca de
 *      `snapshot.import_run_id`. Numa revisão parcial — o arquivo que corrige
 *      só os cavalos — as carretas são herdadas, e `snapshot.import_run_id`
 *      passaria a ser o da revisão: atribuiria as carretas ao arquivo que não
 *      as trouxe e deixaria de fora o arquivo que de fato alimentou aquela
 *      metade da tela. Ver o comentário da coluna em `lib/db/src/schema/canonical.ts`.
 *   3. Run oculto (`import_run.hidden_at IS NOT NULL`) não entra, e snapshot
 *      `SUPERSEDED` não entra — os mesmos dois predicados que `listContexts`
 *      (`lib/comparison/src/series.ts`) já aplica.
 *   4. Para cada run selecionado vale o **arquivo inteiro** no balanço,
 *      inclusive o resíduo. Não se afirma que uma célula residual "pertence" à
 *      unidade; afirma-se que ela pertence a um arquivo que alimentou aquela
 *      unidade naquele recorte.
 *
 * Este script não decide nada e não escreve nada. Ele mede, para que a decisão
 * sobre a apresentação do indicador seja tomada contra números e não contra
 * expectativa.
 *
 * Uso:  PRODUCTION_DATABASE_URL='postgres://…' pnpm medir:proveniencia
 */

import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import {
  balancoDaImportacao,
  listarBalancos,
  runsDeProveniencia,
  type BalancoResumo,
} from "@workspace/balance";

// ---------------------------------------------------------------------------
// Travas de conexão — as mesmas de `prova-producao.sh`, pelo mesmo motivo
// ---------------------------------------------------------------------------

/**
 * Com a URL vazia o libpq cai nos defaults (socket local, usuário do processo,
 * base homônima) e conecta em OUTRO banco em silêncio. Sem estas variáveis não
 * há default para onde cair.
 */
function neutralizarDefaultsDoLibpq(): void {
  for (const v of [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGDATABASE",
    "PGPASSWORD",
    "PGSERVICE",
    "PGSERVICEFILE",
  ]) {
    delete process.env[v];
  }
}

function urlDeLeitura(): string {
  const url = process.env.PRODUCTION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "Defina PRODUCTION_DATABASE_URL (ou DATABASE_URL) com a base a medir. " +
        "Nada foi executado.",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      "A URL não começa com postgres:// nem postgresql://. Recusado antes de conectar.",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// O recorte de cada unidade
// ---------------------------------------------------------------------------

interface RecorteDaUnidade {
  unidade: string;
  nome: string | null;
  canal: string;
  /** A competência exibida (B) e a anterior (A), quando existe. */
  periodoB: string;
  periodoA: string | null;
  runs: Set<string>;
  /** Só de B, para medir quanto de A entra no conjunto. */
  runsB: Set<string>;
}

/**
 * Os snapshots vivos de cada unidade, por competência.
 *
 * `status <> 'SUPERSEDED'` e o `NOT EXISTS` de run oculto são copiados de
 * `listContexts` — se a régua daqui divergisse da de lá, a medição descreveria
 * um recorte que nenhuma tela mostra.
 */
async function snapshotsPorUnidade(db: Database) {
  const { rows } = await db.execute<{
    unidade: string;
    nome: string | null;
    canal: string;
    effective_date: string;
    snapshot_id: string;
  }>(sql`
    SELECT sc.code            AS unidade,
           sc.name            AS nome,
           s.canal            AS canal,
           s.effective_date::text AS effective_date,
           s.id::text         AS snapshot_id
      FROM snapshot s
      JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      JOIN scope sc          ON sc.id = ss.scope_id
     WHERE sc.scope_type = 'UNIDADE'
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = s.import_run_id AND ir.hidden_at IS NOT NULL
           )
     ORDER BY sc.code, s.canal, s.effective_date DESC
  `);
  return rows;
}

/**
 * Quantas unidades distintas cada `import_run` alimenta — a pergunta central.
 *
 * É por unidade e não por recorte: um arquivo que alimenta cinco unidades faz
 * o resíduo dele pesar na cobertura das cinco, e é isso que decide se o
 * indicador diferencia ou empata.
 */
async function unidadesPorRun(db: Database) {
  const { rows } = await db.execute<{ run: string; unidades: number }>(sql`
    SELECT f.origin_import_run_id::text AS run,
           count(DISTINCT sc.code)::int AS unidades
      FROM fact f
      JOIN snapshot s        ON s.id = f.snapshot_id
      JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      JOIN scope sc          ON sc.id = ss.scope_id
     WHERE sc.scope_type = 'UNIDADE'
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = f.origin_import_run_id AND ir.hidden_at IS NOT NULL
           )
     GROUP BY 1
     ORDER BY 2 DESC, 1
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// A cobertura de um conjunto de runs
// ---------------------------------------------------------------------------

/**
 * A mesma conta de `cobertura()` em `artifacts/freightaudit/src/lib/visao-geral.ts`
 * — `1 − (PERDA + RESIDUO) ÷ entrada` —, aplicada a um subconjunto de balanços.
 *
 * Deliberadamente a mesma fórmula, e não uma aproximação: se a medição usasse
 * outra régua, o número medido não seria o número que o indicador mostraria, e
 * a decisão sairia sobre um dado que não existe em lugar nenhum.
 */
function coberturaDe(balancos: BalancoResumo[]) {
  const celulas = balancos.reduce((t, b) => t + b.entrada, 0);
  if (celulas === 0) return null;
  const foraDaAuditoria = balancos.reduce(
    (t, b) => t + b.porNatureza.PERDA + b.porNatureza.RESIDUO,
    0,
  );
  return {
    percentual: ((celulas - foraDaAuditoria) / celulas) * 100,
    celulas,
    foraDaAuditoria,
    importacoes: balancos.length,
  };
}

/** O arquivo mais podre do conjunto — o que a média ponderada esconde. */
function piorFonte(balancos: BalancoResumo[]) {
  let pior: { b: BalancoResumo; pct: number } | null = null;
  for (const b of balancos) {
    if (b.entrada === 0) continue;
    const pct =
      ((b.entrada - (b.porNatureza.PERDA + b.porNatureza.RESIDUO)) /
        b.entrada) *
      100;
    if (pior === null || pct < pior.pct) pior = { b, pct };
  }
  return pior;
}

const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const num = (v: number) => v.toLocaleString("pt-BR");

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uniao = new Set([...a, ...b]).size;
  return uniao === 0 ? 0 : (inter / uniao) * 100;
}

// ---------------------------------------------------------------------------

async function main() {
  neutralizarDefaultsDoLibpq();
  const { db, pool } = createDb(urlDeLeitura());

  try {
    const ambiente = await db.execute<{
      base: string;
      runs: number;
      snapshots: number;
      fatos: number;
    }>(sql`
      SELECT current_database()                  AS base,
             (SELECT count(*) FROM import_run)   AS runs,
             (SELECT count(*) FROM snapshot)     AS snapshots,
             (SELECT count(*) FROM fact)         AS fatos
    `);
    const amb = ambiente.rows[0]!;
    console.log("=== [0] AMBIENTE ===");
    console.log(
      `base=${amb.base}  runs=${num(Number(amb.runs))}  snapshots=${num(
        Number(amb.snapshots),
      )}  fatos=${num(Number(amb.fatos))}\n`,
    );

    // --- Recortes por unidade (A ∪ B) --------------------------------------
    const linhas = await snapshotsPorUnidade(db);
    const porUnidade = new Map<string, typeof linhas>();
    for (const l of linhas) {
      const chave = `${l.unidade}|${l.canal}`;
      const lista = porUnidade.get(chave) ?? [];
      lista.push(l);
      porUnidade.set(chave, lista);
    }

    const recortes: RecorteDaUnidade[] = [];
    for (const [, lista] of porUnidade) {
      const periodos = [...new Set(lista.map((l) => l.effective_date))].sort(
        (a, b) => b.localeCompare(a),
      );
      const periodoB = periodos[0]!;
      const periodoA = periodos[1] ?? null;
      const idsB = lista
        .filter((l) => l.effective_date === periodoB)
        .map((l) => l.snapshot_id);
      const idsA =
        periodoA === null
          ? []
          : lista
              .filter((l) => l.effective_date === periodoA)
              .map((l) => l.snapshot_id);

      const runsB = new Set(await runsDeProveniencia(db, idsB));
      const runsA = new Set(await runsDeProveniencia(db, idsA));
      recortes.push({
        unidade: lista[0]!.unidade,
        nome: lista[0]!.nome,
        canal: lista[0]!.canal,
        periodoB,
        periodoA,
        runs: new Set([...runsB, ...runsA]),
        runsB,
      });
    }
    recortes.sort((a, b) => a.unidade.localeCompare(b.unidade));

    // --- Sobreposição multi-unidade ----------------------------------------
    const porRun = await unidadesPorRun(db);
    const distrib = new Map<number, number>();
    for (const r of porRun)
      distrib.set(r.unidades, (distrib.get(r.unidades) ?? 0) + 1);
    const compartilhados = porRun.filter((r) => r.unidades > 1).length;

    console.log(
      "=== [1] SOBREPOSIÇÃO MULTI-UNIDADE (todos os runs com fato visível) ===",
    );
    console.log(`runs que alimentam alguma unidade: ${porRun.length}`);
    console.log(
      `  exclusivos de UMA unidade: ${porRun.length - compartilhados}`,
    );
    console.log(`  compartilhados (>1 unidade): ${compartilhados}`);
    console.log("\ndistribuição — unidades por import_run:");
    for (const n of [...distrib.keys()].sort((a, b) => a - b)) {
      console.log(`  ${n} unidade(s): ${distrib.get(n)} run(s)`);
    }

    // --- Conjuntos por recorte ---------------------------------------------
    const usadosNasTelas = new Set(recortes.flatMap((r) => [...r.runs]));
    console.log(
      `\n=== [2] RUNS USADOS HOJE NAS TELAS (A ∪ B de cada unidade): ${usadosNasTelas.size} ===`,
    );
    for (const r of recortes) {
      const soA = [...r.runs].filter((x) => !r.runsB.has(x)).length;
      console.log(
        `  ${r.unidade} · ${r.canal}  B=${r.periodoB}  A=${r.periodoA ?? "—"}  ` +
          `runs=${r.runs.size} (B=${r.runsB.size}, só em A=${soA})`,
      );
    }

    // --- Sobreposição entre os conjuntos ------------------------------------
    console.log("\n=== [3] SOBREPOSIÇÃO ENTRE OS CONJUNTOS (Jaccard, % ) ===");
    let algumaSobreposicao = false;
    for (let i = 0; i < recortes.length; i++) {
      for (let j = i + 1; j < recortes.length; j++) {
        const a = recortes[i]!;
        const b = recortes[j]!;
        const inter = [...a.runs].filter((x) => b.runs.has(x)).length;
        if (inter > 0) algumaSobreposicao = true;
        console.log(
          `  ${a.unidade} ∩ ${b.unidade}: ${inter} run(s) em comum · ` +
            `Jaccard ${pct(jaccard(a.runs, b.runs))}`,
        );
      }
    }
    if (!algumaSobreposicao && recortes.length > 1) {
      console.log("  (nenhum run compartilhado entre unidades)");
    }

    // --- Cobertura resultante ----------------------------------------------
    // `listarBalancos` já exclui run oculto (o contrato de `hidden_at`), então
    // o que ela devolve É a cobertura global corrigida. O balanço de cada run
    // oculto é buscado um a um só para dizer quanto a correção mudou — sem
    // isso, a medição não mostraria o efeito da própria correção.
    const todos = await listarBalancos(db);
    const porId = new Map(todos.map((b) => [b.importRunId, b]));
    const globalSemOcultos = coberturaDe(todos);

    const { rows: linhasOcultas } = await db.execute<{ run: string }>(sql`
      SELECT id::text AS run FROM import_run WHERE hidden_at IS NOT NULL
    `);
    const balancosOcultos: BalancoResumo[] = [];
    for (const { run } of linhasOcultas) {
      const b = await balancoDaImportacao(db, run);
      if (b) balancosOcultos.push(b);
    }
    const globalComOcultos = coberturaDe([...todos, ...balancosOcultos]);

    console.log("\n=== [4] COBERTURA ===");
    console.log(
      `  GLOBAL antes da correção (contava ocultos): ${
        globalComOcultos ? pct(globalComOcultos.percentual) : "—"
      }  (${globalComOcultos ? num(globalComOcultos.celulas) : 0} células, ${
        globalComOcultos?.importacoes ?? 0
      } importações)`,
    );
    console.log(
      `  GLOBAL corrigida (sem ocultos):            ${
        globalSemOcultos ? pct(globalSemOcultos.percentual) : "—"
      }  (${globalSemOcultos ? num(globalSemOcultos.celulas) : 0} células, ${
        globalSemOcultos?.importacoes ?? 0
      } importações)   [${balancosOcultos.length} run(s) oculto(s) fora da conta]`,
    );
    console.log("\n  POR RECORTE (regra de proveniência, A ∪ B):");
    for (const r of recortes) {
      const balancos = [...r.runs]
        .map((id) => porId.get(id))
        .filter((b): b is BalancoResumo => b !== undefined);
      const c = coberturaDe(balancos);
      const pior = piorFonte(balancos);
      console.log(
        `    ${r.unidade} · ${r.canal}: ${c ? pct(c.percentual) : "—"}  ` +
          `(${c ? num(c.celulas) : 0} células, ${balancos.length} importações)` +
          (pior ? `  pior fonte: ${pct(pior.pct)} — ${pior.b.filename}` : ""),
      );
    }

    // --- O veredito da medição ---------------------------------------------
    const valores = recortes
      .map((r) => {
        const balancos = [...r.runs]
          .map((id) => porId.get(id))
          .filter((b): b is BalancoResumo => b !== undefined);
        return coberturaDe(balancos)?.percentual ?? null;
      })
      .filter((v): v is number => v !== null);

    console.log("\n=== [5] O INDICADOR DIFERENCIA? ===");
    if (valores.length < 2) {
      console.log("  Menos de dois recortes com cobertura — nada a comparar.");
    } else {
      const amplitude = Math.max(...valores) - Math.min(...valores);
      console.log(
        `  amplitude entre unidades: ${amplitude.toFixed(2).replace(".", ",")} ponto(s) percentual(is)`,
      );
      console.log(
        `  distintos: ${new Set(valores.map((v) => v.toFixed(1))).size} de ${valores.length} recortes`,
      );
      console.log(
        amplitude < 0.1
          ? "  => NÃO DIFERENCIA: arquivos multi-unidade empatam os recortes.\n" +
              "     O indicador por recorte reproduziria o sintoma que motivou a mudança."
          : "  => DIFERENCIA: os recortes têm coberturas distintas.",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
