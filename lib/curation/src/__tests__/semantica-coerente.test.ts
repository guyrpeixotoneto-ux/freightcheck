import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { confirmAttribute, runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";
import { backfillSemantics } from "../versioning";
import { AGREGACOES, coerenciaDaSemantica } from "../agregacao";

/**
 * O banco recusa o que a autoridade chama de contradição.
 *
 * A auditoria de 16/08/2026 provou o buraco com um `UPDATE` que passou:
 * `KM_L + SUM + is_monetary + CONFIRMED`. A migration 0023 fecha, e este
 * arquivo é o que impede o fechamento de se soltar — em duas frentes.
 *
 * **Os testes negativos** mostram cada invariante recusando, nas duas tabelas.
 * Eles falham se alguém remover a constraint.
 *
 * **O teste de equivalência** é o que impede o pior: SQL e TypeScript
 * escrevendo a mesma regra e divergindo em silêncio. Ele não repete a
 * expressão — lê a definição da constraint do catálogo do Postgres com
 * `pg_get_constraintdef`, aplica-a ao produto cartesiano de unidade × agregação
 * × tipo × monetário dentro do próprio banco, e compara linha a linha com
 * `coerenciaDaSemantica`. Divergiu em uma combinação, o teste aponta qual.
 */

let ctx: TestDb;

/*
  As nove de sempre, mais duas de razão que a autoridade semântica passou a
  produzir e uma que ela ainda não produziu.

  `BRL_LITRO` e `BRL_VIAGEM` vêm do catálogo de significados; `BRL_PALLET` é a
  base que uma operação cadastra amanhã e que ninguém previu. As três entram
  aqui porque o que a 0026 trocou foi a *forma* da invariante — de uma lista de
  três unidades para o prefixo `BRL_` —, e uma lista de teste que só citasse as
  três antigas continuaria verde sobre uma regra que passou a valer para
  infinitas unidades.
*/
const UNIDADES = [
  "BRL", "BRL_KM", "BRL_LITRO", "BRL_VIAGEM", "BRL_PALLET",
  "KM_L", "PERCENT", "KM", "LITROS", "MESES", "ANO", "QTD", null,
];
/** As três executáveis, a que foi retirada, uma inventada e a ausência. */
const AGREGACOES_TESTADAS = [...AGREGACOES, "WEIGHTED_AVG", "MEDIANA", null];
const TIPOS = ["NUMERIC", "TEXT", "BOOLEAN", "DATE", "MIXED", "UNKNOWN"];
const MONETARIO = [true, false, null];

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("semantica_coerente");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  // A tabela versionada precisa existir preenchida: é metade do que a 0023 trava.
  await backfillSemantics(ctx.db);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/** O SQL de uma constraint, como o Postgres a guarda. */
async function definicaoDa(constraint: string): Promise<string> {
  const { rows } = await ctx.db.execute<{ def: string }>(sql`
    SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = ${constraint}
  `);
  expect(rows, `a constraint ${constraint} não existe`).toHaveLength(1);
  // `CHECK ((...))` → `(...)`, para virar expressão avaliável num SELECT.
  return rows[0].def.replace(/^CHECK\s*/, "");
}

describe("as invariantes recusam, uma a uma", () => {
  /*
    A cobaia precisa ser um atributo **sem semântica confirmada**. Era o
    consumo negociado até 29/08/2026; quando ele entrou no registro canônico,
    os UPDATEs abaixo passaram a esbarrar antes em
    `attribute_confirmed_monetary_is_complete` — outra invariante, também
    correta, que impedia esta de ser exercida. `custoVariavelSimulado` é
    numérico e continua sem classificação.
  */
  const recusa = (campos: string) =>
    ctx.pool.query(
      `UPDATE attribute SET ${campos} WHERE code = 'cavalo.custo_variavel_simulado'`,
    );

  it("uma razão não pode ser declarada somável — o caso da auditoria", async () => {
    await expect(
      recusa("unit='KM_L', aggregation='SUM', is_monetary=true"),
    ).rejects.toThrow(/attribute_semantica_coerente/);
  });

  it("nenhuma razão escapa — nem as três antigas, nem as que o cadastro cria", async () => {
    for (const unit of ["KM_L", "BRL_KM", "PERCENT", "BRL_LITRO", "BRL_PALLET"]) {
      await expect(recusa(`unit='${unit}', aggregation='SUM'`)).rejects.toThrow(
        /attribute_semantica_coerente/,
      );
    }
  });

  it("um tipo não numérico não admite agregação além de NONE", async () => {
    for (const tipo of ["TEXT", "BOOLEAN", "DATE", "MIXED", "UNKNOWN"]) {
      await expect(
        recusa(`data_type='${tipo}', unit=NULL, aggregation='AVG'`),
      ).rejects.toThrow(/attribute_semantica_coerente/);
      await expect(
        recusa(`data_type='${tipo}', unit=NULL, aggregation='SUM'`),
      ).rejects.toThrow(/attribute_semantica_coerente/);
    }
  });

  it("um montante financeiro é medido em reais", async () => {
    await expect(recusa("unit='MESES', is_monetary=true")).rejects.toThrow(
      /attribute_semantica_coerente/,
    );
    await expect(recusa("unit='KM', is_monetary=true")).rejects.toThrow(
      /attribute_semantica_coerente/,
    );
  });

  it("a média ponderada deixou de ser gravável", async () => {
    await expect(recusa("unit='KM', aggregation='WEIGHTED_AVG'")).rejects.toThrow(
      /attribute_semantica_coerente/,
    );
  });

  it("uma agregação inventada não entra", async () => {
    await expect(recusa("aggregation='MEDIANA'")).rejects.toThrow(
      /attribute_semantica_coerente/,
    );
  });

  it("a tabela versionada é travada pelas mesmas regras", async () => {
    const { rows } = await ctx.db.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM attribute_semantics LIMIT 1`,
    );
    // Sem uma versão gravada o UPDATE casaria zero linhas e passaria por
    // "recusa" sem nada ter sido recusado.
    expect(rows).toHaveLength(1);
    const alvo = rows[0].id;

    await expect(
      ctx.pool.query(
        `UPDATE attribute_semantics SET unit='KM_L', aggregation='SUM' WHERE id = $1`,
        [alvo],
      ),
    ).rejects.toThrow(/attribute_semantics_semantica_coerente/);
    await expect(
      ctx.pool.query(
        `UPDATE attribute_semantics SET aggregation='WEIGHTED_AVG' WHERE id = $1`,
        [alvo],
      ),
    ).rejects.toThrow(/attribute_semantics_semantica_coerente/);
  });

  it("o estado coerente continua passando — a trava não é um muro", async () => {
    await expect(
      recusa("unit='KM_L', aggregation='NONE', is_monetary=false"),
    ).resolves.toBeDefined();
  });
});

describe("a confirmação recusa antes do banco, e com a mesma frase", () => {
  it("explica em português em vez de vazar o nome da constraint", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: "cavalo.combustivel_consumo_benchmark",
        unit: "KM_L",
        aggregation: "SUM",
        isMonetary: true,
        periodicity: "MENSAL",
        actor: "guy@operalog",
        reason: "Tentando declarar consumo como somável.",
      }),
    ).rejects.toThrow(/é uma razão e não pode ser declarada somável/);
  });

  it("o motor de proposta nunca emite um estado que o banco recusaria", async () => {
    // A varredura completa do export: se a proposta e a constraint discordassem,
    // o `runProposalPass` do `beforeAll` teria falhado — mas a checagem aqui é
    // sobre o resultado, e não sobre a ausência de exceção.
    const { rows } = await ctx.db.execute<{
      code: string;
      unit: string | null;
      aggregation: string | null;
      is_monetary: boolean | null;
      data_type: string;
    }>(sql`SELECT code, unit, aggregation, is_monetary, data_type FROM attribute`);

    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) {
      const veredito = coerenciaDaSemantica({
        unit: r.unit,
        aggregation: r.aggregation,
        isMonetary: r.is_monetary,
        semanticsStatus: null,
        dataType: r.data_type,
      });
      expect(veredito.ok, `${r.code}: ${veredito.motivo}`).toBe(true);
    }
  });
});

describe("o SQL e a autoridade dizem a mesma coisa, combinação por combinação", () => {
  /**
   * Avalia a constraint real contra o produto cartesiano, dentro do banco.
   *
   * A expressão não é reescrita aqui: ela vem do catálogo, que é a que está de
   * fato anexada à tabela. Se alguém editar a migration sem editar a autoridade
   * — ou o contrário —, a divergência aparece nominalmente.
   */
  async function avaliar(
    definicao: string,
    comTipo: boolean,
  ): Promise<{ unit: string | null; aggregation: string | null; data_type: string; is_monetary: boolean | null; aceito: boolean }[]> {
    const { rows } = await ctx.db.execute<{
      unit: string | null;
      aggregation: string | null;
      data_type: string;
      is_monetary: boolean | null;
      aceito: boolean;
    }>(
      sql.raw(`
        SELECT unit, aggregation, data_type, is_monetary, ${definicao} AS aceito
          FROM (
            SELECT u AS unit, a AS aggregation, ${comTipo ? "d" : "'NUMERIC'"} AS data_type, m AS is_monetary
              FROM unnest(ARRAY[${UNIDADES.map((u) => (u === null ? "NULL" : `'${u}'`)).join(",")}]::text[]) u
             CROSS JOIN unnest(ARRAY[${AGREGACOES_TESTADAS.map((a) => (a === null ? "NULL" : `'${a}'`)).join(",")}]::text[]) a
             CROSS JOIN unnest(ARRAY[${TIPOS.map((t) => `'${t}'`).join(",")}]::text[]) d
             CROSS JOIN unnest(ARRAY[true,false,NULL]::boolean[]) m
          ) AS combinacoes
      `),
    );
    return rows;
  }

  it("attribute: cada combinação de unidade × agregação × tipo × monetário recebe o mesmo veredito", async () => {
    const definicao = await definicaoDa("attribute_semantica_coerente");
    const linhas = await avaliar(definicao, true);
    expect(linhas).toHaveLength(
      UNIDADES.length * AGREGACOES_TESTADAS.length * TIPOS.length * MONETARIO.length,
    );

    const divergencias: string[] = [];
    for (const linha of linhas) {
      const autoridade = coerenciaDaSemantica({
        unit: linha.unit,
        aggregation: linha.aggregation,
        isMonetary: linha.is_monetary,
        semanticsStatus: null,
        dataType: linha.data_type,
      });
      // `CHECK` avalia para NULL quando algum operando é NULL, e o Postgres
      // aceita a linha nesse caso — `NOT FALSE` é o que reprova.
      const bancoAceita = linha.aceito !== false;
      if (bancoAceita !== autoridade.ok) {
        divergencias.push(
          `unit=${linha.unit} agg=${linha.aggregation} tipo=${linha.data_type} ` +
            `monetario=${linha.is_monetary}: banco=${bancoAceita} autoridade=${autoridade.ok}`,
        );
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("attribute_semantics: idem, sem o tipo, que só a projeção guarda", async () => {
    const definicao = await definicaoDa("attribute_semantics_semantica_coerente");
    const linhas = await avaliar(definicao, false);

    const divergencias: string[] = [];
    for (const linha of linhas) {
      const autoridade = coerenciaDaSemantica({
        unit: linha.unit,
        aggregation: linha.aggregation,
        isMonetary: linha.is_monetary,
        semanticsStatus: null,
      });
      const bancoAceita = linha.aceito !== false;
      if (bancoAceita !== autoridade.ok) {
        divergencias.push(
          `unit=${linha.unit} agg=${linha.aggregation} monetario=${linha.is_monetary}: ` +
            `banco=${bancoAceita} autoridade=${autoridade.ok}`,
        );
      }
    }
    expect(divergencias).toEqual([]);
  });
});
