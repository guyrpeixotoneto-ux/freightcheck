import { describe, expect, it } from "vitest";
import {
  DESCRICAO_DA_FONTE,
  FONTES_DA_QUINZENA,
  FONTES_OPCIONAIS_DA_QUINZENA,
  FORMATOS_DA_FONTE,
  fonteEsperadaNaQuinzena,
  fonteOpcionalNaQuinzena,
  fontesDaQuinzena,
  ladoDaFonte,
  situacaoDaFrotaPromax,
  TIPOS_DE_FONTE,
  TIPOS_DE_FROTA_PROMAX,
} from "../dominio";

/**
 * O VOCABULÁRIO DA FROTA PROMAX — periodicidade quinzenal, não financeira,
 * duas fontes.
 *
 * Cobre os requisitos do pedido: duas fontes (não quatro), quinzenal como as
 * outras fontes financeiras — mas ainda sem confirmação de obrigatoriedade,
 * então opcional em toda quinzena por ora (TODO(Rebeca), ver `dominio.ts`) —
 * e conferência operacional (nunca DEVIDO/DEMONSTRADO por omissão) — este
 * último também é confrontado em `frota-promax-contaminacao.test.ts`.
 */

describe("as duas fontes existem no catálogo", () => {
  it("FROTA_PROMAX_ATIVA e FROTA_PROMAX_INATIVA estão em TIPOS_DE_FONTE", () => {
    expect(TIPOS_DE_FONTE).toContain("FROTA_PROMAX_ATIVA");
    expect(TIPOS_DE_FONTE).toContain("FROTA_PROMAX_INATIVA");
  });

  it("TIPOS_DE_FROTA_PROMAX é exatamente as duas, e nada mais", () => {
    expect([...TIPOS_DE_FROTA_PROMAX].sort()).toEqual(
      ["FROTA_PROMAX_ATIVA", "FROTA_PROMAX_INATIVA"].sort(),
    );
  });

  it("cada uma tem descrição e rotina — 01.22.02.00 e 01.22.08.00", () => {
    expect(DESCRICAO_DA_FONTE.FROTA_PROMAX_ATIVA.rotina).toBe("01.22.02.00");
    expect(DESCRICAO_DA_FONTE.FROTA_PROMAX_INATIVA.rotina).toBe("01.22.08.00");
  });

  it("cada uma tem formatos aceitos, e o leitor decide pelo conteúdo (não pela extensão)", () => {
    expect(FORMATOS_DA_FONTE.FROTA_PROMAX_ATIVA.length).toBeGreaterThan(0);
    expect(FORMATOS_DA_FONTE.FROTA_PROMAX_INATIVA.length).toBeGreaterThan(0);
  });

  it("situacaoDaFrotaPromax traduz cada fonte para ATIVA/INATIVA, e as outras para null", () => {
    expect(situacaoDaFrotaPromax("FROTA_PROMAX_ATIVA")).toBe("ATIVA");
    expect(situacaoDaFrotaPromax("FROTA_PROMAX_INATIVA")).toBe("INATIVA");
    expect(situacaoDaFrotaPromax("OPERACAO")).toBeNull();
    expect(situacaoDaFrotaPromax("PAGAMENTO")).toBeNull();
  });
});

describe("quinzenal, mas opcional em toda quinzena até confirmar obrigatoriedade", () => {
  it("nenhuma das duas está em FONTES_DA_QUINZENA, em nenhuma das duas quinzenas", () => {
    for (const quinzena of [1, 2] as const) {
      for (const tipo of TIPOS_DE_FROTA_PROMAX) {
        expect(
          FONTES_DA_QUINZENA[quinzena],
          `${tipo} está em FONTES_DA_QUINZENA[${quinzena}]`,
        ).not.toContain(tipo);
        expect(fonteEsperadaNaQuinzena(quinzena, tipo)).toBe(false);
      }
    }
  });

  it("as duas são admitidas (opcionais) nas duas quinzenas — nunca cobradas", () => {
    for (const quinzena of [1, 2] as const) {
      for (const tipo of TIPOS_DE_FROTA_PROMAX) {
        expect(FONTES_OPCIONAIS_DA_QUINZENA[quinzena]).toContain(tipo);
        expect(fonteOpcionalNaQuinzena(quinzena, tipo)).toBe(true);
      }
    }
  });

  it("a ausência da frota Promax numa quinzena nunca vira AUSENTE — sempre NAO_APLICAVEL, ou PRESENTE se chegou", () => {
    for (const quinzena of [1, 2] as const) {
      const estados = fontesDaQuinzena(quinzena, null);
      for (const tipo of TIPOS_DE_FROTA_PROMAX) {
        const estado = estados.find((e) => e.tipo === tipo);
        expect(estado?.estado, `${tipo} na quinzena ${quinzena} sem nada recebido`).toBe(
          "NAO_APLICAVEL",
        );
      }

      const comFrota = fontesDaQuinzena(quinzena, ["FROTA_PROMAX_ATIVA"]);
      const presente = comFrota.find((e) => e.tipo === "FROTA_PROMAX_ATIVA");
      expect(presente?.estado).toBe("PRESENTE");
    }
  });
});

describe("a classificação é operacional, e é derivada — não um campo à parte", () => {
  it("ladoDaFonte das duas é CONFERENCIA_OPERACIONAL", () => {
    expect(ladoDaFonte("FROTA_PROMAX_ATIVA")).toBe("CONFERENCIA_OPERACIONAL");
    expect(ladoDaFonte("FROTA_PROMAX_INATIVA")).toBe("CONFERENCIA_OPERACIONAL");
  });

  it("nenhuma fonte financeira virou CONFERENCIA_OPERACIONAL por engano", () => {
    const financeiras: (typeof TIPOS_DE_FONTE)[number][] = [
      "OPERACAO",
      "CTE",
      "PAGAMENTO",
      "DISPONIBILIDADE_FF",
      "DISPONIBILIDADE_VAN",
      "REQUISICOES",
      "CONCILIACAO",
    ];
    for (const tipo of financeiras) {
      expect(ladoDaFonte(tipo)).not.toBe("CONFERENCIA_OPERACIONAL");
    }
  });
});
