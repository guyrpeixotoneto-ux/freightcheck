import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  atributosSemSemanticaAplicavel,
  attributeSemanticsTable,
  attributeTable,
  conferirIntegridadeSemantica,
  divergenciasDaProjecao,
  integridadeEmDia,
} from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { confirmAttribute, runProposalPass } from "../engine";
import { saveMeaning } from "../meaning";
import { correctSemantics, recordSourceSemanticsChange } from "../versioning";

/**
 * As duas invariantes contra o export real, violadas de propósito.
 *
 * O comando `conferir-schema` sabia perguntar se as tabelas e as colunas estão
 * lá. Um banco pode passar nessa pergunta inteira e ainda assim somar dinheiro
 * por uma semântica que nenhuma tela mostra — foi o que aconteceu por todo o
 * tempo em que `attribute_semantics` esteve vazia em produção, com 23 de 23
 * migrations registradas e o `/healthz` respondendo SAUDAVEL.
 *
 * Cada bloco abaixo põe o banco num dos estados inválidos que existem de
 * verdade e confere que a invariante o **acusa**, nomeando o atributo. Nenhum
 * deles é consertado por nada aqui: o que se prova, junto, é que a escrita não
 * cria esses estados e que o diagnóstico os enxerga quando eles vêm de antes.
 */

let ctx: TestDb;

const CODIGO = "cavalo.combustivel_vida_cavalo";
const OUTRO = "cavalo.ipva_licenciamento";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("integridade_semantica");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

async function idDe(code: string): Promise<string> {
  const [a] = await ctx.db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  return a.id;
}

describe("um banco recém-importado passa nas duas", () => {
  it("todo atributo tem versão aplicável, e a projeção concorda com ela", async () => {
    const integridade = await conferirIntegridadeSemantica(ctx.db);

    expect(integridade.semSemanticaAplicavel).toEqual([]);
    expect(integridade.divergencias).toEqual([]);
    expect(integridade.atributos).toBeGreaterThan(100);
    expect(integridadeEmDia(integridade)).toBe(true);
  });

  it("continua passando depois de curar, confirmar e escrever significado", async () => {
    /*
      O teste que dá sentido aos outros: se a escrita criasse estado inválido,
      não haveria diagnóstico que salvasse. Os três atos que mexem em semântica
      passam aqui em sequência, sobre o banco real.
    */
    await runProposalPass(ctx.db, "test:proposal");
    await saveMeaning(ctx.db, {
      code: CODIGO,
      displayName: "Consumo de Combustível",
      definition: "Quantos quilômetros o cavalo percorre com 1 litro de diesel.",
      calculationBasis: "Litros estimados = Quilometragem ÷ Consumo (km/L).",
      actor: "guy@operalog",
    });
    await confirmAttribute(ctx.db, {
      code: CODIGO,
      unit: "KM_L",
      periodicity: "MENSAL",
      aggregation: "AVG",
      isMonetary: false,
      actor: "guy@operalog",
      reason: "Consumo em km/L conferido com a operação; média, nunca soma.",
    });

    expect(await divergenciasDaProjecao(ctx.db)).toEqual([]);
    expect(await atributosSemSemanticaAplicavel(ctx.db)).toEqual([]);
  });

  it("uma mudança da fonte não é divergência — é a versão nova sendo projetada", async () => {
    await recordSourceSemanticsChange(ctx.db, {
      code: OUTRO,
      effectiveFrom: "2026-06-02",
      calculationBasis: "0,651% do valor da NF.",
      actor: "guy@operalog",
      reason: "A fonte mudou a base de cálculo a partir de junho.",
    });
    expect(await divergenciasDaProjecao(ctx.db)).toEqual([]);

    // E uma correção da versão também projeta, em vez de deixar as duas brigando.
    await correctSemantics(ctx.db, {
      code: OUTRO,
      unit: "BRL",
      actor: "guy@operalog",
      reason: "A base é em reais; a leitura anterior estava errada.",
    });
    expect(await divergenciasDaProjecao(ctx.db)).toEqual([]);
  });
});

