import { describe, expect, it } from "vitest";
import { detectFormatAnomaly, type AnomalySide } from "../anomalies";

const side = (partial: Partial<AnomalySide>): AnomalySide => ({
  numeric: null,
  text: null,
  date: null,
  display: null,
  ...partial,
});

/**
 * O detector de anomalia de formato, contra os dois casos reais de Ago/2026.
 *
 * Os 62 cavalos de `dataFimContrato` não são um caso só: em 54 deles o serial
 * é o **mesmo instante** que a data anterior — troca de formato pura — e em 8
 * ele é outro instante, o que significa formato e valor mudando juntos. Um
 * detector que não distinguisse os dois ou esconderia mudança real, ou
 * anunciaria mudança onde não houve.
 */
describe("anomalia de formato — data virando serial do Excel", () => {
  it("reconhece o serial como o mesmo instante (54 cavalos, Ago/2026)", () => {
    const anomaly = detectFormatAnomaly(
      side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
      side({ numeric: 46935.5, text: "46935.5", display: "46935.5" }),
    );
    expect(anomaly).not.toBeNull();
    expect(anomaly!.kind).toBe("DATA_COMO_SERIAL_EXCEL");
    expect(anomaly!.sameInstant).toBe(true);
    expect(anomaly!.interpretation).toContain("2028-07-01T12:00:00Z");
    expect(anomaly!.explanation).toContain("não mudança de contrato");
  });

  it("chama perda de precisão pelo nome (os 8 cavalos de Ago/2026)", () => {
    // 2028-07-01T23:59:59.999Z não cabe num serial do Excel, que arredonda para
    // 2028-07-02T00:00:00Z. A diferença é de UM milissegundo, e apresentá-la
    // como "mudança de data" faria perda de precisão passar por alteração de
    // contrato em oito cavalos.
    const anomaly = detectFormatAnomaly(
      side({ text: "2028-07-01T23:59:59.999Z", display: "2028-07-01T23:59:59.999Z" }),
      side({ numeric: 46936, text: "46936", display: "46936" }),
    );
    expect(anomaly!.sameInstant).toBe(false);
    expect(anomaly!.differenceMs).toBe(1);
    expect(anomaly!.explanation).toContain("1 milissegundo");
    expect(anomaly!.explanation).toContain("precisão que o formato perdeu");
    expect(anomaly!.explanation).not.toContain("mudança de data");
  });

  it("mudança real de data é dita como tal, com o tamanho", () => {
    const anomaly = detectFormatAnomaly(
      side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
      side({ numeric: 47300, text: "47300", display: "47300" }),
    );
    expect(anomaly!.sameInstant).toBe(false);
    expect(anomaly!.differenceMs).toBeGreaterThan(1000);
    expect(anomaly!.explanation).toContain("mudança de data");
    expect(anomaly!.explanation).toMatch(/diferença de \d+ dias/);
  });

  it("reconhece o caminho inverso, número virando data", () => {
    const anomaly = detectFormatAnomaly(
      side({ numeric: 46935.5, text: "46935.5", display: "46935.5" }),
      side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
    );
    expect(anomaly?.kind).toBe("SERIAL_EXCEL_COMO_DATA");
    expect(anomaly?.sameInstant).toBe(true);
  });

  it("aceita data sem hora", () => {
    const anomaly = detectFormatAnomaly(
      side({ date: "2028-07-01", display: "2028-07-01" }),
      side({ numeric: 46935, text: "46935", display: "46935" }),
    );
    expect(anomaly?.sameInstant).toBe(true);
  });

  it("não acusa quando os dois lados são números", () => {
    expect(
      detectFormatAnomaly(
        side({ numeric: 46935.5, display: "46935.5" }),
        side({ numeric: 46936, display: "46936" }),
      ),
    ).toBeNull();
  });

  it("não acusa quando os dois lados são datas", () => {
    expect(
      detectFormatAnomaly(
        side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
        side({ text: "2029-07-01T12:00:00Z", display: "2029-07-01T12:00:00Z" }),
      ),
    ).toBeNull();
  });

  it("não acusa quando o número está fora da faixa plausível de serial", () => {
    // 4.677,85 é um valor em reais. Tratá-lo como data seria alarme falso numa
    // tela cuja única função é ser confiável.
    expect(
      detectFormatAnomaly(
        side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
        side({ numeric: 4677.85, display: "4677.85" }),
      ),
    ).toBeNull();
  });

  it("não acusa quando um dos lados está ausente", () => {
    expect(
      detectFormatAnomaly(
        side({ text: "2028-07-01T12:00:00Z", display: "2028-07-01T12:00:00Z" }),
        side({}),
      ),
    ).toBeNull();
  });
});
