import { describe, expect, it } from "vitest";
import type { AttributeClassification } from "@workspace/comparison";
import { comporDeFatos, type FatoDoAtivo } from "../motor";
import {
  COMPOSITIONS,
  gavetaDe,
  regraDe,
  resolverRaizes,
  TIPOS_COM_REGRA,
} from "../regras";
import { avaliarStatus, LIMIAR_CRITICO_PERCENTUAL } from "../status";

/**
 * As regras sem banco.
 *
 * `comporDeFatos` é pura de propósito, e é aqui que isso se paga: dá para
 * montar estados que o banco **se recusa a guardar** — um monetário CONFIRMADO
 * sem periodicidade, por exemplo, que a constraint
 * `attribute_confirmed_monetary_is_complete` proíbe desde a migration 0002.
 *
 * Testar um estado impossível não é preciosismo. `loadAttributeClassificationsAt`
 * mistura duas fontes (a projeção em `attribute` e as versões em
 * `attribute_semantics`), a segunda pode ganhar linhas por outro caminho, e o
 * dia em que uma delas escapar da constraint o motor não pode responder com um
 * `NaN` no total em destaque. O portão é cinto e suspensório de propósito.
 */

function classificacao(
  parcial: Partial<AttributeClassification> & { attributeId: string },
): AttributeClassification {
  return {
    attributeCode: parcial.attributeCode ?? "x.y",
    attributeName: parcial.attributeName ?? "X",
    attributeDisplayName: null,
    entityType: "CAVALO",
    dataType: "NUMERIC",
    unit: null,
    periodicity: null,
    aggregation: null,
    isMonetary: null,
    semanticsStatus: "CONFIRMED",
    costClass: null,
    taxonomyPath: null,
    taxonomyName: null,
    ...parcial,
  };
}

function fato(parcial: Partial<FatoDoAtivo> & { code: string }): FatoDoAtivo {
  return {
    attribute_id: parcial.attribute_id ?? parcial.code,
    code: parcial.code,
    source_name: parcial.source_name ?? parcial.code.split(".").pop()!,
    display_name: parcial.display_name ?? null,
    data_type: parcial.data_type ?? "NUMERIC",
    value_numeric: parcial.value_numeric ?? null,
    value_text: parcial.value_text ?? null,
    value_boolean: parcial.value_boolean ?? null,
    value_date: parcial.value_date ?? null,
    is_null: parcial.is_null ?? false,
    null_reason: parcial.null_reason ?? null,
    source_label: "FIXTURE_1_1_2026",
    sheet_name: null,
    row_index: null,
    column_letter: null,
    column_header: null,
    raw_value: null,
  };
}

