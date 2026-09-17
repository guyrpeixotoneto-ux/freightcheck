import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * DE QUAL UNIDADE CANÔNICA É ESTE ESCOPO — a ponte entre a lateral e o acervo
 * do Fechamento.
 *
 * A caixa "Unidade atual" da lateral fala em `scope_hash`: a unidade nasce do
 * acervo de vigências (`snapshot_scope`), e é por esse hash que toda tela que
 * honra escopo se recorta. O Fechamento não conhece hash nenhum — as
 * competências dele apontam para `unidade.id`, a unidade **cadastrada**, que é
 * a autoridade que o produto inteiro passou a usar para dizer "qual unidade é
 * esta" (ver `lib/db/src/schema/unidade.ts`).
 *
 * Os dois se encontram num lugar só, e ele já existia: `remuneracao_unidade`
 * guarda o par (`scope_hash`, `unidade_id`) — o cadastro em que uma pessoa
 * disse, por escrito, que aquele escopo é aquela unidade. É a mesma ponte que
 * `cadastro-da-remuneracao.ts` atravessa na direção oposta (da competência para
 * o contrato), e atravessá-la aqui na volta é o que permite uma tela do
 * Fechamento se recortar pela unidade que a lateral anuncia.
 *
 * ---------------------------------------------------------------------------
 * Por texto, nunca
 * ---------------------------------------------------------------------------
 *
 * Seria tentador comparar o código do escopo (`081-0443`, `CDD Caruaru`, um
 * CNPJ com máscara) com o `unidade_codigo` que a competência guarda. É
 * exatamente o casamento por texto que `identidade-da-competencia.ts` e
 * `cadastro-porta.ts` existem para aposentar, e o estrago dele aqui seria o pior
 * possível: a frota de uma unidade desenhada embaixo do nome de outra.
 *
 * Por isso a recusa é explícita e tem nome. Quem não resolve não vira "todas as
 * unidades" — vira uma tela que diz o que falta fazer.
 */

/** O que uma resolução de escopo pode devolver. */
export type UnidadeDoEscopo =
  /** O escopo é esta unidade cadastrada, e não há texto no meio. */
  | { tipo: "RESOLVIDO"; unidadeId: string; nome: string }
  /**
   * Há cadastro de Remuneração para este escopo e ninguém o associou a uma
   * unidade — ou não há cadastro nenhum.
   *
   * As duas situações têm o mesmo conserto (associar a unidade, em Remuneração)
   * e por isso o mesmo nome. O que **não** podem ter é a resposta do acervo
   * inteiro: quem abriu a tela com CAMAÇARI na lateral leria a frota de outra
   * unidade sob aquele nome.
   */
  | { tipo: "SEM_CADASTRO" }
  /**
   * Mais de uma unidade cadastrada responde por este escopo.
   *
   * Acontece quando dois canais do mesmo `scope_hash` foram associados a
   * unidades diferentes — erro de alguém, e um que só uma pessoa desfaz.
   * Escolher uma em silêncio é o `LIMIT 1` que `cadastro-porta.ts` recusa pela
   * mesma razão.
   */
  | { tipo: "AMBIGUO"; nomes: string[] };

/**
 * Qual unidade canônica este `scope_hash` é.
 *
 * `DISTINCT` sobre `unidade_id` porque um escopo tem uma linha por canal, e os
 * canais de uma mesma unidade são o caso normal — três linhas apontando para a
 * mesma unidade são uma resposta só, e não uma ambiguidade.
 */
export async function unidadeDoEscopo(
  db: Database,
  scopeHash: string,
): Promise<UnidadeDoEscopo> {
  const { rows } = await db.execute<{ unidade_id: string; nome: string }>(sql`
    SELECT DISTINCT u.id AS unidade_id, u.nome
      FROM remuneracao_unidade ru
      JOIN unidade u ON u.id = ru.unidade_id
     WHERE ru.scope_hash = ${scopeHash}
     ORDER BY u.nome
  `);

  if (rows.length === 0) return { tipo: "SEM_CADASTRO" };
  if (rows.length > 1) {
    return { tipo: "AMBIGUO", nomes: rows.map((r) => r.nome) };
  }
  return { tipo: "RESOLVIDO", unidadeId: rows[0]!.unidade_id, nome: rows[0]!.nome };
}
