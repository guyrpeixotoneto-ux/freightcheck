import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { curationEventTable } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { declararTipoDoValor } from "../tipo-do-valor";
import { seedSignificados } from "../catalogo";
import { codigoDe } from "../significado";

/**
 * Declarar o tipo do valor sem confirmar a coluna.
 *
 * Espelha `direcao-economica.test.ts` de propósito — mesma dupla de escrita,
 * mesmo evento, mesma exigência de responsável —, e o que este arquivo tem a
 * mais é a garantia que dá razão de existir à operação: **os quatro campos
 * técnicos não se movem**. Se `declararTipoDoValor` escrevesse `unit`,
 * `periodicity`, `aggregation` ou `is_monetary`, uma declaração sem assinatura
 * teria o efeito de uma confirmação assinada, e o portão que impede um número
 * mal entendido de entrar numa soma financeira estaria aberto pela tela que
 * existe justamente para ser a metade barata da curadoria.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";
const CAVALO = "cavalo.ipva_licenciamento";
const MONTANTE_MES = codigoDe("MONTANTE", "MES");
const GRANDEZA_KM = codigoDe("GRANDEZA", "KM");

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("tipo_do_valor");
  // O catálogo de significados é o que a declaração consulta. A migration já o
  // grava; semear de novo é idempotente e cobre um banco vindo de antes dela.
  await seedSignificados(ctx.db, ATOR);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Os quatro campos que só a confirmação escreve, mais o portão. */
async function tecnicos(code: string) {
  const { rows } = await ctx.db.execute<{
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    semantics_status: string;
  }>(sql`
    SELECT unit, periodicity, aggregation, is_monetary, semantics_status
      FROM attribute WHERE code = ${code}
  `);
  return rows[0];
}

describe("o tipo do valor é declarável sem confirmar", () => {
  it("grava o significado na projeção e na versão em vigor", async () => {
    const r = await declararTipoDoValor(ctx.db, {
      code: CAVALO,
      meaningCode: MONTANTE_MES,
      actor: ATOR,
    });
    expect(r).toMatchObject({ desfecho: "GRAVADO", para: MONTANTE_MES });

    const { rows } = await ctx.db.execute<{ a: string | null; v: string | null }>(sql`
      SELECT ma.code AS a, mv.code AS v
        FROM attribute a
        JOIN attribute_semantics v
          ON v.attribute_id = a.id AND v.effective_until IS NULL
        LEFT JOIN semantic_meaning ma ON ma.id = a.meaning_id
        LEFT JOIN semantic_meaning mv ON mv.id = v.meaning_id
       WHERE a.code = ${CAVALO}
    `);
    expect(rows[0]).toEqual({ a: MONTANTE_MES, v: MONTANTE_MES });
  });

  it("não move os quatro campos técnicos nem o status — declarar não é confirmar", async () => {
    const antes = await tecnicos(CAVALO);
    await declararTipoDoValor(ctx.db, {
      code: CAVALO,
      meaningCode: GRANDEZA_KM,
      actor: ATOR,
    });
    expect(await tecnicos(CAVALO)).toEqual(antes);
  });

  it("o evento diz o código anterior, e não o uuid guardado na coluna", async () => {
    const [evento] = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, CAVALO),
          eq(curationEventTable.field, "meaning_id"),
        ),
      )
      .orderBy(desc(curationEventTable.createdAt))
      .limit(1);
    expect(evento.valueBefore).toBe(MONTANTE_MES);
    expect(evento.valueAfter).toBe(GRANDEZA_KM);
    expect(evento.actor).toBe(ATOR);
  });

  it("já estava é resposta, e não uma segunda gravação", async () => {
    const r = await declararTipoDoValor(ctx.db, {
      code: CAVALO,
      meaningCode: GRANDEZA_KM,
      actor: ATOR,
    });
    expect(r.desfecho).toBe("JA_ESTAVA");
  });

  it("exige responsável", async () => {
    await expect(
      declararTipoDoValor(ctx.db, {
        code: CAVALO,
        meaningCode: GRANDEZA_KM,
        actor: "",
      }),
    ).rejects.toThrow(/responsável/);
  });

  it("recusa um tipo que o cadastro não conhece, em vez de gravar um meaning_id inventado", async () => {
    await expect(
      declararTipoDoValor(ctx.db, {
        code: CAVALO,
        meaningCode: "taxa_parsec",
        actor: ATOR,
      }),
    ).rejects.toThrow(/não existe no cadastro/);
  });

  it("recusa atributo inexistente", async () => {
    await expect(
      declararTipoDoValor(ctx.db, {
        code: "trecho.isto_nao_existe",
        meaningCode: GRANDEZA_KM,
        actor: ATOR,
      }),
    ).rejects.toThrow(/não encontrado/);
  });
});
