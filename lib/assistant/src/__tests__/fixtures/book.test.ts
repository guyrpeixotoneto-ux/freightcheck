import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import { semearBookDeTeste } from "./book";

/**
 * A própria fixture, sob a condição em que ela falhou.
 *
 * Quatro arquivos de teste semeiam o Book, o vitest os roda em processos
 * paralelos e todos apontam para o mesmo banco de avaliação. Enquanto a fixture
 * decidia só por contagem — "está vazio, então insere" — os quatro liam zero
 * antes de qualquer um gravar, e três esbarravam na única
 * `(block_key, revision)`.
 *
 * Localmente isso nunca apareceu: a primeira execução deixava o banco semeado
 * para todas as seguintes, e a guarda de contagem passava a curto-circuitar
 * antes da inserção. O defeito só existe no **primeiro** contato com um banco
 * limpo — que é o do CI, e por isso foi o CI que o encontrou.
 *
 * Reproduzi-lo exige conexões independentes: um pool só serializa o bastante
 * para esconder a corrida. Cada chamada abaixo tem o seu, e os pools são
 * aquecidos antes — sem isso, o tempo de abrir a conexão da segunda basta para
 * a primeira já ter gravado, e a janela se fecha por acidente em vez de por
 * garantia.
 */

import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "../banco-de-avaliacao";

rodar("a fixture do Book resiste a semear em paralelo", () => {
  it("quatro conexões concorrentes num banco vazio deixam um Book só", async () => {
    const conexoes = Array.from({ length: 4 }, () => createDb(URL_DO_BANCO!));
    const bancos = conexoes.map((c) => c.db as Database);

    const contar = async (db: Database) =>
      Number(
        (
          await db.execute<{ n: string }>(
            sql`SELECT count(*)::text AS n FROM book_entry WHERE created_by = 'teste:fixture'`,
          )
        ).rows[0]?.n ?? 0,
      );

    // Aquece: as quatro conexões já abertas quando a corrida começa.
    await Promise.all(bancos.map(contar));
    const antes = await contar(bancos[0]!);

    try {
      /*
        Sem `ON CONFLICT DO NOTHING` este `Promise.all` rejeita com o erro exato
        que derrubou a suíte do assistente no CI:
        `duplicate key value violates unique constraint "book_entry_block_revision_uq"`.
      */
      const resultados = await Promise.all(
        bancos.map((db) => semearBookDeTeste(db)),
      );

      // Quem perde a corrida não grava nada, e diz isso devolvendo zero.
      expect(resultados.filter((n) => n > 0).length).toBeLessThanOrEqual(1);

      const depois = await contar(bancos[0]!);
      expect(depois).toBeGreaterThan(0);
      // Nenhuma duplicata: ou o Book já estava lá, ou uma única chamada o criou.
      if (antes > 0) expect(depois).toBe(antes);
    } finally {
      await Promise.all(conexoes.map((c) => c.pool.end()));
    }
  });
});
