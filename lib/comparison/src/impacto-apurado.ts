/**
 * O impacto apurado de um recorte — a única porta para o número em dinheiro.
 *
 * Existe porque o produto tinha quatro `sum(impact_amount)` escritos direto em
 * SQL — `totaisDoEscopo`, `getChangeSetBreakdown`, `listChangeSetTotals` e o
 * `/overview` —, e nenhum deles aplicava regra de dupla contagem nenhuma. Não
 * por descuido: **SQL não consegue** expressar a regra que este produto usa. Ela
 * é por ativo e depende do conjunto ("as parcelas deste total mudaram *neste*
 * veículo?", "o cavalo vinculado mexeu nesta mesma comparação?"), e uma agregação
 * que já colapsou as linhas não tem mais como perguntar isso.
 *
 * Então a soma sai do SQL e vem para cá, onde a autoridade decide.
 *
 * ---------------------------------------------------------------------------
 * A regra é interna a uma comparação
 * ---------------------------------------------------------------------------
 *
 * `change_set_id` viaja em cada linha e o deduplicador indexa por (comparação,
 * ativo). Sem isso, uma leitura de intervalo — nove vigências — trataria
 * dezesseis comparações como uma só, e um total que se moveu sozinho em junho
 * sairia da soma porque uma parcela dele se moveu em julho. Sairia dinheiro que
 * nenhuma outra linha explica, e a correção teria trocado inflar por encolher.
 *
 * A consequência do limite fica escrita: a regra de escopo de conjunto só
 * enxerga o cavalo e a carreta quando os dois estão **na mesma comparação**. No
 * export real eles estão — o snapshot é `CARRETA+CAVALO` —, mas uma origem que
 * entregasse os dois equipamentos em arquivos comparados separadamente não teria
 * como ver um do outro, e o total sairia inflado sem que nada aqui reclamasse.
 * Quando essa origem existir, é `carregarVinculosDeConjunto` que precisa passar
 * a atravessar comparações irmãs — não esta função.
 *
 * ---------------------------------------------------------------------------
 * O índice é da comparação inteira, e o recorte é só o filtro do fim
 * ---------------------------------------------------------------------------
 *
 * É a parte que erra fácil e cara. Uma leitura de Cavalo 360° pede o impacto
 * dos cavalos; se o deduplicador fosse montado só com as linhas de cavalo, ele
 * não veria `carreta.lucro_fixomodelo_novo_ciclo` mudar, o `carreta.custo_fixo`
 * voltaria para dentro da soma, e o recorte mostraria mais dinheiro do que a
 * frota inteira. Por isso: carrega **tudo**, decide sobre tudo, e só então
 * soma o que o recorte pediu.
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { attributeTable, changeTable } from "@workspace/db";

/*
  O mesmo `join` de `listChanges`: o filtro de busca procura também pelo nome
  gerencial de hoje, que só existe em `attribute`. Sem ele, um recorte por busca
  daria erro de coluna inexistente — e a lista e os totais voltariam a divergir,
  agora por exceção em vez de por número.
*/
const ATRIBUTO_ATUAL = eq(attributeTable.code, changeTable.attributeCode);
import {
  criarDeduplicador,
  daLinhaDoBanco,
  resumirImpacto,
  SEM_PERIODICIDADE,
  type ForaDoTotal,
  type ResumoDeImpacto,
} from "./deduplicacao";
import { carregarVinculosDeConjunto, snapshotsDosChangeSets } from "./vinculos";

/**
 * O resumo de quem não tem linha nenhuma — e não um zero que finge ser soma.
 *
 * Função e não constante: uma constante compartilharia o objeto `rastro` entre
 * todos os chamadores, e basta um deles anotar alguma coisa nele para que o
 * recorte vazio de uma tela apareça no de outra.
 */
export function impactoVazio(): ResumoDeImpacto {
  return {
    byPeriodicity: {},
    brutoByPeriodicity: {},
    rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
    excludedChanges: 0,
    calculatedChanges: 0,
    notCalculable: 0,
  };
}

interface LinhaCrua extends Record<string, unknown> {
  change_set_id: string;
  entity_id: string | null;
  attribute_code: string | null;
  cost_class: string | null;
  impact_confidence: string | null;
  impact_amount: string | null;
  impact_periodicity: string | null;
  no_recorte: boolean;
}

/**
 * Uma alteração com a decisão já tomada.
 *
 * É o que permite ao produto ter uma autoridade só e ainda assim agrupar de
 * cinco jeitos: quem quer por atributo, por classe de custo ou por
 * periodicidade agrupa **isto**, em vez de escrever um `GROUP BY` que decide
 * de novo — e diferente.
 */
