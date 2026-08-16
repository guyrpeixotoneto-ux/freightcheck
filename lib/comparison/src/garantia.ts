/**
 * O conjunto de alteração existe antes de alguém afirmar que ele é zero.
 *
 * **O defeito que este módulo fecha.** `change` e `change_set` são estado
 * derivado: eles nascem quando alguém chama `computeChangeSet`, e até a
 * auditoria isso só acontecia quando alguém **abria a tela de Alterações**.
 * Quem lê a tabela sem essa garantia não distingue duas coisas opostas — "esta
 * vigência não mudou nada" e "esta vigência nunca foi comparada" —, e as duas
 * saem da consulta como a mesma linha: zero.
 *
 * O assistente lia exatamente assim, e por isso respondia "0 alterações — sem
 * alterações neste recorte" num banco com 124 mil fatos e nove vigências. Uma
 * resposta errada, fluente e com a fonte ao lado: a pior classe de erro que uma
 * aplicação de auditoria pode produzir, porque é indistinguível de uma certa.
 *
 * **Por que garantir em vez de avisar.** A alternativa era devolver "não
 * comparado" e deixar quem pergunta pedir o cálculo. Mas o cálculo é
 * determinístico, barato quando já existe e é a única resposta possível: não há
 * decisão humana entre "quero saber o que mudou" e "compare as duas vigências".
 * Um aviso aqui seria burocracia — o produto sabe o que fazer e sabe fazer
 * sozinho.
 *
 * **Barato quando já está feito.** `computeChangeSet` já é idempotente e já
 * devolve o conjunto existente sem recalcular. O que este módulo acrescenta é
 * não chamá-lo à toa: uma consulta descobre quais pares faltam, e só os que
 * faltam são calculados. Numa base em dia o custo é uma consulta.
 *
 * **O recorte é respeitado.** Só os pares do contexto pedido são garantidos —
 * garantir o banco inteiro faria a primeira pergunta de uma unidade pagar pela
 * comparação de todas as outras.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import { contextFilter } from "./series";
import type { SeriesContext } from "./series";

export interface GarantiaDeComparacao {
  /** Os pares que já existiam — nenhum trabalho foi feito por eles. */
  jaExistiam: number;
  /** Os pares calculados agora. */
  calculados: number;
  /** As vigências sem anterior: a primeira de cada série não se compara. */
  semAnterior: number;
}

interface LinhaDeSnapshot extends Record<string, unknown> {
  id: string;
  effective_date: string;
}

/**
 * Garante que as vigências deste recorte têm com que ser comparadas.
 *
 * `periodo` limita o trabalho ao que a pergunta precisa. Sem ele, todas as
 * vigências do recorte são garantidas — que é o que uma leitura de intervalo
 * pede, e o que vale rodar uma vez depois de uma importação.
 *
 * Nunca lança por causa de um par: uma vigência que não se compara com a
 * anterior (escopo, canal ou cobertura diferentes) é uma condição legítima do
 * domínio, e derrubar a pergunta inteira por causa dela trocaria uma resposta
 * incompleta por nenhuma. O que ela produz é ausência daquele par, que é o que
 * já acontecia antes.
 */
export async function garantirComparacoes(
  db: Database,
  contexto: SeriesContext,
  periodo?: string,
  opcoes: { computedBy?: string } = {},
): Promise<GarantiaDeComparacao> {
  /*
    Uma vigência do recorte é uma linha por cobertura de equipamento.

    CAVALO e CARRETA chegam como snapshots distintos da mesma data, e cada um
    tem o seu par com a data anterior. Filtrar por data sem considerar isso
    garantiria metade do que a tela mostra.
  */
  const { rows: snapshots } = await db.execute<LinhaDeSnapshot>(sql`
    SELECT s.id, s.effective_date::text AS effective_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", contexto)}
       ${periodo ? sql`AND s.effective_date = ${periodo}::date` : sql``}
     ORDER BY s.effective_date
  `);

  if (snapshots.length === 0) {
    return { jaExistiam: 0, calculados: 0, semAnterior: 0 };
  }

  /*
    Quais pares já existem — numa consulta, antes de tocar em qualquer cálculo.

    `computeChangeSet` já devolveria o conjunto pronto sem recalcular, mas ao
    custo de três consultas por par. Numa base em dia isso seria trabalho puro
    em toda pergunta digitada.
  */
  const { rows: existentes } = await db.execute<{ snapshot_b_id: string }>(sql`
    SELECT DISTINCT cs.snapshot_b_id
      FROM change_set cs
     WHERE cs.snapshot_b_id IN (${sql.join(
       snapshots.map((s) => sql`${s.id}::uuid`),
       sql`, `,
     )})
  `);
  const jaComparados = new Set(existentes.map((e) => e.snapshot_b_id));

  let jaExistiam = 0;
  let calculados = 0;
  let semAnterior = 0;

  for (const snapshot of snapshots) {
    if (jaComparados.has(snapshot.id)) {
      jaExistiam += 1;
      continue;
    }

    const anterior = await findPreviousSnapshot(db, snapshot.id);
    if (!anterior.encontrada) {
      semAnterior += 1;
      continue;
    }

    try {
      await computeChangeSet(db, anterior.vigencia.snapshotId, snapshot.id, {
        computedBy: opcoes.computedBy ?? "assistant:garantia",
      });
      calculados += 1;
    } catch {
      // Escopo, canal ou cobertura incompatíveis. É condição de domínio, e o
      // efeito é o mesmo de antes desta função existir: aquele par não tem
      // comparação. A pergunta segue com o que houver.
      semAnterior += 1;
    }
  }

  return { jaExistiam, calculados, semAnterior };
}
