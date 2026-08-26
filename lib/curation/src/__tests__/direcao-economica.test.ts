import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { curationEventTable } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { definirDirecaoEconomica } from "../direcao-economica";

/**
 * Dizer para que lado o dinheiro anda quando um atributo anda.
 *
 * Espelha `classificar-categoria.test.ts` § "a classe de custo é do atributo,
 * e não da natureza" de propósito: mesmo formato de escrita (projeção +
 * versão em vigor + evento), mesma exigência de responsável, mesma garantia
 * de que "já estava" não é uma segunda gravação. A diferença é o campo: aqui
 * é a direção econômica, não a classe de custo — e o vocabulário tem quatro
 * valores, não três, porque `DEPENDS_ON_FORMULA` precisa existir separado de
 * `NEUTRAL`: "a fórmula decide" não é a mesma afirmação que "não tem efeito".
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("direcao_economica");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a direção econômica é do atributo", () => {
  const CAVALO = "cavalo.ipva_licenciamento";

  it("nasce nula — ninguém curou ainda, e isso é diferente de NEUTRAL", async () => {
    const { rows } = await ctx.db.execute<{ d: string | null }>(
      sql`SELECT economic_direction AS d FROM attribute WHERE code = ${CAVALO}`,
    );
    expect(rows[0].d).toBeNull();
  });

  it("a curadoria grava na projeção e na versão em vigor", async () => {
    const r = await definirDirecaoEconomica(ctx.db, {
      code: CAVALO,
      direcao: "HIGHER_IS_WORSE",
      efeito: "IPVA maior é mais custo fixo — pior para a transportadora.",
      actor: ATOR,
      reason: "Curadoria de teste.",
    });
    expect(r).toMatchObject({ desfecho: "GRAVADA", de: null, para: "HIGHER_IS_WORSE" });

    const { rows } = await ctx.db.execute<{
      a: string | null;
      v: string | null;
      ea: string | null;
      ev: string | null;
    }>(sql`
      SELECT a.economic_direction AS a, v.economic_direction AS v,
             a.economic_effect AS ea, v.economic_effect AS ev
        FROM attribute a
        JOIN attribute_semantics v
          ON v.attribute_id = a.id AND v.effective_until IS NULL
       WHERE a.code = ${CAVALO}
    `);
    expect(rows[0]).toEqual({
      a: "HIGHER_IS_WORSE",
      v: "HIGHER_IS_WORSE",
      ea: "IPVA maior é mais custo fixo — pior para a transportadora.",
      ev: "IPVA maior é mais custo fixo — pior para a transportadora.",
    });
  });

  it("não toca no status — dizer a direção não confirma unidade, periodicidade ou agregação", async () => {
    const { rows: antes } = await ctx.db.execute<{ s: string }>(
      sql`SELECT semantics_status AS s FROM attribute WHERE code = ${CAVALO}`,
    );
    await definirDirecaoEconomica(ctx.db, {
      code: CAVALO,
      direcao: "NEUTRAL",
      actor: ATOR,
      reason: "Correção de teste.",
    });
    const { rows: depois } = await ctx.db.execute<{ s: string }>(
      sql`SELECT semantics_status AS s FROM attribute WHERE code = ${CAVALO}`,
    );
    expect(depois[0].s).toBe(antes[0].s);
  });

  it("já estava é resposta, e não uma segunda gravação", async () => {
    const r = await definirDirecaoEconomica(ctx.db, {
      code: CAVALO,
      direcao: "NEUTRAL",
      actor: ATOR,
      reason: "Sem mudança.",
    });
    expect(r.desfecho).toBe("JA_ESTAVA");
  });

  it("exige responsável — a direção decide o veredito do trecho, não é gravável sem autor", async () => {
    await expect(
      definirDirecaoEconomica(ctx.db, {
        code: CAVALO,
        direcao: "NEUTRAL",
        actor: "",
        reason: "Qualquer.",
      }),
    ).rejects.toThrow(/responsável/);
  });

  it("recusa uma direção fora do vocabulário fechado", async () => {
    await expect(
      definirDirecaoEconomica(ctx.db, {
        code: CAVALO,
        // @ts-expect-error propositalmente fora do vocabulário
        direcao: "PARA_CIMA",
        actor: ATOR,
      }),
    ).rejects.toThrow(/não existe/);
  });

  it("recusa atributo inexistente", async () => {
    await expect(
      definirDirecaoEconomica(ctx.db, {
        code: "trecho.isto_nao_existe",
        direcao: "NEUTRAL",
        actor: ATOR,
      }),
    ).rejects.toThrow(/não encontrado/);
  });

  it("grava sem efeito/justificativa, e o evento ainda diz o que mudou e por quem", async () => {
    const r = await definirDirecaoEconomica(ctx.db, {
      code: CAVALO,
      direcao: "DEPENDS_ON_FORMULA",
      actor: ATOR,
    });
    expect(r.desfecho).toBe("GRAVADA");

    const [evento] = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, CAVALO),
          eq(curationEventTable.field, "economic_direction"),
        ),
      )
      .orderBy(desc(curationEventTable.createdAt))
      .limit(1);
    expect(evento.valueAfter).toBe("DEPENDS_ON_FORMULA");
    expect(evento.actor).toBe(ATOR);
    expect(evento.reason).toBeNull();
  });
});
