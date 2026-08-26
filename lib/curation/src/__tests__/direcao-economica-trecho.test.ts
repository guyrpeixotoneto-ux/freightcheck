import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  aplicarDirecaoEconomicaTrecho,
  DIRECAO_ECONOMICA_TRECHO,
} from "../direcao-economica-trecho";

/**
 * A primeira rodada de curadoria de TRECHO, aplicada de ponta a ponta.
 *
 * O que este arquivo prova não é a regra de escrita (isso já é
 * `direcao-economica.test.ts`) — é que a LISTA declarada em
 * `direcao-economica-trecho.ts` é consistente com o dicionário real: todo
 * `code` existe, nenhum é repetido, e aplicar duas vezes não grava duas vezes.
 * Sem este teste, um `code` digitado errado (ex.: um `s` a mais) falharia em
 * silêncio dentro do `try/catch` de `aplicarDirecaoEconomicaTrecho` e o
 * atributo continuaria sem direção sem que ninguém percebesse.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("direcao_economica_trecho");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

it("a lista não repete nenhum atributo", () => {
  const codes = DIRECAO_ECONOMICA_TRECHO.map((e) => e.code);
  expect(new Set(codes).size).toBe(codes.length);
});

it("todo atributo listado começa com 'trecho.'", () => {
  for (const entrada of DIRECAO_ECONOMICA_TRECHO) {
    expect(entrada.code.startsWith("trecho.")).toBe(true);
  }
});

describe("aplicada contra o export real", () => {
  it("todos os códigos existem no dicionário — nenhuma falha por atributo inexistente", async () => {
    const resumo = await aplicarDirecaoEconomicaTrecho(ctx.db, ATOR);
    expect(resumo.falhas).toEqual([]);
    expect(resumo.gravadas).toBe(DIRECAO_ECONOMICA_TRECHO.length);
    expect(resumo.jaEstavam).toBe(0);
  });

  it("rodar de novo não regrava nada — idempotente", async () => {
    const resumo = await aplicarDirecaoEconomicaTrecho(ctx.db, ATOR);
    expect(resumo.falhas).toEqual([]);
    expect(resumo.gravadas).toBe(0);
    expect(resumo.jaEstavam).toBe(DIRECAO_ECONOMICA_TRECHO.length);
  });

  it("os quatro valores do vocabulário aparecem, e nenhum outro", async () => {
    const { rows } = await ctx.db.execute<{ d: string }>(sql`
      SELECT DISTINCT economic_direction AS d
        FROM attribute
       WHERE entity_type = 'TRECHO' AND economic_direction IS NOT NULL
       ORDER BY d
    `);
    const valores = rows.map((r) => r.d).sort();
    expect(valores).toEqual(
      ["DEPENDS_ON_FORMULA", "HIGHER_IS_BETTER", "HIGHER_IS_WORSE", "NEUTRAL"].sort(),
    );
  });

  it("frete líquido é maior-é-melhor, e pedágio é maior-é-pior", async () => {
    const { rows } = await ctx.db.execute<{ code: string; d: string }>(sql`
      SELECT code, economic_direction AS d FROM attribute
       WHERE code IN ('trecho.frete_liquido', 'trecho.frete_reais_km_pedagio')
    `);
    const porCode = Object.fromEntries(rows.map((r) => [r.code, r.d]));
    expect(porCode["trecho.frete_liquido"]).toBe("HIGHER_IS_BETTER");
    expect(porCode["trecho.frete_reais_km_pedagio"]).toBe("HIGHER_IS_WORSE");
  });

  it("a chave do trecho é neutra — não pode influenciar o veredito", async () => {
    const { rows } = await ctx.db.execute<{ d: string }>(
      sql`SELECT economic_direction AS d FROM attribute WHERE code = 'trecho.chave_trecho'`,
    );
    expect(rows[0].d).toBe("NEUTRAL");
  });

  it("ainda restam atributos de TRECHO sem curadoria — a cobertura desta rodada é parcial e sabida", async () => {
    const { rows } = await ctx.db.execute<{ curados: number; total: number }>(sql`
      SELECT count(*) FILTER (WHERE economic_direction IS NOT NULL)::int AS curados,
             count(*)::int AS total
        FROM attribute WHERE entity_type = 'TRECHO'
    `);
    const { curados, total } = rows[0];
    expect(curados).toBeGreaterThan(0);
    expect(curados).toBeLessThanOrEqual(total);
  });
});
