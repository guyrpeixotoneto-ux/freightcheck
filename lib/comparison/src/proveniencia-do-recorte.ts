import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { channelSql, contextFilter, type SeriesContext } from "./series";

/**
 * As vigências vivas de um recorte, e o alcance das importações que as trouxeram.
 *
 * Este módulo é a metade de `snapshot` da procedência por recorte. A outra
 * metade — de quais importações vieram os fatos destas vigências, e quantas
 * células RAW distintas viraram fato nelas — é de `@workspace/balance`
 * (`runsDeProveniencia`, `celulasEmFato`), porque ali a pergunta é de massa. A
 * divisão não é de gosto: `snapshot` é o vocabulário desta biblioteca, e
 * `raw_cell` é o daquela.
 *
 * **Vivas quer dizer `status <> 'SUPERSEDED'`, e é isso que deduplica
 * reprocessamento.** `snapshot_canonical_live_uq` garante no máximo uma vigência
 * não-superseded por identidade canônica — uma garantia do banco, não do caminho
 * de escrita —, então uma releitura do mesmo arquivo não entra duas vezes: a
 * anterior está superseded e não é alcançada.
 *
 * Andar em `import_run.reprocess_of_run_id` seria o caminho errado, e o próprio
 * schema explica por quê: *"É esta coluna [`reprocess_reason`], e não o
 * ponteiro, que diz 'isto é uma releitura'. O ponteiro pode ficar nulo quando a
 * leitura relida é excluída."* Um algoritmo apoiado no ponteiro perderia
 * exatamente os casos já corrigidos.
 */

/** Uma vigência viva do recorte — o que a proveniência precisa saber dela. */
export interface VigenciaViva {
  snapshotId: string;
  /** O rótulo literal do arquivo, `EMPURRADA_1_8_2026`. Evidência, não chave. */
  sourceLabel: string;
  /** O run **dono** da vigência. Não é a origem dos fatos dela — ver abaixo. */
  importRunId: string;
  effectiveDate: string;
}

/**
 * As vigências vivas de um recorte, numa competência.
 *
 * `contextFilter` é o mesmo predicado das mais de sessenta consultas desta
 * biblioteca: unidade, canal, operação e família num lugar só. É ele que faz o
 * recorte por operação valer aqui sem uma linha nova — e é a segunda linha de
 * defesa contra um contexto resolvido errado, porque a operação vem da coluna
 * canônica e não do rótulo.
 *
 * **`importRunId` sai daqui, mas não é a proveniência.** Ele é o dono da
 * vigência, e numa revisão parcial — o arquivo que corrige só os cavalos e herda
 * as carretas — o dono é a última revisão que a tocou. Quem responde pela origem
 * de cada fato é `fact.origin_import_run_id`, em `runsDeProveniencia`. Este
 * campo viaja porque a tela diz "a última importação desta competência", que é
 * uma pergunta sobre a vigência, e não sobre o fato.
 */
export async function vigenciasVivasDoRecorte(
  db: Database,
  context: SeriesContext,
  /** A competência pedida. Uma só — janela é da série, não do balanço. */
  period: string,
): Promise<VigenciaViva[]> {
  const { rows } = await db.execute<{
    snapshot_id: string;
    source_label: string;
    import_run_id: string;
    effective_date: string;
  }>(sql`
    SELECT s.id::text             AS snapshot_id,
           s.source_label,
           s.import_run_id::text  AS import_run_id,
           s.effective_date::text AS effective_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND s.effective_date = ${period}::date
       AND ${contextFilter("s", context)}
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = s.import_run_id
                AND ir.hidden_at IS NOT NULL
           )
     ORDER BY s.source_label
  `);

  return rows.map((r) => ({
    snapshotId: r.snapshot_id,
    sourceLabel: r.source_label,
    importRunId: r.import_run_id,
    effectiveDate: r.effective_date,
  }));
}

/** O que um arquivo alimentou além do recorte que está na tela. */
export interface AlcanceDoRun {
  importRunId: string;
  /** Quantos contextos (unidade · canal) ele alimentou, ao todo. */
  contextos: number;
  /** Quais competências ele alimentou, ao todo. */
  vigencias: string[];
}

/**
 * Quanto cada arquivo alcança **fora** deste recorte.
 *
 * Existe para que a tela possa dizer a verdade sobre um número que ela publica.
 * Um arquivo multi-unidade entra legitimamente na procedência de todas as
 * unidades que alimentou — a medida é *qualidade das fontes deste recorte*, não
 * uma partição exclusiva da massa —, e sem este campo a soma de `celulasDos
 * Arquivos` de três recortes daria o triplo do acervo, sem nada acusando.
 *
 * **Conta vigência superseded também**, e é o contrário do que
 * {@link vigenciasVivasDoRecorte} faz — porque a pergunta é outra. Lá se pergunta
 * "o que está na tela agora", e uma vigência substituída não está. Aqui se
 * pergunta "o que este arquivo trouxe", e um arquivo que abriu a vigência de
 * outra unidade trouxe aquela unidade, ainda que uma revisão posterior tenha
 * assumido a vigência.
 *
 * A diferença não é sutil, é o que faz a conta existir: os runs que chegam aqui
 * vêm de `fact.origin_import_run_id`, e numa revisão parcial — o arquivo que
 * corrige só os cavalos e herda as carretas — **o run de origem das carretas não
 * tem vigência viva nenhuma**. Filtrar superseded o deixaria de fora do mapa, e
 * quem chama teria de inventar um alcance para ele: era exatamente aí que a
 * primeira versão desta rota afirmava exclusividade que ninguém mediu.
 *
 * Sem recorte de operação de propósito: o arquivo é anterior à divisão das
 * auditorias. Um arquivo que alimentou empurrada e rota alcança dois contextos, e
 * esconder um deles faria a nota da tela mentir sobre o que o resíduo dele cobre.
 */
export async function alcanceDosRuns(
  db: Database,
  importRunIds: readonly string[],
): Promise<Map<string, AlcanceDoRun>> {
  if (importRunIds.length === 0) return new Map();

  const { rows } = await db.execute<{
    import_run_id: string;
    contextos: number;
    vigencias: string[];
  }>(sql`
    SELECT s.import_run_id::text AS import_run_id,
           count(DISTINCT (s.scope_hash, ${channelSql("s.source_label")}))::int AS contextos,
           array_agg(DISTINCT s.effective_date::text ORDER BY s.effective_date::text)
             AS vigencias
      FROM snapshot s
     WHERE s.import_run_id IN (${sql.join(
         importRunIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       AND NOT EXISTS (
             SELECT 1 FROM import_run ir
              WHERE ir.id = s.import_run_id
                AND ir.hidden_at IS NOT NULL
           )
     GROUP BY 1
  `);

  return new Map(
    rows.map((r) => [
      r.import_run_id,
      {
        importRunId: r.import_run_id,
        contextos: Number(r.contextos),
        vigencias: r.vigencias ?? [],
      },
    ]),
  );
}
