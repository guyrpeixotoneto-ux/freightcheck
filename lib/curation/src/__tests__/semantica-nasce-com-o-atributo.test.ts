import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  atributosSemSemanticaAplicavel,
  attributeSemanticsTable,
  attributeTable,
  garantirSemanticaInicial,
} from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { confirmAttribute, runProposalPass } from "../engine";
import { saveMeaning } from "../meaning";
import { backfillSemantics, recordSourceSemanticsChange } from "../versioning";

/**
 * A versão de semântica não espera por ninguém.
 *
 * Este arquivo parte de um banco que passou **só** pela importação: export real
 * recebido, encenado, conferido e promovido, e nenhuma curadoria depois. É o
 * estado de um ambiente de verdade no dia seguinte à primeira carga, e é aqui
 * que o defeito morava.
 *
 * `attribute` e `attribute_semantics` são a mesma verdade em dois formatos, e
 * tinham donos diferentes: a importação criava a primeira, e a segunda só
 * nascia se alguém rodasse `backfillSemantics` — um lote da curadoria que o
 * `dev-seed` e os testes chamam, e que caminho de produção nenhum chama.
 * Medido antes da correção, nesta mesma base: **138 atributos, 138 sem versão**.
 *
 * O que se prova aqui é a invariante do ponto de vista de quem a consome: sem
 * rodar backfill nenhum, dá para gravar nome gerencial, significado **e**
 * fórmula de cálculo de qualquer atributo, e a versão inicial que sustenta isso
 * não afirma nada que ninguém tenha conferido.
 */

let ctx: TestDb;

/** O atributo do caso que abriu a investigação. */
const CODIGO = "cavalo.combustivel_vida_cavalo";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("semantica_nasce_junto");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

async function versoes(code: string) {
  const [a] = await ctx.db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  return ctx.db
    .select()
    .from(attributeSemanticsTable)
    .where(eq(attributeSemanticsTable.attributeId, a.id));
}

async function inicioDaSerie(): Promise<string> {
  const { rows } = await ctx.db.execute<{ inicio: string }>(
    sql`SELECT min(effective_date)::text AS inicio FROM snapshot`,
  );
  return rows[0].inicio;
}

describe("depois da importação, e antes de qualquer curadoria", () => {
  it("nenhum atributo ficou sem semântica", async () => {
    expect(await atributosSemSemanticaAplicavel(ctx.db)).toEqual([]);
  });

  it("grava nome, significado e fórmula na primeira tentativa", async () => {
    /*
      O caso relatado na tela, inteiro. Antes, este `saveMeaning` respondia
      "esse campo pertence à versão da semântica, que este atributo ainda não
      tem — rode o backfill antes", e a única forma de salvar o nome era apagar
      a fórmula recém-escrita.
    */
    const resultado = await saveMeaning(ctx.db, {
      code: CODIGO,
      displayName: "Consumo de Combustível",
      definition:
        "Eficiência de consumo considerada para o cavalo, em km/L: quantos " +
        "quilômetros o veículo percorre com 1 litro de diesel.",
      calculationBasis: "Litros estimados = Quilometragem ÷ Consumo (km/L).",
      actor: "guy@operalog",
    });

    expect(resultado.notWritten).toBeNull();
    expect(resultado.changed).toEqual(
      expect.arrayContaining(["display_name", "definition", "calculation_basis"]),
    );
    expect(resultado.calculationBasis).toBe(
      "Litros estimados = Quilometragem ÷ Consumo (km/L).",
    );

    // E está na linha versionada, que é onde a fórmula mora.
    const [emVigor] = await versoes(CODIGO).then((vs) =>
      vs.filter((v) => v.effectiveUntil === null),
    );
    expect(emVigor.calculationBasis).toBe(
      "Litros estimados = Quilometragem ÷ Consumo (km/L).",
    );
    expect(emVigor.definition).toContain("km/L");
  });

  it("gravar significado continua não destravando dinheiro", async () => {
    // A correção é sobre onde a semântica mora, não sobre o que ela permite.
    const [a] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, CODIGO));
    expect(a.semanticsStatus).toBe("UNKNOWN");
    expect(a.confirmedBy).toBeNull();
    expect(a.unit).toBeNull();
  });

  it("a versão inicial cobre a série desde a vigência mais antiga", async () => {
    const inicio = await inicioDaSerie();
    const [{ fora }] = await ctx.db
      .select({ fora: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeSemanticsTable)
      .where(
        and(
          eq(attributeSemanticsTable.changeOrigin, "INITIAL"),
          sql`${attributeSemanticsTable.effectiveFrom} <> ${inicio}::date`,
        ),
      );
    expect(fora).toBe(0);
  });
});

