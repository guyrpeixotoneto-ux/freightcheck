import { describe, expect, it } from "vitest";
import { NullReason, toNumericString, typeCell, type SentinelRule } from "../values";

const base = {
  attributeCode: "cavalo.teste",
  columnHeader: "Teste",
  sentinelRules: [] as SentinelRule[],
};

describe("zero versus absence", () => {
  it("keeps a true economic zero as a number, not a null", () => {
    const result = typeCell({ type: "n", value: 0 }, base);
    expect(result.isNull).toBe(false);
    expect(result.nullReason).toBeNull();
    expect(result.valueNumeric).toBe("0");
    expect(result.valueHash).toBe("n:0");
  });

  it("distinguishes the four kinds of absence", () => {
    // The column exists in the layout but this row had no cell at all.
    const missing = typeCell({ type: "z", value: undefined }, base);
    expect(missing.nullReason).toBe(NullReason.VALUE_MISSING);

    // A cell exists and holds an empty string.
    const empty = typeCell({ type: "s", value: "" }, base);
    expect(empty.nullReason).toBe(NullReason.EMPTY);

    // A confirmed rule says this value means "absent".
    const sentinel = typeCell(
      { type: "n", value: -1 },
      {
        ...base,
        sentinelRules: [
          {
            attributeCode: "cavalo.teste",
            rawValue: "-1",
            nullReason: NullReason.SENTINEL,
          },
        ],
      },
    );
    expect(sentinel.isNull).toBe(true);
    expect(sentinel.nullReason).toBe(NullReason.SENTINEL);

    // An Excel error cell is unreadable, not absent-by-design.
    const invalid = typeCell({ type: "e", value: "#REF!" }, base);
    expect(invalid.nullReason).toBe(NullReason.INVALID);

    // All four hash differently: the diff engine must never conflate them.
    const hashes = [missing, empty, sentinel, invalid].map((r) => r.valueHash);
    expect(new Set(hashes).size).toBe(4);
    // ...and none of them equals a real zero.
    expect(hashes).not.toContain("n:0");
  });
});

describe("sentinels are never guessed", () => {
  it("stores a suspected sentinel as the number it is, with a warning", () => {
    // combustivelPercentualPerdaVida = -1 in the real export. Almost certainly
    // "not applicable", but blanking it without a confirmed rule would corrupt
    // every average computed from that column.
    const result = typeCell(
      { type: "n", value: -1 },
      {
        ...base,
        attributeCode: "cavalo.combustivel_percentual_perda_vida",
        columnHeader: "combustivelPercentualPerdaVida",
        suspectedSentinelValues: ["-1"],
      },
    );
    expect(result.isNull).toBe(false);
    expect(result.valueNumeric).toBe("-1");
    expect(result.warnings.map((w) => w.code)).toContain("SUSPECTED_SENTINEL");
  });

  it("applies a global rule only when its value matches", () => {
    const rules: SentinelRule[] = [
      { attributeCode: null, rawValue: "N/A", nullReason: "NOT_APPLICABLE" },
    ];
    expect(typeCell({ type: "s", value: "N/A" }, { ...base, sentinelRules: rules }).nullReason).toBe(
      "NOT_APPLICABLE",
    );
    expect(typeCell({ type: "s", value: "OK" }, { ...base, sentinelRules: rules }).isNull).toBe(
      false,
    );
  });

  it("does not let one attribute's rule blank another attribute", () => {
    const rules: SentinelRule[] = [
      { attributeCode: "cavalo.outro", rawValue: "0", nullReason: "SENTINEL" },
    ];
    const result = typeCell({ type: "n", value: 0 }, { ...base, sentinelRules: rules });
    expect(result.isNull).toBe(false);
    expect(result.valueNumeric).toBe("0");
  });
});