describe("invariante 1 — semântica aplicável", () => {
  it("acusa o atributo cuja versão foi apagada por fora", async () => {
    // O estado de todo banco anterior à 0025, reproduzido numa coluna só.
    const id = await idDe("carreta.ano");
    await ctx.db
      .delete(attributeSemanticsTable)
      .where(eq(attributeSemanticsTable.attributeId, id));

    const achados = await atributosSemSemanticaAplicavel(ctx.db);
    expect(achados).toEqual([
      {
        code: "carreta.ano",
        motivo: "SEM_VERSAO",
        detalhe: "não tem nenhuma linha em attribute_semantics",
      },
    ]);
    // E o comando inteiro reprova por causa disso.
    expect(integridadeEmDia(await conferirIntegridadeSemantica(ctx.db))).toBe(false);
  });

  it("acusa o atributo cujo histórico existe mas não descreve o presente", async () => {
    /*
      Uma versão fechada e nenhuma aberta: acontece se alguém fechar a vigente
      sem abrir a próxima. A tabela não impede — o índice único garante *no
      máximo* uma aberta, nunca *pelo menos* uma.
    */
    const id = await idDe("carreta.chassi");
    await ctx.db
      .update(attributeSemanticsTable)
      .set({ effectiveUntil: "2030-01-01" })
      .where(eq(attributeSemanticsTable.attributeId, id));

    const achado = (await atributosSemSemanticaAplicavel(ctx.db)).find(
      (a) => a.code === "carreta.chassi",
    );
    expect(achado?.motivo).toBe("SEM_VERSAO_EM_VIGOR");
    expect(achado?.detalhe).toMatch(/nenhuma versão aberta/);
  });

  it("acusa a versão que começa depois da vigência mais antiga", async () => {
    /*
      O que uma importação retroativa deixa: a versão nasceu quando a série
      começava mais tarde, e a vigência antiga passa a não ter semântica que a
      cubra. A comparação daquela vigência volta a cair na projeção — sem uma
      linha de erro, que é o que torna este caso digno de invariante.
    */
    const id = await idDe("carreta.modelo");
    await ctx.db
      .update(attributeSemanticsTable)
      .set({ effectiveFrom: "2026-07-01" })
      .where(eq(attributeSemanticsTable.attributeId, id));

    const achado = (await atributosSemSemanticaAplicavel(ctx.db)).find(
      (a) => a.code === "carreta.modelo",
    );
    expect(achado?.motivo).toBe("NAO_COBRE_A_SERIE");
    expect(achado?.detalhe).toContain("2026-07-01");
    // A data da série sai na frase: é ela que prova o "depois de".
    const { rows } = await ctx.db.execute<{ inicio: string }>(
      sql`SELECT min(effective_date)::text AS inicio FROM snapshot`,
    );
    expect(achado?.detalhe).toContain(rows[0].inicio);
  });

  it("não acusa nada além do que foi quebrado", async () => {
    const codes = (await atributosSemSemanticaAplicavel(ctx.db)).map((a) => a.code);
    expect(codes.sort()).toEqual(["carreta.ano", "carreta.chassi", "carreta.modelo"]);
  });
});

describe("invariante 2 — a projeção e a versão em vigor", () => {
  it("acusa cada campo em que as duas se contradizem, com os dois valores", async () => {
    /*
      A escrita pela metade, que é o defeito que esta invariante existe para
      pegar: alguém atualiza `attribute` e não a versão. Era o que
      `confirmAttribute` fazia, e era invisível enquanto a tabela versionada
      estava vazia.
    */
    const id = await idDe("cavalo.valor_nf_compra");
    await ctx.db
      .update(attributeTable)
      .set({ periodicity: "MENSAL", isMonetary: false })
      .where(eq(attributeTable.id, id));

    const divergencias = await divergenciasDaProjecao(ctx.db);
    const desteAtributo = divergencias.filter(
      (d) => d.code === "cavalo.valor_nf_compra",
    );

    // Uma linha por campo, com o valor dos dois lados.
    expect(desteAtributo).toEqual([
      {
        code: "cavalo.valor_nf_compra",
        campo: "is_monetary",
        naProjecao: "false",
        naVersao: "true",
      },
      {
        code: "cavalo.valor_nf_compra",
        campo: "periodicity",
        naProjecao: "MENSAL",
        naVersao: null,
      },
    ]);
    expect(integridadeEmDia(await conferirIntegridadeSemantica(ctx.db))).toBe(false);
  });

  it("acusa também a metade contrária: versão escrita sem projetar", async () => {
    const id = await idDe("cavalo.manutencao_vida_meses");
    await ctx.db
      .update(attributeSemanticsTable)
      .set({ definition: "Escrito só na versão, sem projetar." })
      .where(eq(attributeSemanticsTable.attributeId, id));

    const achado = (await divergenciasDaProjecao(ctx.db)).find(
      (d) => d.code === "cavalo.manutencao_vida_meses",
    );
    expect(achado).toEqual({
      code: "cavalo.manutencao_vida_meses",
      campo: "definition",
      naProjecao: null,
      naVersao: "Escrito só na versão, sem projetar.",
    });
  });

  it("não confunde com divergência o que não é a mesma verdade", async () => {
    /*
      `display_name` não é versionado — um nome melhor é melhor também no
      passado — e `calculation_basis` não existe em `attribute`. Cobrar
      qualquer um dos dois faria a invariante acusar todo banco saudável, e a
      primeira coisa que se faz com um alarme que sempre toca é desligá-lo.
    */
    const antes = await divergenciasDaProjecao(ctx.db);

    await saveMeaning(ctx.db, {
      code: "cavalo.combustivel_consumo_neg",
      displayName: "Um apelido que só a projeção tem",
      calculationBasis: "Uma fórmula que só a versão tem.",
      actor: "guy@operalog",
    });

    expect(await divergenciasDaProjecao(ctx.db)).toEqual(antes);
  });

  it("ignora o atributo que não tem versão em vigor — esse é o outro defeito", async () => {
    // `carreta.ano` teve a versão apagada acima. Aparecer nas duas listas
    // faria a mesma linha ser contada como dois problemas diferentes.
    const codes = (await divergenciasDaProjecao(ctx.db)).map((d) => d.code);
    expect(codes).not.toContain("carreta.ano");
    expect(codes).not.toContain("carreta.chassi");
  });
});
