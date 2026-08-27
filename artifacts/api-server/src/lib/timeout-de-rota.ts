import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { pool, type Database } from "@workspace/db";

/**
 * Um teto de tempo mais curto que o do pool inteiro, para uma rota só.
 *
 * O pool (`opcoesDoPool` em `lib/db`) já tem `statement_timeout` — 120s por
 * padrão, deliberadamente largo, porque a promoção de uma vigência grande é
 * uma transação legítima de dezenas de segundos e um teto apertado a mataria
 * no meio. Esse número é certo para quem promove um arquivo; é errado para
 * uma rota de leitura como `/changes/latest`: nada nela justifica segurar uma
 * conexão do pool de dez por até dois minutos, e o item que motivou isto é
 * exatamente esse — um proxy na frente pode encerrar a conexão HTTP bem antes
 * dos 120s (a evidência que faltava está em `res.on("close")`,
 * `observabilidade.ts`), e enquanto isso a consulta seguiria rodando,
 * segurando uma conexão que as outras 9 requisições concorrentes também
 * disputam.
 *
 * **Não reduz o teto global.** Abaixar `DB_STATEMENT_TIMEOUT_MS` do pool
 * inteiro para servir esta rota quebraria a promoção de vigência grande, que
 * precisa dos 120s — exatamente o que a instrução deste pacote de correções
 * proíbe. Em vez disso, esta função pega uma conexão avulsa do mesmo pool,
 * aperta o teto **só nela**, e a descarta no fim (`release(true)`, não
 * `release()`): uma conexão devolvida ao pool levaria o teto apertado para a
 * próxima rota que a reaproveitasse — inclusive uma promoção — e essa fuga
 * silenciosa é exatamente o tipo de acoplamento por conexão compartilhada que
 * este desenho existe para impedir.
 *
 * O custo é intra-requisição: consultas que rodariam em paralelo em conexões
 * distintas do pool passam a rodar em série nesta única conexão — uma
 * conexão só executa uma consulta por vez. Para `/changes/latest`, medido em
 * ~315ms de ponta a ponta com dados reais (41 mil fatos, nove vigências), a
 * perda de paralelismo intra-requisição é desprezível perto da proteção que
 * ela compra.
 */
export async function comTetoDeRota<T>(
  timeoutMs: number,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // `SET` (sessão), não `SET LOCAL` (transação): esta conexão não vive
    // dentro de uma transação aberta por quem chama, e o teto precisa valer
    // para toda consulta feita nela até ser descartada — inclusive a
    // transação que `computeChangeSet` abre por conta própria quando a
    // comparação ainda não foi calculada.
    await client.query(`SET statement_timeout = ${Math.trunc(timeoutMs)}`);
    const dbComTeto = drizzle(client, { schema }) as unknown as Database;
    return await fn(dbComTeto);
  } finally {
    /*
      A conexão volta ao pool **com o teto desfeito**, e não destruída.

      Era `client.release(true)`, que descarta a conexão — o jeito mais direto de
      garantir que o teto apertado não pegasse carona na próxima requisição. Só
      que descartar assim, no `pg` 8.22, deixa o pool com uma conexão que ele
      nunca dá por encerrada: `pool.end()` fica esperando para sempre. Medido —
      um `connect()`, um `release(true)`, e o `end()` seguinte não resolve. Em
      produção isso é o processo que não desliga sozinho depois de a primeira
      requisição passar por aqui; a suíte de isolamento foi onde apareceu,
      porque ela é a primeira a exercitar `/changes/latest` e a fechar o pool
      logo em seguida.
      Desfazer o `SET` explicitamente resolve o mesmo problema pelo caminho
      direto: a sessão volta ao padrão do pool, e a conexão volta inteira. Se o
      `RESET` falhar — conexão já morta, transação abortada —, aí sim ela é
      descartada, porque devolver uma sessão em estado desconhecido é pior do
      que perder uma conexão.
    */
    try {
      await client.query("SET statement_timeout = DEFAULT");
      client.release();
    } catch {
      client.release(true);
    }
  }
}
