import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A lista de UUIDs vai como **um** parâmetro, e não como vários.
 *
 * O defeito que este arquivo prende chegou até Production e derrubou o
 * diagnóstico lá:
 *
 *     cannot cast type record to uuid[]
 *
 * A causa é uma sutileza do template do drizzle: `${ids}` com `ids` sendo um
 * array não vira um parâmetro de array — vira **um parâmetro por elemento**, e
 * o texto gerado fica `any(($1, $2)::uuid[])`. Isso é um *record*, e o Postgres
 * recusa convertê-lo. `sql.param()` envolve o array inteiro num parâmetro só, e
 * aí o texto é `any($1::uuid[])`, que é o que se queria escrever desde o começo.
 *
 * **Por que o teste olha o SQL gerado e não só o resultado.** Um teste que
 * apenas rodasse a consulta contra um banco passaria com uma lista de um
 * elemento e falharia com duas — que foi exatamente como o defeito escapou: em
 * desenvolvimento a competência tinha um documento por tipo, e em Production
 * tinha dois, um por quinzena. Afirmar a **forma** do parâmetro cobre os três
 * tamanhos de uma vez.
 *
 * Não precisa de banco: quem monta o texto é o dialeto, e é dele que se cobra.
 */

const dialeto = new PgDialect();
const A = "ca6f2cbe-8c58-4274-8d6e-e79dba953384";
const B = "4ad4b52e-0c33-4da8-88fb-76c51c6bffa2";

/** O trecho que interessa, e os parâmetros que o acompanham. */
function gerar(ids: string[]): { texto: string; parametros: unknown[] } {
  const consulta = dialeto.sqlToQuery(
    sql`select 1 from t where documento_id = any(${sql.param(ids)}::uuid[])`,
  );
  return {
    texto: consulta.sql.slice(consulta.sql.indexOf("any(")),
    parametros: consulta.params,
  };
}

describe("a consulta por lista de documentos", () => {
  for (const [rotulo, ids] of [
    ["um documento", [A]],
    ["dois documentos — o caso que quebrou em Production", [A, B]],
    ["três documentos", [A, B, A]],
  ] as const) {
    it(`${rotulo}: gera ANY($1::uuid[]) com um parâmetro só`, () => {
      const { texto, parametros } = gerar([...ids]);
      expect(texto).toBe("any($1::uuid[])");
      expect(parametros).toHaveLength(1);
      /* O parâmetro único é a lista inteira, que o driver serializa como array. */
      expect(parametros[0]).toEqual([...ids]);
    });
  }

  /**
   * A forma quebrada, afirmada para que ninguém a reintroduza achando que é
   * equivalente. Se um dia o drizzle passar a tratar array como parâmetro de
   * array, este teste cai — e aí a mudança é boa e a nota aqui é que sai.
   */
  it("interpolar o array direto continua gerando um record, que é o defeito", () => {
    const consulta = dialeto.sqlToQuery(
      sql`select 1 from t where documento_id = any(${[A, B]}::uuid[])`,
    );
    const texto = consulta.sql.slice(consulta.sql.indexOf("any("));
    expect(texto).toBe("any(($1, $2)::uuid[])");
    expect(consulta.params).toHaveLength(2);
  });

  /**
   * Com um elemento só, a forma quebrada **não** dá erro de record — dá erro de
   * literal de array, e com zero dá erro de sintaxe. Três mensagens diferentes
   * para o mesmo defeito é o que o fez parecer três problemas.
   */
  it("com um elemento a forma quebrada engana: gera SQL válido de outra coisa", () => {
    const consulta = dialeto.sqlToQuery(
      sql`select 1 from t where documento_id = any(${[A]}::uuid[])`,
    );
    expect(consulta.sql.slice(consulta.sql.indexOf("any("))).toBe("any(($1)::uuid[])");
  });
});
