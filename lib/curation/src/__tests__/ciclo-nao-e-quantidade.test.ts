import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";
import { podeSomar, podeTirarMedia } from "../agregacao";

/**
 * `ciclo` é fase de contrato, e o export prova isso — não o nome da coluna.
 *
 * A auditoria classificou os dois `ciclo` como ERRADO por inspeção: ordinal
 * recebendo média. Antes de mexer, a investigação foi ao dado, e estes testes
 * são as três medições que a sustentaram, feitas de novo a cada execução contra
 * o arquivo real. Se a Ambev mandar um export em que `ciclo` deixe de se
 * comportar assim, é aqui que se descobre — e a correção passa a merecer outra
 * conversa, em vez de continuar valendo por inércia.
 *
 * O que **não** está aqui: a unidade. `QTD` continua errado, e trocá-la exigiria
 * um rótulo que o modelo ainda não tem. Ficar em `QTD` com `NONE` já impede toda
 * a aritmética, que é o dano que existia.
 */

let ctx: TestDb;

const CICLOS = ["carreta.ciclo", "cavalo.ciclo"];

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("ciclo_semantica");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o que o export diz sobre ciclo", () => {
  it("só existem dois valores, e são inteiros", async () => {
    for (const code of CICLOS) {
      const { rows } = await ctx.db.execute<{ valores: string; inteiros: boolean }>(sql`
        SELECT string_agg(DISTINCT f.value_numeric::int::text, ',' ORDER BY f.value_numeric::int::text) AS valores,
               bool_and(f.value_numeric = trunc(f.value_numeric)) AS inteiros
          FROM fact f JOIN attribute a ON a.id = f.attribute_id
         WHERE a.code = ${code} AND NOT f.is_null
      `);
      expect(rows[0].valores, code).toBe("1,2");
      expect(rows[0].inteiros, code).toBe(true);
    }
  });

  it("a transição é monotônica: sempre de 1 para 2, nunca de volta", async () => {
    const { rows } = await ctx.db.execute<{ de: string; para: string; n: number }>(sql`
      WITH s AS (
        SELECT f.entity_id, a.code, sn.effective_date, f.value_numeric v,
               lag(f.value_numeric) OVER (
                 PARTITION BY f.entity_id, a.code ORDER BY sn.effective_date
               ) ant
          FROM fact f
          JOIN attribute a ON a.id = f.attribute_id
          JOIN snapshot sn ON sn.id = f.snapshot_id
         WHERE a.code LIKE '%.ciclo' AND NOT f.is_null AND sn.status <> 'SUPERSEDED'
      )
      SELECT ant::int::text AS de, v::int::text AS para, count(*)::int AS n
        FROM s WHERE ant IS NOT NULL AND ant <> v GROUP BY 1, 2
    `);

    // Uma direção só, e é o que separa fase de contagem: uma quantidade sobe e
    // desce, uma fase avança.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ de: "1", para: "2" });
    expect(rows[0].n).toBeGreaterThan(10);
  });

  it("ciclo 1 não recebe lucro de novo ciclo; ciclo 2 recebe", async () => {
    const { rows } = await ctx.db.execute<{ ciclo: string; linhas: number; com_lucro: number }>(sql`
      SELECT c.value_numeric::int::text AS ciclo,
             count(*)::int AS linhas,
             count(*) FILTER (WHERE l.value_numeric > 0)::int AS com_lucro
        FROM fact c
        JOIN attribute ac ON ac.id = c.attribute_id AND ac.code = 'cavalo.ciclo'
        JOIN attribute al ON al.code = 'cavalo.lucro_fixomodelo_novo_ciclo_cavalo'
        JOIN fact l ON l.attribute_id = al.id
                   AND l.entity_id = c.entity_id
                   AND l.snapshot_id = c.snapshot_id
       WHERE NOT c.is_null AND NOT l.is_null
       GROUP BY 1 ORDER BY 1
    `);

    const ciclo1 = rows.find((r) => r.ciclo === "1")!;
    const ciclo2 = rows.find((r) => r.ciclo === "2")!;
    // O portão: no primeiro ciclo o lucro do novo ciclo não existe, em nenhuma
    // das centenas de linhas. É a evidência de que o número nomeia um estado.
    expect(ciclo1.com_lucro).toBe(0);
    expect(ciclo2.com_lucro / ciclo2.linhas).toBeGreaterThan(0.9);
  });
});

describe("antes e depois da correção", () => {
  it("ANTES: com AVG, a autoridade publicaria uma média de ciclos", () => {
    // O estado que a auditoria encontrou, reproduzido em memória: é o que a
    // série do detalhe usava para publicar `average = 1,16`.
    const antes = { unit: "QTD", aggregation: "AVG", isMonetary: false, semanticsStatus: "PRESUMED" };
    expect(podeTirarMedia(antes).ok).toBe(true);
  });

  it("DEPOIS: o motor propõe NONE, e a média deixa de existir", async () => {
    for (const code of CICLOS) {
      const { rows } = await ctx.db.execute<{
        aggregation: string | null;
        unit: string | null;
        rationale: string;
      }>(sql`
        SELECT aggregation, unit, semantics_rationale AS rationale
          FROM attribute WHERE code = ${code}
      `);
      const depois = {
        unit: rows[0].unit,
        aggregation: rows[0].aggregation,
        isMonetary: false,
        semanticsStatus: "PRESUMED",
      };

      expect(rows[0].aggregation, code).toBe("NONE");
      expect(podeTirarMedia(depois).ok, code).toBe(false);
      expect(podeSomar(depois).ok, code).toBe(false);
      // O parecer diz o que foi medido, e não "não numérico".
      expect(rows[0].rationale, code).toMatch(/fase/i);
    }
  });

  it("a unidade não foi inventada: segue QTD, e a pendência fica dita", async () => {
    const { rows } = await ctx.db.execute<{ unit: string | null }>(
      sql`SELECT unit FROM attribute WHERE code = 'cavalo.ciclo'`,
    );
    expect(rows[0].unit).toBe("QTD");
  });

  it("nenhum outro atributo do export mudou de agregação junto", async () => {
    // A correção é dos dois `ciclo`, e a lista de nomes de estado é curta de
    // propósito: se um dia ela crescer sem medição, é aqui que aparece.
    const { rows } = await ctx.db.execute<{ code: string }>(sql`
      SELECT code FROM attribute WHERE aggregation = 'NONE' AND data_type = 'NUMERIC' AND unit = 'QTD'
    `);
    expect(rows.map((r) => r.code).sort()).toEqual(CICLOS);
  });
});