describe("o portão, nos estados que o banco não guarda", () => {
  it("monetário confirmado e somável sem periodicidade não entra em total nenhum", () => {
    const resultado = comporDeFatos(
      "CAVALO",
      [fato({ code: "cavalo.x", value_numeric: "1000" })],
      new Map([
        [
          "cavalo.x",
          classificacao({
            attributeId: "cavalo.x",
            unit: "BRL",
            aggregation: "SUM",
            isMonetary: true,
            periodicity: null,
          }),
        ],
      ]),
    );
    expect(resultado.linhas).toHaveLength(0);
    expect(resultado.totais).toHaveLength(0);
    expect(resultado.naoApurados[0].motivo).toBe("SEM_PERIODICIDADE");
    expect(resultado.naoApurados[0].monetarioPotencial).toBe(true);
  });

  it("uma periodicidade que ninguém previu não vira gaveta nova nem some", () => {
    const resultado = comporDeFatos(
      "CAVALO",
      [fato({ code: "cavalo.x", value_numeric: "1000" })],
      new Map([
        [
          "cavalo.x",
          classificacao({
            attributeId: "cavalo.x",
            unit: "BRL",
            aggregation: "SUM",
            isMonetary: true,
            periodicity: "QUINZENAL",
          }),
        ],
      ]),
    );
    expect(gavetaDe("QUINZENAL")).toBeNull();
    expect(resultado.linhas).toHaveLength(0);
    expect(resultado.naoApurados).toHaveLength(1);
  });

  it("um atributo sem classificação nenhuma é recusado, não ignorado", () => {
    const resultado = comporDeFatos(
      "CAVALO",
      [fato({ code: "cavalo.novo", value_numeric: "999" })],
      new Map(),
    );
    expect(resultado.naoApurados[0].motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    expect(resultado.naoApurados[0].valorNumerico).toBe(999);
  });
});

describe("escopo de conjunto", () => {
  const carreta = [
    fato({ code: "carreta.custo_fixo", value_numeric: "23408.92" }),
    fato({ code: "carreta.finame", value_numeric: "23408.92" }),
    fato({ code: "carreta.finame_implemento", value_numeric: "6639.08" }),
    fato({ code: "carreta.amortizacao_implemento", value_numeric: "4201.09" }),
    fato({ code: "carreta.juros_finame_implemento", value_numeric: "2437.99" }),
    fato({ code: "carreta.custo_aluguel", value_numeric: "0" }),
    fato({ code: "carreta.lucro_fixomodelo_novo_ciclo", value_numeric: "1520.32" }),
  ];
  const mensalConfirmado = new Map(
    carreta.map((f) => [
      f.code,
      classificacao({
        attributeId: f.code,
        attributeCode: f.code,
        entityType: "CARRETA",
        unit: "BRL",
        periodicity: "MENSAL",
        aggregation: "SUM",
        isMonetary: true,
      }),
    ]),
  );

  it("não soma o cavalo dentro da carreta", () => {
    const resultado = comporDeFatos("CARRETA", carreta, mensalConfirmado);
    const mensal = resultado.totais.find((t) => t.gaveta === "MENSAL")!;
    // finameImplemento 6.639,08 + lucroFixo 1.520,32 — e não custoFixo 23.408,92,
    // que carrega o financiamento do cavalo.
    expect(mensal.valor).toBe(8159.4);
    expect(resultado.linhas.map((l) => l.code).sort()).toEqual([
      "carreta.finame_implemento",
      "carreta.lucro_fixomodelo_novo_ciclo",
    ]);
  });

  it("as colunas de conjunto ficam na tela, com a evidência escrita", () => {
    const resultado = comporDeFatos("CARRETA", carreta, mensalConfirmado);
    for (const code of ["carreta.custo_fixo", "carreta.finame"]) {
      const item = resultado.naoApurados.find((n) => n.code === code)!;
      expect(item.motivo, code).toBe("ESCOPO_DE_CONJUNTO");
      expect(item.explicacao, code).toContain("conjunto");
      // Não é lacuna de curadoria: o produto sabe exatamente o que é.
      expect(item.monetarioPotencial, code).toBe(false);
    }
  });

  it("uma parcela cujo total saiu por escopo volta a ser raiz", () => {
    const resultado = comporDeFatos("CARRETA", carreta, mensalConfirmado);
    // lucroFixomodeloNovoCiclo é parcela de custoFixo, que está fora do escopo.
    // Se a exclusão do total a levasse junto, sumiriam R$ 1.520,32 da carreta.
    expect(resultado.linhas.some((l) => l.code === "carreta.lucro_fixomodelo_novo_ciclo")).toBe(
      true,
    );
  });

  it("o cavalo não tem exclusão de escopo — quem empresta não se defende", () => {
    expect(regraDe("CAVALO").foraDoEscopo).toHaveLength(0);

    // Por código, e não por contagem: o que este teste protege é *quais*
    // colunas carregam o cavalo, e um `toHaveLength` passa a mentir no dia em
    // que uma entra e outra sai. Toda entrada aqui carrega a medição que a
    // sustenta, e a evidência é conferida no teste acima.
    expect(regraDe("CARRETA").foraDoEscopo.map((f) => f.code).sort()).toEqual([
      "carreta.custo_fixo",
      "carreta.finame",
      "carreta.lucro_variavel_previsto",
    ]);
    expect(
      regraDe("CARRETA").foraDoEscopo.every(
        (f) => f.escopo === "CONJUNTO" && f.evidencia.includes("conjunto"),
      ),
    ).toBe(true);
  });

  it("um tipo sem regra registrada não inventa exclusões", () => {
    const desconhecido = regraDe("EMPILHADEIRA");
    expect(desconhecido.foraDoEscopo).toHaveLength(0);
    expect(desconhecido.rotulo).toBe("EMPILHADEIRA");
    expect(TIPOS_COM_REGRA).toEqual(["CAVALO", "CARRETA"]);
  });
});

describe("resolverRaizes", () => {
  it("absorve a parcela só quando o total dela também entrou", () => {
    const comTotal = resolverRaizes([
      "cavalo.finame_cavalo",
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
    ]);
    expect(comTotal.raizes).toEqual(["cavalo.finame_cavalo"]);
    expect(comTotal.absorvidas.get("cavalo.amortizacao_cavalo")).toBe("cavalo.finame_cavalo");

    const semTotal = resolverRaizes([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
    ]);
    expect(semTotal.raizes).toEqual([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
    ]);
    expect(semTotal.absorvidas.size).toBe(0);
  });

  it("toda composição declarada carrega a medição que a sustenta", () => {
    for (const composicao of COMPOSITIONS) {
      expect(composicao.parts.length, composicao.total).toBeGreaterThan(0);
      expect(composicao.evidence.length, composicao.total).toBeGreaterThan(40);
    }
  });
});

describe("o farol", () => {
  const base = {
    presente: true,
    mensal: 10_000,
    integridade: [],
    anteriorPresente: true,
  };

  it("verde só sem movimento e sem inconsistência", () => {
    expect(
      avaliarStatus({ ...base, variacao: { absoluta: 0, percentual: 0 } }).farol,
    ).toBe("NORMAL");
  });

  it("amarelo em qualquer movimento abaixo do limiar", () => {
    const status = avaliarStatus({
      ...base,
      variacao: { absoluta: 100, percentual: LIMIAR_CRITICO_PERCENTUAL - 1 },
    });
    expect(status.farol).toBe("ATENCAO");
    expect(status.motivos[0]).toContain("R$ 100,00");
  });

  it("vermelho no limiar, e não só acima dele", () => {
    expect(
      avaliarStatus({
        ...base,
        variacao: { absoluta: 1_000, percentual: LIMIAR_CRITICO_PERCENTUAL },
      }).farol,
    ).toBe("CRITICO");
  });

  it("vermelho por integridade mesmo sem variação nenhuma", () => {
    const status = avaliarStatus({
      ...base,
      variacao: { absoluta: 0, percentual: 0 },
      integridade: [
        { code: "x", titulo: "X", tipo: "TOTAL_NAO_FECHA", mensagem: "não fecha" },
      ],
    });
    expect(status.farol).toBe("CRITICO");
    expect(status.motivos).toContain("não fecha");
  });

  it("branco antes de tudo: sem número apurado não há cor de julgamento", () => {
    expect(
      avaliarStatus({ ...base, mensal: null, variacao: null }).farol,
    ).toBe("INCOMPLETO");
    expect(
      avaliarStatus({ ...base, presente: false, variacao: null }).farol,
    ).toBe("INCOMPLETO");
  });

  it("variação sobre base zero não vira percentual", () => {
    const status = avaliarStatus({
      ...base,
      variacao: { absoluta: 5_000, percentual: null },
    });
    expect(status.farol).toBe("ATENCAO");
    expect(status.motivos[0]).toContain("não há percentual");
  });
});
