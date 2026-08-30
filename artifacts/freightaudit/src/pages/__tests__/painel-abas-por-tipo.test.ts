import { describe, expect, it } from "vitest";
import { nomeDaAbaPorTipo } from "../painel-de-justificativas";
import { EQUIPAMENTOS_DO_AMBIENTE } from "@/lib/frota";

/**
 * O nome da aba de tipo do Painel de Justificativas.
 *
 * O defeito que isto trava é o de sempre nas telas de frota, e é o pior tipo de
 * defeito de rótulo: **uma aba que promete uma fila que a operação não tem**.
 * A empurrada roda com cavalo, carreta e trecho; o Rota e o AS, com caminhão e
 * carroceria; o Apoio, só com empilhadeira. Uma aba escrita à mão como "Cavalo,
 * Carreta e Trecho" ficaria certa na empurrada e mentiria nas outras três — e
 * mentiria em silêncio, porque o painel abriria normalmente, vazio.
 *
 * Por isso o nome sai de `EQUIPAMENTOS_DO_AMBIENTE`, a mesma lista que o menu e
 * as telas 360° leem. Estes casos são o que impede alguém de voltar a escrevê-lo
 * à mão sem que nada acuse.
 */
describe("o nome da aba sai do ambiente aberto", () => {
  it("na empurrada, é exatamente Cavalo, Carreta e Trecho", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE.auditoria)).toBe(
      "Cavalo, Carreta e Trecho",
    );
  });

  it("no Rota e no AS, é Caminhão e Carroceria — e não os três da empurrada", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"])).toBe(
      "Caminhão e Carroceria",
    );
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-as"])).toBe(
      "Caminhão e Carroceria",
    );
  });

  it("no Apoio, um tipo só — sem o 'e' pendurado no fim", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-apoio"])).toBe(
      "Empilhadeira",
    );
  });

  it("nenhum ambiente fica sem nome de aba", () => {
    for (const equipamentos of Object.values(EQUIPAMENTOS_DO_AMBIENTE)) {
      expect(nomeDaAbaPorTipo(equipamentos).length).toBeGreaterThan(0);
    }
    // Lista vazia não acontece hoje, e mesmo assim não pode virar aba sem nome.
    expect(nomeDaAbaPorTipo([])).toBe("Por tipo");
  });
});
