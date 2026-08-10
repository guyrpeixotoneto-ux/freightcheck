import { describe, expect, it } from "vitest";
import {
  excelSerialToDate,
  hasTimeComponent,
  isPlausibleDateSerial,
  toIsoDate,
  toIsoDateTime,
} from "../excel-dates";

describe("excelSerialToDate", () => {
  it("maps the Unix epoch serial exactly", () => {
    expect(toIsoDate(excelSerialToDate(25569)!)).toBe("1970-01-01");
  });

  it("maps well-known anchors", () => {
    expect(toIsoDate(excelSerialToDate(1)!)).toBe("1900-01-01");
    expect(toIsoDate(excelSerialToDate(59)!)).toBe("1900-02-28");
    expect(toIsoDate(excelSerialToDate(61)!)).toBe("1900-03-01");
    expect(toIsoDate(excelSerialToDate(36526)!)).toBe("2000-01-01");
    expect(toIsoDate(excelSerialToDate(45658)!)).toBe("2025-01-01");
  });

  it("refuses Excel's phantom 1900-02-29 instead of inventing a date", () => {
    expect(excelSerialToDate(60)).toBeNull();
  });

  it("keeps the fractional day as a time of day", () => {
    // 0.5 of a day past midnight is noon.
    expect(toIsoDateTime(excelSerialToDate(45658.5)!)).toBe("2025-01-01T12:00:00Z");
  });

  it("reads dataFimContrato from the real export", () => {
    // The Freightec file delivers this value as a bare number in a column the
    // spreadsheet never formatted as a date — the AMBIGUOUS_DATE_SERIAL case.
    const date = excelSerialToDate(46935.5)!;
    expect(toIsoDateTime(date)).toBe("2028-07-01T12:00:00Z");
  });

  it("rejects non-finite input rather than producing Invalid Date", () => {
    expect(excelSerialToDate(Number.NaN)).toBeNull();
    expect(excelSerialToDate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("hasTimeComponent", () => {
  it("separates midnight from a real time of day", () => {
    expect(hasTimeComponent(new Date("2026-08-01T00:00:00Z"))).toBe(false);
    expect(hasTimeComponent(new Date("2026-08-01T12:00:00Z"))).toBe(true);
    // The export uses 23:59:59 as a distinct value from 12:00:00 in the same
    // column; truncating either to a date would merge two different facts.
    expect(hasTimeComponent(new Date("2020-10-01T23:59:59Z"))).toBe(true);
  });
});

describe("isPlausibleDateSerial", () => {
  it("flags values inside the plausible window only", () => {
    expect(isPlausibleDateSerial(46935.5)).toBe(true);
    expect(isPlausibleDateSerial(1)).toBe(false);
    expect(isPlausibleDateSerial(-1)).toBe(false);
    expect(isPlausibleDateSerial(2022)).toBe(false); // a model year, not a date
  });
});
