import { describe, expect, it } from "vitest";
import { parseVigenciaLabel } from "../vigencia";

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
  });

  it("returns null instead of guessing when the shape is unknown", () => {
    for (const bad of ["EMPURRADA", "PUXADA_1_8_2026", "1_8_2026", ""]) {
      const result = parseVigenciaLabel(bad);
      expect(result.effectiveDate).toBeNull();
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
