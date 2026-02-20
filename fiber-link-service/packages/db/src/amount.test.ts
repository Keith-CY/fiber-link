import { describe, expect, it } from "vitest";
import { InvalidAmountError, assertPositiveAmount, formatDecimal, parseDecimal } from "./amount";

describe("amount", () => {
  it("parses valid decimals", () => {
    expect(parseDecimal("10")).toEqual({ value: 10n, scale: 0 });
    expect(parseDecimal("10.50")).toEqual({ value: 1050n, scale: 2 });
    expect(parseDecimal("0.125")).toEqual({ value: 125n, scale: 3 });
  });

  it("rejects invalid decimal strings", () => {
    expect(() => parseDecimal("")).toThrow(InvalidAmountError);
    expect(() => parseDecimal("abc")).toThrow(InvalidAmountError);
    expect(() => parseDecimal("1.2.3")).toThrow(InvalidAmountError);
  });

  it("formats decimals canonically", () => {
    expect(formatDecimal(725n, 2)).toBe("7.25");
    expect(formatDecimal(700n, 2)).toBe("7");
  });

  it("enforces strictly positive amounts", () => {
    expect(() => assertPositiveAmount("0")).toThrow(InvalidAmountError);
    expect(() => assertPositiveAmount("-1")).toThrow(InvalidAmountError);
    expect(() => assertPositiveAmount("0.000")).toThrow(InvalidAmountError);
    expect(() => assertPositiveAmount("1")).not.toThrow();
    expect(() => assertPositiveAmount("0.01")).not.toThrow();
  });
});
