import { describe, expect, it } from "vitest";
import { channelOf, parseVigenciaLabel } from "../vigencia";

describe("parseVigenciaLabel", () => {
  it("preserves the source label verbatim", () => {
    const result = parseVigenciaLabel("EMPURRADA_1_8_2026");
    expect(result.label).toBe("EMPURRADA_1_8_2026");
  });

  it("derives the date from the D_M_YYYY ordering", () => {
    // Day first, then month: 1/8/2026 is 1 August, not 8 January.
    expect(parseVigenciaLabel("EMPURRADA_1_8_2026").effectiveDate).toBe("2026-08-01");
    expect(parseVigenciaLabel("EMPURRADA_2_12_2025").effectiveDate).toBe("2025-12-02");
  });

  it("covers every label in the real export, in order", () => {
    const labels = [
      "EMPURRADA_2_12_2025",
      "EMPURRADA_2_1_2026",
      "EMPURRADA_2_2_2026",
      "EMPURRADA_2_3_2026",
      "EMPURRADA_2_4_2026",
      "EMPURRADA_2_5_2026",
      "EMPURRADA_2_6_2026",
      "EMPURRADA_2_7_2026",
      "EMPURRADA_1_8_2026",
    ];
    const dates = labels.map((l) => parseVigenciaLabel(l).effectiveDate);
    expect(dates).toEqual([
      "2025-12-02",
      "2026-01-02",
      "2026-02-02",
      "2026-03-02",
      "2026-04-02",
      "2026-05-02",
      "2026-06-02",
      "2026-07-02",
      "2026-08-01",
    ]);
    // Chronological, which is what promotion relies on for identifier history.
    expect([...dates].sort()).toEqual(dates);
    // And every one of them is the same channel — the series the product has.
    expect(labels.map(channelOf)).toEqual(labels.map(() => "EMPURRADA"));
  });

  it("returns null instead of guessing when the shape is unknown", () => {
    // "EMPURRADA" has no date; "1_8_2026" has no channel — a label that is all
    // numbers must not be read as a channel called "1"; "" has neither.
    for (const bad of ["EMPURRADA", "1_8_2026", "", "EMPURRADA_1_8_26", "EMPURRADA 1 8 2026"]) {
      const result = parseVigenciaLabel(bad);
      expect(result.effectiveDate).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.failureCode).toBe("UNRECOGNISED_FORMAT");
    }
  });

  it("rejects calendar-impossible dates rather than rolling them over", () => {
    // Date would silently turn 31 February into 3 March.
    expect(parseVigenciaLabel("EMPURRADA_31_2_2026").effectiveDate).toBeNull();
    expect(parseVigenciaLabel("EMPURRADA_31_2_2026").failureCode).toBe(
      "IMPOSSIBLE_DATE",
    );
    expect(parseVigenciaLabel("EMPURRADA_1_13_2026").failureCode).toBe(
      "IMPOSSIBLE_DATE",
    );
  });
});

/**
 * O canal deixou de ser palavra fixa.
 *
 * O padrão era `^EMPURRADA_…$`: um export do canal ROTA — o que as telas do
 * cliente mostram — seria recusado inteiro, com `UNRECOGNISED_FORMAT`, não
 * porque a forma fosse desconhecida, mas porque a primeira palavra era. A
 * ampliação é estritamente aditiva, e é isso que os testes acima e abaixo
 * provam: nenhum rótulo antes aceito mudou de data, e nenhum rótulo antes
 * recusado por *forma* passou a ser aceito.
 */
describe("outros canais", () => {
  it("aceita ROTA com a mesma data que EMPURRADA no mesmo dia", () => {
    const rota = parseVigenciaLabel("ROTA_1_8_2026");
    const empurrada = parseVigenciaLabel("EMPURRADA_1_8_2026");
    expect(rota.effectiveDate).toBe("2026-08-01");
    expect(rota.effectiveDate).toBe(empurrada.effectiveDate);
    // A data é a mesma; o canal é o que as distingue.
    expect(rota.channel).toBe("ROTA");
    expect(empurrada.channel).toBe("EMPURRADA");
  });

  it("lê o canal como tudo que vem antes dos três grupos numéricos", () => {
    // Um canal com underscore no nome continua sendo um canal só: quem ancora
    // a divisão são os três grupos do fim, não o primeiro underscore.
    expect(channelOf("ROTA_SECA_1_8_2026")).toBe("ROTA_SECA");
    expect(channelOf("EMPURRADA_2_12_2025")).toBe("EMPURRADA");
  });

  it("devolve canal nulo, e não um canal inventado, para rótulo fora do padrão", () => {
    // Rótulos de fixture e de arquivos com nome à mão caem todos na mesma
    // partição nula — e ficam comparáveis entre si, que é o desejado.
    for (const label of ["CAR_JAN", "vigencia-1", "EMPURRADA"]) {
      expect(channelOf(label)).toBeNull();
    }
  });

  it("não confunde canal com data quando o rótulo tem números demais", () => {
    // Os três grupos do fim ganham; o resto é canal, mesmo com dígitos.
    expect(channelOf("R2_1_8_2026")).toBe("R2");
    expect(parseVigenciaLabel("R2_1_8_2026").effectiveDate).toBe("2026-08-01");
  });
});
