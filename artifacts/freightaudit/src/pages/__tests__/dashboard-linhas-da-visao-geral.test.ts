import { describe, expect, it } from "vitest";
import { linhasDaVisaoGeral } from "../dashboard";
import { linkDeAlteracoes } from "@/lib/recorte";
import type { ChangeGroup, FamiliesOverview } from "@/components/inicio/types";

/**
 * O contrato da tabela de "Principais alterações" em Visão Geral: **a linha
 * continua sendo de uma unidade.**
 *
 * A consolidação soma dinheiro e famílias, mas não mescla grupos: a mesma
 * alteração de `carreta.custo_fixo` em duas unidades são dois fatos, sobre
 * duas frotas, com dois valores. Daí as duas garantias que este arquivo
 * cobre — a chave de cada linha é única entre unidades (`ChangeGroup.key` só
 * é única dentro de uma), e o link de detalhe abre no recorte da unidade
 * daquela linha, nunca no da tela (que em Visão Geral não tem unidade
 * nenhuma, e cairia na unidade padrão).
 */

const grupo = (chave: string, attributeCode: string): ChangeGroup =>
  ({ key: chave, attributeCode, entityType: "CARRETA", equipment: "Carreta" }) as ChangeGroup;

function overviewCom(groups: FamiliesOverview["consolidado"]["groups"]): FamiliesOverview {
  return {
    period: "2026-08-02",
    summary: {} as FamiliesOverview["summary"],
    unitsIncluded: [],
    unitsExcluded: [],
    consolidado: {
      families: [],
      totals: {
        changes: 0,
        vehiclesTouched: 0,
        entitiesAdded: 0,
        entitiesRemoved: 0,
        inconclusive: 0,
        fleet: 0,
      },
      groups,
      gruposNoTotal: groups.length,
    },
  };
}

describe("as linhas da Visão Geral", () => {
  it("a mesma alteração em duas unidades vira duas linhas com chaves distintas", () => {
    const linhas = linhasDaVisaoGeral(
      overviewCom([
        {
          unidade: "PERNAMBUCO",
          label: "PERNAMBUCO",
          scopeHash: "hash-pe",
          channel: "EMPURRADA",
          score: 90,
          group: grupo("custo-fixo", "carreta.custo_fixo"),
        },
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          scopeHash: "hash-camacari",
          channel: "EMPURRADA",
          score: 80,
          group: grupo("custo-fixo", "carreta.custo_fixo"),
        },
      ]),
    );

    expect(linhas.map((l) => l.chave)).toEqual([
      "PERNAMBUCO|EMPURRADA|custo-fixo",
      "CAMACARI|EMPURRADA|custo-fixo",
    ]);
    expect(new Set(linhas.map((l) => l.chave)).size).toBe(2);
  });

  it("cada linha nomeia a unidade dela — a tabela nunca mistura unidades em silêncio", () => {
    const linhas = linhasDaVisaoGeral(
      overviewCom([
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          scopeHash: "hash-camacari",
          channel: null,
          score: 10,
          group: grupo("a", "carreta.custo_fixo"),
        },
      ]),
    );

    expect(linhas[0].unidade).toBe("CAMAÇARI");
  });

  it("o link de detalhe abre no recorte da unidade da linha, na competência aberta", () => {
    const linhas = linhasDaVisaoGeral(
      overviewCom([
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          scopeHash: "hash-camacari",
          channel: "ROTA",
          score: 10,
          group: grupo("a", "carreta.custo_fixo"),
        },
      ]),
    );

    expect(linhas[0].recorte).toEqual({
      period: "2026-08-02",
      scopeHash: "hash-camacari",
      canal: "ROTA",
    });

    const href = linkDeAlteracoes({
      recorte: linhas[0].recorte,
      filtros: { attributeCode: "carreta.custo_fixo" },
    });
    expect(href).toContain("scopeHash=hash-camacari");
    expect(href).toContain("canal=ROTA");
    expect(href).toContain("period=2026-08-02");
  });

  it("uma unidade sem canal no rótulo continua sendo uma partição própria, e não some da chave", () => {
    const linhas = linhasDaVisaoGeral(
      overviewCom([
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          scopeHash: "hash-camacari",
          channel: null,
          score: 10,
          group: grupo("a", "carreta.custo_fixo"),
        },
      ]),
    );

    expect(linhas[0].chave).toBe("CAMACARI||a");
    expect(linhas[0].recorte.canal).toBeNull();
  });
});
