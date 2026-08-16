import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture } from "@workspace/comparison/testing";
import { seedTaxonomy } from "@workspace/curation";
import { refazerAgregado, vigenciasSemAgregado } from "../agregado";
import { visaoDaCobertura } from "../matriz";

/**
 * A vigência que existe e a medição que sumiu.
 *
 * O estado foi visto na tela e é o motivo deste arquivo: nove vigências no
 * banco, o seletor de unidade exibindo Camaçari com a vigência de ago/2026, e
 * Cobertura de dados anunciando **"nenhuma vigência importada ainda"** — porque
 * `linhas` volta vazia quando nenhuma vigência tem agregado, e a tela lia lista
 * vazia como banco vazio.
 *
 * Três coisas precisam continuar valendo, e cada `describe` prova uma:
 *
 * 1. sem agregado, o módulo diz que **não mediu** — nunca que não há dado;
 * 2. refazer devolve exatamente os números que a promoção teria escrito;
 * 3. refazer duas vezes não escreve nada na segunda, e nunca sobrescreve.
 *
 * A fixture serve bem justamente porque calcula o agregado por outro caminho:
 * ela o monta em JavaScript enquanto insere os fatos, e `refazerAgregado` o
 * recalcula em SQL a partir dos fatos já gravados. As duas contas baterem é uma
 * concordância entre derivações independentes, e não uma consulta conferindo a
 * si mesma.
 */
let ctx: TestDb;

const ESCOPO = "agregado_perdido";

const placas = (prefixo: string, quantidade: number, atributos: Record<string, number>) => {
  const dados: Record<string, Record<string, number>> = {};
  for (let i = 0; i < quantidade; i++) {
    dados[`${prefixo}${String(i).padStart(4, "0")}`] = { ...atributos };
  }
  return dados;
};

