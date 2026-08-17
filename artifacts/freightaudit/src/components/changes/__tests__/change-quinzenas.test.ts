import { describe, expect, it } from "vitest";
import {
  travessiaDaAlteracao,
  type ChangeRow,
} from "../change-table";

/**
 * A travessia da aba Planilha para a matriz por quinzena.
 *
 * O que este arquivo protege é a recusa de abrir a matriz quando não se sabe em
 * quê. A rota do Impacto, de propósito, não transforma escolha inválida em 400:
 * um parâmetro que ela não conhece cai no padrão do equipamento (ver
 * `getQuinzenaMatrix`). Essa gentileza é boa para quem chega sem pedir nada e
 * péssima para um link — uma linha sem `attributeCode` levaria a pessoa a uma
 * tabela de outro assunto, com todos os números certos e a resposta errada.
 *
 * A placa vai junto e não recorta nada: é onde a leitura começa, não de quem ela
 * é. A separação está escrita em `AberturaDaMatriz`, e o teste da frota inteira
 * continuar sendo a frota inteira é o de `impacto-quinzenas`.
 */

const linha = (parcial: Partial<ChangeRow> = {}): ChangeRow => ({
  id: 1,
  category: "VALUE_CHANGE",
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.amortizacao_cavalo",
  attributeName: "amortizacaoCavalo",
  entityLabel: "QYP3G72",
  entityType: "CAVALO",
  valueBefore: "7700.16",
  valueAfter: "0",
  deltaAbsolute: -7700.16,
  deltaPercent: -100,
  comparability: "COMPARABLE",
  inconclusiveReason: null,
  impactConfidence: "NOT_CALCULABLE",
  impactAmount: null,
  impactPeriodicity: null,
  impactReason: null,
  costClass: null,
  taxonomyName: null,
  semanticsStatus: "UNKNOWN",
  semanticsVersionA: null,
  semanticsVersionB: null,
  semanticsEffectiveFrom: null,
  ...parcial,
});

describe("travessiaDaAlteracao", () => {
  it("leva o parâmetro, o equipamento e a placa de onde se partiu", () => {
    expect(travessiaDaAlteracao(linha())).toEqual({
      entityType: "CAVALO",
      code: "cavalo.amortizacao_cavalo",
      placa: "QYP3G72",
    });
  });

  it("não abre sem parâmetro — uma coluna que entrou ou saiu do layout", () => {
    expect(
      travessiaDaAlteracao(
        linha({ changeType: "ATTRIBUTE_ADDED", attributeCode: null }),
      ),
    ).toBeNull();
  });

  it("não abre sem equipamento: a matriz é de um tipo de ativo", () => {
    expect(travessiaDaAlteracao(linha({ entityType: null }))).toBeNull();
  });

  it("abre sem placa — a alteração pode não ser de um ativo", () => {
    expect(travessiaDaAlteracao(linha({ entityLabel: null }))?.placa).toBeNull();
  });

  it("uma mudança de significado atravessa: é o degrau que ela produziu", () => {
    const semantica = linha({
      category: "SEMANTICS_CHANGE",
      changeType: "SEMANTICS_CHANGED",
      nature: "PERIODICITY",
    });

    expect(travessiaDaAlteracao(semantica)).toEqual({
      entityType: "CAVALO",
      code: "cavalo.amortizacao_cavalo",
      placa: "QYP3G72",
    });
  });
});