export interface LinhaApurada {
  entityId: string | null;
  attributeCode: string | null;
  costClass: string | null;
  periodicity: string;
  /** `null` quando a linha não tem preço apurado. */
  amount: number | null;
  /** Por que ficou fora da soma — `null` quando entra. */
  foraDoTotal: ForaDoTotal | null;
  /** Se o recorte pedido inclui esta linha. O deduplicador viu todas. */
  noRecorte: boolean;
}

/**
 * Toda alteração das comparações, com a decisão de dupla contagem já tomada.
 *
 * O deduplicador enxerga **todas** as linhas; `noRecorte` diz quais o chamador
 * pediu. Separar as duas coisas é o que impede um recorte de mostrar mais
 * dinheiro do que a frota inteira.
 */
export async function linhasApuradas(
  db: Database,
  changeSetIds: string[],
  recorte: SQL[] = [],
): Promise<LinhaApurada[]> {
  if (changeSetIds.length === 0) return [];

  const doRecorte = recorte.length > 0 ? and(...recorte)! : sql`true`;
  const { rows } = await db.execute<LinhaCrua>(sql`
    SELECT "change".change_set_id::text AS change_set_id,
           "change".entity_id::text     AS entity_id,
           "change".attribute_code      AS attribute_code,
           "change".cost_class          AS cost_class,
           "change".impact_confidence   AS impact_confidence,
           "change".impact_amount::text AS impact_amount,
           "change".impact_periodicity  AS impact_periodicity,
           (${doRecorte})               AS no_recorte
      FROM "change"
      LEFT JOIN "attribute" ON ${ATRIBUTO_ATUAL}
     WHERE ${inArray(changeTable.changeSetId, changeSetIds)}
  `);

  const dedup = criarDeduplicador(
    rows.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(db, await snapshotsDosChangeSets(db, changeSetIds)),
  );

  return rows.map((r) => {
    const temPreco = r.impact_confidence === "CALCULATED" && r.impact_amount !== null;
    return {
      entityId: r.entity_id,
      attributeCode: r.attribute_code,
      costClass: r.cost_class,
      periodicity: r.impact_periodicity ?? SEM_PERIODICIDADE,
      amount: temPreco ? Number(r.impact_amount) : null,
      foraDoTotal: temPreco ? dedup.foraDoTotal(daLinhaDoBanco(r)) : null,
      noRecorte: r.no_recorte,
    };
  });
}

/**
 * Soma o oficial de linhas já decididas, por periodicidade.
 *
 * Só entra o que o recorte pediu **e** o que a autoridade deixou entrar.
 */
export function somarOficial(linhas: LinhaApurada[]): Record<string, number> {
  const baldes: Record<string, number> = {};
  for (const l of linhas) {
    if (!l.noRecorte || l.amount === null || l.foraDoTotal !== null) continue;
    baldes[l.periodicity] = (baldes[l.periodicity] ?? 0) + l.amount;
  }
  return Object.fromEntries(
    Object.entries(baldes).map(([k, v]) => [k, Number(v.toFixed(6))]),
  );
}

/**
 * O impacto apurado das comparações informadas, opcionalmente recortado.
 *
 * `recorte` são condições sobre `change` — as mesmas de `escopoDeFrota`. Elas
 * filtram **o que entra na soma**, nunca o que o deduplicador enxerga.
 */
export async function impactoApurado(
  db: Database,
  changeSetIds: string[],
  recorte: SQL[] = [],
): Promise<ResumoDeImpacto> {
  if (changeSetIds.length === 0) return impactoVazio();

  const doRecorte = recorte.length > 0 ? and(...recorte)! : sql`true`;
  const { rows } = await db.execute<LinhaCrua>(sql`
    SELECT "change".change_set_id::text AS change_set_id,
           "change".entity_id::text     AS entity_id,
           "change".attribute_code      AS attribute_code,
           "change".impact_confidence   AS impact_confidence,
           "change".impact_amount::text AS impact_amount,
           "change".impact_periodicity  AS impact_periodicity,
           (${doRecorte})               AS no_recorte
      FROM "change"
      LEFT JOIN "attribute" ON ${ATRIBUTO_ATUAL}
     WHERE ${inArray(changeTable.changeSetId, changeSetIds)}
  `);

  const dedup = criarDeduplicador(
    rows.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(db, await snapshotsDosChangeSets(db, changeSetIds)),
  );

  return resumirImpacto(
    rows.filter((r) => r.no_recorte).map(daLinhaDoBanco),
    dedup,
  );
}