describe("quem escreve semântica escreve a versão em vigor", () => {
  /*
    A outra metade do mesmo defeito, e a que só apareceu depois de a primeira
    ser corrigida.

    `attribute` é a projeção da versão em vigor, e a comparação leva isso a
    sério: ela resolve unidade e agregação lendo `attribute_semantics` na data
    de cada vigência. Enquanto a tabela versionada estava vazia em produção,
    escrever só a projeção acertava por acidente — não havia versão para
    contradizê-la. Com toda coluna nascendo versionada, uma confirmação que só
    tocasse `attribute` produziria um atributo confirmado cuja versão em vigor
    continua dizendo "não sei", e o valor sumiria da soma em silêncio.

    Foi exatamente o que 11 testes da comparação acusaram quando a versão 1
    passou a existir. Este bloco é o que impede a volta.
  */
  const ALVO = "carreta.ano";

  it("a passagem de propostas escreve nas duas", async () => {
    await runProposalPass(ctx.db, "test:proposal");

    const [a] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, ALVO));
    const [emVigor] = await versoes(ALVO).then((vs) =>
      vs.filter((v) => v.effectiveUntil === null),
    );

    expect(emVigor.semanticsStatus).toBe(a.semanticsStatus);
    expect(emVigor.unit).toBe(a.unit);
    expect(emVigor.aggregation).toBe(a.aggregation);
    expect(emVigor.isMonetary).toBe(a.isMonetary);
    expect(emVigor.taxonomyNodeId).toBe(a.taxonomyNodeId);
  });

  it("a confirmação também, e é ela que autoriza a soma", async () => {
    await confirmAttribute(ctx.db, {
      code: CODIGO,
      unit: "KM_L",
      periodicity: "MENSAL",
      aggregation: "AVG",
      isMonetary: false,
      actor: "guy@operalog",
      reason: "Consumo em km/L conferido com a operação; média, nunca soma.",
    });

    const [emVigor] = await versoes(CODIGO).then((vs) =>
      vs.filter((v) => v.effectiveUntil === null),
    );
    expect(emVigor.semanticsStatus).toBe("CONFIRMED");
    expect(emVigor.unit).toBe("KM_L");
    expect(emVigor.periodicity).toBe("MENSAL");
    expect(emVigor.aggregation).toBe("AVG");
    expect(emVigor.isMonetary).toBe(false);
    expect(emVigor.confirmedBy).toBe("guy@operalog");
    // E a fórmula escrita antes da confirmação continua lá: são atos distintos
    // sobre a mesma linha, e nenhum apaga o outro.
    expect(emVigor.calculationBasis).toContain("Quilometragem");
  });
});

describe("garantir a invariante é uma operação repetível", () => {
  it("não cria nem move nada num banco em dia", async () => {
    const resultado = await garantirSemanticaInicial(ctx.db);
    expect(resultado.criadas).toBe(0);
    expect(resultado.ajustadas).toBe(0);
    expect(resultado.inicio).toBe(await inicioDaSerie());
  });

  it("o backfill da curadoria responde o mesmo, e continua sendo no-op", async () => {
    // Ele não some: `dev-seed` o chama, e uma base anterior à correção ainda
    // tem o que criar. O que mudou é que a regra dele agora é a mesma da
    // importação, escrita uma vez só.
    const resultado = await backfillSemantics(ctx.db);
    expect(resultado.created).toBe(0);
    expect(resultado.existing).toBeGreaterThan(0);
    expect(resultado.from).toBe(await inicioDaSerie());
  });

  it("puxa de volta uma versão inicial que começou tarde demais", async () => {
    /*
      O estado que uma importação retroativa deixa: a versão 1 foi criada
      quando a série começava em fevereiro, e depois chegou o arquivo de
      dezembro. Sem o ajuste, a comparação da vigência antiga não resolve
      semântica nenhuma — e não reclama, apenas cai na projeção.
    */
    const inicio = await inicioDaSerie();
    const [alvo] = await versoes("cavalo.ipva_licenciamento");
    await ctx.db
      .update(attributeSemanticsTable)
      .set({ effectiveFrom: "2026-07-01" })
      .where(eq(attributeSemanticsTable.id, alvo.id));

    const resultado = await garantirSemanticaInicial(ctx.db);
    expect(resultado.ajustadas).toBe(1);
    expect(resultado.criadas).toBe(0);

    const [depois] = await versoes("cavalo.ipva_licenciamento");
    expect(depois.effectiveFrom).toBe(inicio);
  });

  it("não toca na data de uma versão aberta por mudança da fonte", async () => {
    /*
      A data da versão 2 **significa** alguma coisa: é a vigência a partir da
      qual a Ambev passou a calcular diferente. Normalizá-la reescreveria o
      passado — exatamente o que a semântica versionada existe para impedir.
    */
    await recordSourceSemanticsChange(ctx.db, {
      code: "cavalo.ipva_licenciamento",
      effectiveFrom: "2026-06-02",
      calculationBasis: "0,651% do valor da NF.",
      actor: "guy@operalog",
      reason: "A fonte mudou a base de cálculo a partir de junho.",
    });

    const resultado = await garantirSemanticaInicial(ctx.db);
    expect(resultado.ajustadas).toBe(0);

    const todas = await versoes("cavalo.ipva_licenciamento");
    const v1 = todas.find((v) => v.version === 1)!;
    const v2 = todas.find((v) => v.version === 2)!;
    expect(v1.effectiveFrom).toBe(await inicioDaSerie());
    expect(v1.effectiveUntil).toBe("2026-06-02");
    expect(v2.effectiveFrom).toBe("2026-06-02");
    expect(v2.changeOrigin).toBe("SOURCE_SEMANTICS_CHANGE");
  });

  it("e a versão em vigor continua sendo uma só", async () => {
    const [{ abertas }] = await ctx.db
      .select({ abertas: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeSemanticsTable)
      .where(isNull(attributeSemanticsTable.effectiveUntil));
    const [{ atributos }] = await ctx.db
      .select({ atributos: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeTable);
    expect(abertas).toBe(atributos);
  });
});