/** O agregado inteiro, ordenado — para comparar antes e depois campo a campo. */
async function agregado(db: TestDb["db"]) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT snapshot_id::text, entity_type, entity_count, attribute_count,
           fact_count, value_count, null_count, inherited_fact_count
      FROM snapshot_entity_type
     ORDER BY snapshot_id, entity_type
  `);
  return rows;
}

beforeAll(async () => {
  ctx = await createTestDatabase("cobertura_agregado");
  await seedTaxonomy(ctx.db, "test");

  const atributos = ["a", "b", "c"].map((letra) => ({
    code: `carreta.attr_${letra}`,
    dataType: "NUMERIC" as const,
    semanticsStatus: "CONFIRMED" as const,
  }));
  const valores = { "carreta.attr_a": 1, "carreta.attr_b": 2, "carreta.attr_c": 3 };

  await buildFixture(
    ctx.db,
    atributos,
    [
      { label: "AG_1_1_2026", effectiveDate: "2026-01-01", data: placas("AGA", 40, valores) },
      { label: "AG_1_2_2026", effectiveDate: "2026-02-01", data: placas("AGA", 40, valores) },
      { label: "AG_1_3_2026", effectiveDate: "2026-03-01", data: placas("AGA", 40, valores) },
    ],
    { entityType: "CARRETA", scopeHash: ESCOPO, canal: "AGREG" },
  );
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("1. sem agregado, o módulo diz que não mediu — não que não há dado", () => {
  it("a matriz fica vazia e cada vigência entra em `incompleto`", async () => {
    const sadia = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    expect(sadia.linhas).toHaveLength(1);
    expect(sadia.incompleto).toEqual([]);

    await ctx.db.execute(sql`DELETE FROM snapshot_entity_type`);

    const cega = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    expect(cega.linhas).toEqual([]);
    /* As três vigências continuam sendo colunas: elas existem, e a tela as vê. */
    expect(cega.colunas).toHaveLength(3);
    expect(cega.incompleto.map((i) => i.vigencia).sort()).toEqual([
      "AG_1_1_2026",
      "AG_1_2_2026",
      "AG_1_3_2026",
    ]);
  });

  it("o veredito não diz que nada foi importado", async () => {
    /*
      A regressão inteira em uma asserção. Enquanto `resumir` devolvia
      `resumoVazio()` para zero células, esta frase era "Nenhuma vigência
      importada ainda" — com três vigências no banco, e com a tela mandando
      importar a primeira planilha para consertar.
    */
    const cega = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    expect(cega.resumo.veredito.estado).toBe("SEM_DADO");
    expect(cega.resumo.veredito.frase).not.toMatch(/[Nn]enhuma vigência importada/);
    expect(cega.resumo.veredito.frase).toMatch(/sem o agregado|sem agregado/);
  });

  it("banco sem vigência nenhuma continua dizendo que nada foi importado", async () => {
    /* O outro lado: a frase antiga tem de sobreviver onde ela é verdadeira. */
    const vazio = await visaoDaCobertura(ctx.db, { scopeHash: "escopo_que_nao_existe" });
    expect(vazio.linhas).toEqual([]);
    expect(vazio.incompleto).toEqual([]);
    expect(vazio.resumo.veredito.frase).toMatch(/[Nn]enhuma vigência importada ainda/);
  });
});

describe("2. refazer devolve o número que a promoção teria escrito", () => {
  it("a lista de pendentes é a das vigências com fato e sem agregado", async () => {
    const pendentes = await vigenciasSemAgregado(ctx.db);
    expect(pendentes.map((p) => p.sourceLabel).sort()).toEqual([
      "AG_1_1_2026",
      "AG_1_2_2026",
      "AG_1_3_2026",
    ]);
    for (const p of pendentes) expect(p.fatos).toBe(40 * 3);
  });

  it("o agregado refeito é idêntico ao que a fixture escreveu, campo a campo", async () => {
    const esperado = [
      { entity_count: 40, attribute_count: 3, fact_count: 120, value_count: 120, null_count: 0 },
    ];

    const reparo = await refazerAgregado(ctx.db);
    expect(reparo.vigencias).toBe(3);
    expect(reparo.linhas).toBe(3);

    const depois = await agregado(ctx.db);
    expect(depois).toHaveLength(3);
    for (const linha of depois) {
      expect(linha.entity_type).toBe("CARRETA");
      expect(Number(linha.entity_count)).toBe(esperado[0]!.entity_count);
      expect(Number(linha.attribute_count)).toBe(esperado[0]!.attribute_count);
      expect(Number(linha.fact_count)).toBe(esperado[0]!.fact_count);
      expect(Number(linha.value_count)).toBe(esperado[0]!.value_count);
      expect(Number(linha.null_count)).toBe(esperado[0]!.null_count);
      expect(Number(linha.inherited_fact_count)).toBe(0);
    }
  });

  it("a matriz volta a ser a mesma de antes da perda", async () => {
    const restaurada = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    expect(restaurada.linhas).toHaveLength(1);
    expect(restaurada.colunas).toHaveLength(3);
    expect(restaurada.incompleto).toEqual([]);
    expect(restaurada.resumo.geral.percentual).toBe(100);
  });
});

describe("3. refazer é idempotente e nunca sobrescreve", () => {
  it("a segunda chamada não tem o que fazer", async () => {
    const antes = await agregado(ctx.db);
    const reparo = await refazerAgregado(ctx.db);

    expect(reparo).toEqual({ vigencias: 0, linhas: 0, rotulos: [] });
    expect(await agregado(ctx.db)).toEqual(antes);
  });

  it("o filtro que não deixa célula não vira 'nenhuma vigência importada'", async () => {
    /*
      A terceira forma de a matriz ficar vazia, e a que o usuário alcança
      sozinho: pedir CAVALO num recorte que só tem CARRETA. Nada está quebrado
      aqui — mas a frase antiga era a mesma das outras duas, e mandava importar
      a primeira planilha para consertar uma escolha de filtro.
    */
    const filtrada = await visaoDaCobertura(ctx.db, {
      scopeHash: ESCOPO,
      vigencias: 3,
      entityType: "CAVALO",
    });

    expect(filtrada.linhas).toEqual([]);
    expect(filtrada.incompleto).toEqual([]);
    /* As vigências continuam visíveis: é o que prova que há dado fora do filtro. */
    expect(filtrada.colunas).toHaveLength(3);
    expect(filtrada.resumo.veredito.frase).not.toMatch(/[Nn]enhuma vigência importada/);
    expect(filtrada.resumo.veredito.frase).toMatch(/filtro/i);
  });

  it("um agregado divergente é preservado — refazer não é recontar a base", async () => {
    /*
      A distinção que mantém esta rota barata e segura. Refazer restaura a
      contagem de quem a perdeu; corrigir uma contagem que existe e está errada
      é outra operação, com outro custo e outro dono. Se este teste um dia
      falhar, alguém transformou um reparo em recomputação silenciosa da base.
    */
    await ctx.db.execute(sql`UPDATE snapshot_entity_type SET entity_count = 999`);
    const reparo = await refazerAgregado(ctx.db);

    expect(reparo.vigencias).toBe(0);
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM snapshot_entity_type WHERE entity_count = 999`,
    );
    expect(Number(rows[0]!.n)).toBe(3);
  });
});
