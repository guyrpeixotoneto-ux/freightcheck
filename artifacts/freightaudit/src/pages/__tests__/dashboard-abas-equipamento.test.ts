import { describe, expect, it } from "vitest";
import { abasDeEquipamento } from "../dashboard";
import type { ChangeGroup } from "@/components/inicio/types";

/**
 * O contrato das abas de "Principais alterações": **uma aba por equipamento,
 * e só as que têm conteúdo.**
 *
 * A tabela mostrava a fila do cockpit inteira, alternando Cavalo e Carreta a
 * cada linha — `amortizacaoCavalo` seguido de `amortizacaoImplemento` — e as
 * oito linhas visíveis podiam esconder as maiores prioridades de um dos dois
 * atrás das do outro. As abas resolvem isso sem reordenar nada dentro de cada
 * uma: a ordem de prioridade do servidor se preserva dentro de cada aba. Entre
 * as abas, Cavalo vem sempre primeiro, Carreta em seguida.
 */

const grupo = (chave: string, entityType: string | null, equipment: string): ChangeGroup =>
  ({ key: chave, entityType, equipment }) as ChangeGroup;

describe("as abas saem dos grupos, não de uma lista fixa", () => {
  it("separa Cavalo de Carreta preservando a ordem de prioridade dentro de cada um, com Cavalo primeiro", () => {
    const abas = abasDeEquipamento([
      grupo("a", "CARRETA", "Carreta"),
      grupo("b", "CAVALO", "Cavalo"),
      grupo("c", "CAVALO", "Cavalo"),
      grupo("d", "CARRETA", "Carreta"),
    ]);

    expect(abas.map((aba) => aba.rotulo)).toEqual(["Cavalo", "Carreta"]);
    expect(abas[0].grupos.map((g) => g.key)).toEqual(["b", "c"]);
    expect(abas[1].grupos.map((g) => g.key)).toEqual(["a", "d"]);
  });

  it("uma vigência de um equipamento só rende uma aba — e a tela então não as mostra", () => {
    const abas = abasDeEquipamento([
      grupo("a", "CAVALO", "Cavalo"),
      grupo("b", "CAVALO", "Cavalo"),
    ]);

    expect(abas).toHaveLength(1);
    expect(abas[0].grupos).toHaveLength(2);
  });

  it("grupo sem equipamento ganha aba própria em vez de sumir da tabela", () => {
    const abas = abasDeEquipamento([
      grupo("a", "CAVALO", "Cavalo"),
      grupo("b", null, "Sem equipamento"),
    ]);

    expect(abas.map((aba) => aba.rotulo)).toEqual(["Cavalo", "Sem equipamento"]);
  });

  it("sem alterações na vigência, não há aba nenhuma", () => {
    expect(abasDeEquipamento([])).toEqual([]);
  });
});
