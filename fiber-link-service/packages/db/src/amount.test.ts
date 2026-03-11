import { describe, expect, it } from "vitest";
import {
  InvalidAmountError,
  addDecimalStrings,
  assertPositiveAmount,
  compareDecimalStrings,
  formatDecimal,
  parseDecimal,
  subtractDecimalStrings,
  toErrorMessage,
} from "./amount";

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

  it("compares decimal strings with different scales", () => {
    expect(compareDecimalStrings("1.2", "1.20")).toBe(0);
    expect(compareDecimalStrings("1.21", "1.20")).toBe(1);
    expect(compareDecimalStrings("1.19", "1.2")).toBe(-1);
  });

  it("adds decimal strings with canonical formatting", () => {
    expect(addDecimalStrings("1", "2.50")).toBe("3.5");
    expect(addDecimalStrings("0.25", "0.75")).toBe("1");
  });

  it("subtracts decimal strings with signed results", () => {
    expect(subtractDecimalStrings("10", "3")).toBe("7");
    expect(subtractDecimalStrings("1.5", "0.25")).toBe("1.25");
    expect(subtractDecimalStrings("5", "5")).toBe("0");
    expect(subtractDecimalStrings("3", "10")).toBe("-7");
    expect(subtractDecimalStrings("0.1", "0.3")).toBe("-0.2");
  });

  it("subtracts decimal strings with mixed scales", () => {
    expect(subtractDecimalStrings("10.50", "3")).toBe("7.5");
    expect(subtractDecimalStrings("100", "0.001")).toBe("99.999");
    expect(subtractDecimalStrings("0.001", "100")).toBe("-99.999");
  });
});

describe("toErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("converts non-Error values to strings", () => {
    expect(toErrorMessage("plain string")).toBe("plain string");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });
});
