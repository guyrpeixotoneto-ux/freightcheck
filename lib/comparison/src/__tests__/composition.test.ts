import { describe, expect, it } from "vitest";
import {
  COMPOSITIONS,
  compositionOf,
  indexChangedAttributesByEntity,
  isCoveredByParts,
  isTotalAttribute,
} from "../composition";

/**
 * A regra da dupla contagem, exercitada com os casos reais que a motivaram.
 *
 * Os três cenários abaixo saíram de Ago/2026 e não de imaginação: a placa
 * RZM0B31 (total e as duas parcelas mudaram), a QYP3G72 (total e as três
 * parcelas do cavalo) e a QYW2D78 (o total mudou sozinho). Os dois primeiros
 * têm de sair da soma; o terceiro **não**, e é o caso que impede a solução
 * preguiçosa de simplesmente excluir o atributo.
 */
describe("composição — dupla contagem", () => {
  it("declara apenas relações medidas, e cada uma carrega a sua evidência", () => {
    expect(COMPOSITIONS.length).toBeGreaterThan(0);
    for (const composition of COMPOSITIONS) {
      expect(composition.parts.length).toBeGreaterThanOrEqual(2);
      // A evidência não é decorativa: sem número, a entrada é palpite.
      expect(composition.evidence).toMatch(/\d/);
      expect(composition.parts).not.toContain(composition.total);
    }
  });

  it("reconhece os totais declarados e ignora os demais atributos", () => {
    expect(isTotalAttribute("carreta.custo_fixo")).toBe(true);
    expect(isTotalAttribute("cavalo.finame_cavalo")).toBe(true);
    expect(isTotalAttribute("carreta.finame_implemento")).toBe(true);
    expect(isTotalAttribute("carreta.finame")).toBe(false);
    expect(isTotalAttribute("cavalo.ipva_licenciamento")).toBe(false);
    expect(isTotalAttribute(null)).toBe(false);
  });

  it("cavalo.finame_cavalo inclui o lucro fixo — a hipótese sem ele foi rejeitada", () => {
    // Sem `lucro_fixomodelo_novo_ciclo_cavalo` a identidade falha em 30 das 533
    // linhas reais. A composição declarada precisa conter as três parcelas.
    expect(compositionOf("cavalo.finame_cavalo")?.parts).toEqual([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]);
  });

  it("exclui o total quando uma parcela mudou no mesmo ativo (RZM0B31, Ago/2026)", () => {
    const index = indexChangedAttributesByEntity([
      { entityId: "RZM0B31", attributeCode: "carreta.custo_fixo" },
      { entityId: "RZM0B31", attributeCode: "carreta.finame" },
      { entityId: "RZM0B31", attributeCode: "carreta.lucro_fixomodelo_novo_ciclo" },
    ]);
    expect(isCoveredByParts("carreta.custo_fixo", "RZM0B31", index)).toBe(true);
    // As parcelas nunca são excluídas: são elas que ficam na soma.
    expect(isCoveredByParts("carreta.finame", "RZM0B31", index)).toBe(false);
  });

  it("exclui o total do cavalo quando as três parcelas mudaram (QYP3G72, Ago/2026)", () => {
    const index = indexChangedAttributesByEntity([
      { entityId: "QYP3G72", attributeCode: "cavalo.finame_cavalo" },
      { entityId: "QYP3G72", attributeCode: "cavalo.amortizacao_cavalo" },
      { entityId: "QYP3G72", attributeCode: "cavalo.juros_finame_cavalo" },
      { entityId: "QYP3G72", attributeCode: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo" },
    ]);
    expect(isCoveredByParts("cavalo.finame_cavalo", "QYP3G72", index)).toBe(true);
  });

  it("NÃO exclui o total quando nenhuma parcela mudou (QYW2D78, Ago/2026)", () => {
    // O caso decisivo. Aqui `finame_cavalo` foi de 0 para 4.395,36 sem que
    // amortização, juros ou lucro fixo se mexessem. Excluir o atributo inteiro
    // apagaria R$ 17.086,20 de variação que nenhuma parcela explica.
    const index = indexChangedAttributesByEntity([
      { entityId: "QYW2D78", attributeCode: "cavalo.finame_cavalo" },
    ]);
    expect(isCoveredByParts("cavalo.finame_cavalo", "QYW2D78", index)).toBe(false);
  });

  it("a decisão é por ativo: um ativo não afeta o outro", () => {
    const index = indexChangedAttributesByEntity([
      { entityId: "QYP3G72", attributeCode: "cavalo.finame_cavalo" },
      { entityId: "QYP3G72", attributeCode: "cavalo.amortizacao_cavalo" },
      { entityId: "QYW2D78", attributeCode: "cavalo.finame_cavalo" },
    ]);
    expect(isCoveredByParts("cavalo.finame_cavalo", "QYP3G72", index)).toBe(true);
    expect(isCoveredByParts("cavalo.finame_cavalo", "QYW2D78", index)).toBe(false);
  });

  it("um ativo sem alterações registradas nunca exclui nada", () => {
    const index = indexChangedAttributesByEntity([]);
    expect(isCoveredByParts("carreta.custo_fixo", "QYP0J87", index)).toBe(false);
    expect(isCoveredByParts("carreta.custo_fixo", null, index)).toBe(false);
  });
});