describe("date handling", () => {
  it("stores a pure date as a date", () => {
    const result = typeCell({ type: "d", value: new Date("2026-08-01T00:00:00Z") }, base);
    expect(result.resolvedType).toBe("DATE");
    expect(result.valueDate).toBe("2026-08-01");
  });

  it("refuses to truncate a timestamp to a date", () => {
    // The `data` column mixes 12:00:00 and 23:59:59 within one column.
    const noon = typeCell({ type: "d", value: new Date("2020-10-01T12:00:00Z") }, base);
    const endOfDay = typeCell(
      { type: "d", value: new Date("2020-10-01T23:59:59Z") },
      base,
    );
    expect(noon.resolvedType).toBe("TIMESTAMP");
    expect(noon.valueText).toBe("2020-10-01T12:00:00Z");
    expect(noon.warnings.map((w) => w.code)).toContain("DATE_WITH_TIME_COMPONENT");
    // Two different instants stay two different values.
    expect(noon.valueHash).not.toBe(endOfDay.valueHash);
  });

  it("flags a date-like serial in a temporal-sounding but unknown column without converting it", () => {
    // "dataCriacao" is not one of the declared date fields (data,
    // dataFimContrato, dataInicioContrato, vigencia, competencia) — it can
    // only ever be flagged for curation, never guessed automatically.
    const result = typeCell(
      { type: "n", value: 46935.5 },
      { ...base, attributeCode: "cavalo.data_criacao", columnHeader: "dataCriacao" },
    );
    expect(result.resolvedType).toBe("NUMERIC");
    expect(result.valueNumeric).toBe("46935.5");
    expect(result.warnings.map((w) => w.code)).toContain("AMBIGUOUS_DATE_SERIAL");
  });

  it("does not flag ordinary numbers in ordinary columns", () => {
    const result = typeCell(
      { type: "n", value: 46935.5 },
      { ...base, columnHeader: "valorNfCompra" },
    );
    expect(result.warnings).toHaveLength(0);
  });

  describe("bare Excel serial in a declared date column", () => {
    const cases: [string, number, string][] = [
      ["data", 44197.5, "2021-01-01"],
      ["data", 44348, "2021-06-01"],
      ["data_fim_contrato", 44805.5, "2022-09-01"],
      ["data_fim_contrato", 44835.5, "2022-10-01"],
      ["data_fim_contrato", 44743.5, "2022-07-01"],
      ["data_fim_contrato", 44758.5, "2022-07-16"],
      ["data_fim_contrato", 46935.5, "2028-07-01"],
    ];

    it.each(cases)(
      "converts %s = %s to %s, with no time-of-day leaking into it",
      (slug, serial, expectedIso) => {
        const result = typeCell(
          { type: "n", value: serial },
          { ...base, attributeCode: `cavalo.${slug}`, columnHeader: slug },
        );
        expect(result.resolvedType).toBe("DATE");
        expect(result.valueDate).toBe(expectedIso);
        expect(result.valueNumeric).toBeNull();
        expect(result.warnings).toHaveLength(0);
      },
    );

    it("reads the number, the string with a dot, and the string with a comma to the same date", () => {
      const opts = { ...base, attributeCode: "cavalo.data_fim_contrato", columnHeader: "dataFimContrato" };
      const fromNumber = typeCell({ type: "n", value: 44805.5 }, opts);
      const fromDot = typeCell({ type: "s", value: "44805.5" }, opts);
      const fromComma = typeCell({ type: "s", value: "44805,5" }, opts);
      const fromIntegerString = typeCell({ type: "s", value: "44805" }, opts);

      expect(fromNumber.valueDate).toBe("2022-09-01");
      expect(fromDot.valueDate).toBe("2022-09-01");
      expect(fromComma.valueDate).toBe("2022-09-01");
      expect(fromIntegerString.valueDate).toBe("2022-09-01");
      expect(fromDot.resolvedType).toBe("DATE");
      expect(fromComma.resolvedType).toBe("DATE");
    });

    it("still accepts an ordinary date string in the same column, untouched", () => {
      const opts = { ...base, attributeCode: "cavalo.data", columnHeader: "data" };
      expect(typeCell({ type: "s", value: "2022-09-01" }, opts).valueText).toBe("2022-09-01");
      expect(typeCell({ type: "s", value: "01/09/2022" }, opts).valueText).toBe("01/09/2022");
      expect(typeCell({ type: "s", value: "01-09-2022" }, opts).valueText).toBe("01-09-2022");
    });

    it("leaves a blank cell blank and an unreadable one invalid", () => {
      const opts = { ...base, attributeCode: "cavalo.data_fim_contrato", columnHeader: "dataFimContrato" };
      expect(typeCell({ type: "z", value: undefined }, opts).isNull).toBe(true);
      expect(typeCell({ type: "s", value: "" }, opts).nullReason).toBe(NullReason.EMPTY);
      expect(typeCell({ type: "e", value: "#REF!" }, opts).nullReason).toBe(NullReason.INVALID);
    });
  });

  describe("regression: a number never becomes a date outside a declared date column", () => {
    it("keeps the same serial as a plain number in a financial column", () => {
      const opts = { ...base, attributeCode: "cavalo.valor_nf_compra", columnHeader: "valorNfCompra" };
      const result = typeCell({ type: "n", value: 44805.5 }, opts);
      expect(result.resolvedType).toBe("NUMERIC");
      expect(result.valueNumeric).toBe("44805.5");
      expect(result.valueDate).toBeNull();
    });

    it("keeps it as text, not a date, when it arrives as a string too", () => {
      const opts = { ...base, attributeCode: "cavalo.valor_nf_compra", columnHeader: "valorNfCompra" };
      const result = typeCell({ type: "s", value: "44805,5" }, opts);
      expect(result.resolvedType).toBe("TEXT");
      expect(result.valueText).toBe("44805,5");
    });

    it("does not convert a quantity, plate, or code column even when its value falls in the plausible date range", () => {
      for (const [attributeCode, header] of [
        ["cavalo.quantidade", "quantidade"],
        ["cavalo.placa", "placa"],
        ["cavalo.codigo", "codigo"],
        ["cavalo.remuneracao", "remuneracao"],
      ] as const) {
        const result = typeCell(
          { type: "n", value: 44805 },
          { ...base, attributeCode, columnHeader: header },
        );
        expect(result.resolvedType).toBe("NUMERIC");
        expect(result.valueDate).toBeNull();
      }
    });
  });
});

describe("numeric normalisation", () => {
  it("renders values without float artefacts and trims trailing zeros", () => {
    expect(toNumericString(5.48)).toBe("5.48");
    expect(toNumericString(5.5)).toBe("5.5");
    expect(toNumericString(0.1 + 0.2)).toBe("0.3");
    expect(toNumericString(11089.38)).toBe("11089.38");
    expect(toNumericString(-0)).toBe("0");
  });

  it("hashes equal values equally regardless of trailing zeros", () => {
    expect(typeCell({ type: "n", value: 5.5 }, base).valueHash).toBe(
      typeCell({ type: "n", value: 5.5 }, base).valueHash,
    );
    expect(typeCell({ type: "n", value: 5.5 }, base).valueHash).toBe("n:5.5");
  });
});
