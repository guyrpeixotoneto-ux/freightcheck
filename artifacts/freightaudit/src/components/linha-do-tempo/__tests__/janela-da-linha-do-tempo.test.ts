import { describe, expect, it } from "vitest";
import { rotuloDaJanela } from "../linha-do-tempo-de-impacto";

/**
 * O nome da janela aberta no paginador da linha do tempo.
 *
 * É o único texto da tela que o leitor usa para saber *onde* está no
 * histórico antes de clicar na seta — se ele mentir sobre o mês ou o ano, a
 * navegação vira tentativa e erro. Vem de `period` (ISO) e nunca do rótulo,
 * que muda de forma conforme o histórico.
 */
describe("rotuloDaJanela", () => {
  const vigencia = (period: string, label = period) => ({ period, label });

  it("junta os meses das pontas quando o ano é o mesmo", () => {
    expect(
      rotuloDaJanela([
        vigencia("2026-06-02"),
        vigencia("2026-07-01"),
        vigencia("2026-08-02"),
      ]),
    ).toBe("Jun–Ago 2026");
  });

  it("não repete o mês quando a janela inteira cai no mesmo", () => {
    expect(rotuloDaJanela([vigencia("2026-07-01"), vigencia("2026-07-15")])).toBe("Jul 2026");
  });

  it("escreve os dois anos quando a janela atravessa a virada", () => {
    expect(rotuloDaJanela([vigencia("2025-11-01"), vigencia("2026-02-01")])).toBe(
      "Nov 2025 – Fev 2026",
    );
  });

  it("cai no rótulo das pontas quando a data não é ISO", () => {
    expect(rotuloDaJanela([vigencia("ontem", "Ontem"), vigencia("hoje", "Hoje")])).toBe(
      "Ontem – Hoje",
    );
  });

  it("não inventa janela quando não há vigência visível", () => {
    expect(rotuloDaJanela([])).toBe("");
  });
});
