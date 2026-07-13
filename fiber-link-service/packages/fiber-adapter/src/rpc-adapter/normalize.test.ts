import { describe, expect, it } from "vitest";
import {
  ckbDecimalToHexQuantity,
  normalizeOptionalName,
  normalizeRpcAmount,
  normalizeRpcInteger,
  parseBoolean,
  parseCkbDecimalToShannons,
  parsePositiveInteger,
  pickRequiredAmount,
  pickStringCandidate,
  pickTxEvidence,
  SHANNONS_PER_CKB,
  toHexQuantity,
} from "./normalize";

describe("normalizeRpcAmount", () => {
  it("stringifies finite numbers", () => {
    expect(normalizeRpcAmount(42)).toBe("42");
  });

  it("returns '0' for non-string, non-number values", () => {
    expect(normalizeRpcAmount(undefined)).toBe("0");
    expect(normalizeRpcAmount(null)).toBe("0");
    expect(normalizeRpcAmount(Number.NaN)).toBe("0");
  });

  it("returns '0' for blank strings", () => {
    expect(normalizeRpcAmount("   ")).toBe("0");
  });

  it("converts hex strings to base-10", () => {
    expect(normalizeRpcAmount("0xff")).toBe("255");
  });

  it("passes through trimmed decimal strings", () => {
    expect(normalizeRpcAmount("  1000 ")).toBe("1000");
  });
});

describe("normalizeRpcInteger", () => {
  it("returns integer numbers unchanged", () => {
    expect(normalizeRpcInteger(7)).toBe(7);
  });

  it("returns 0 for non-integer numbers and non-strings", () => {
    expect(normalizeRpcInteger(1.5)).toBe(0);
    expect(normalizeRpcInteger(null)).toBe(0);
  });

  it("returns 0 for blank strings", () => {
    expect(normalizeRpcInteger("")).toBe(0);
  });

  it("parses hex strings", () => {
    expect(normalizeRpcInteger("0x10")).toBe(16);
  });

  it("parses decimal strings and rejects non-integers", () => {
    expect(normalizeRpcInteger("12")).toBe(12);
    expect(normalizeRpcInteger("12.5")).toBe(0);
  });
});

describe("toHexQuantity", () => {
  it("lowercases existing hex values", () => {
    expect(toHexQuantity("0xAB")).toBe("0xab");
  });

  it("converts decimal strings to hex", () => {
    expect(toHexQuantity("255")).toBe("0xff");
  });

  it("throws on non-numeric input", () => {
    expect(() => toHexQuantity("abc")).toThrow("invalid amount: abc");
  });
});

describe("parseCkbDecimalToShannons", () => {
  it("converts whole and fractional CKB to shannons", () => {
    expect(parseCkbDecimalToShannons("1")).toBe(SHANNONS_PER_CKB);
    expect(parseCkbDecimalToShannons("1.5")).toBe(150_000_000n);
  });

  it("throws on malformed amounts", () => {
    expect(() => parseCkbDecimalToShannons("1.2.3")).toThrow("invalid CKB amount");
  });

  it("throws when more than 8 decimal places are supplied", () => {
    expect(() => parseCkbDecimalToShannons("1.123456789")).toThrow("at most 8 decimal places");
  });

  it("throws when the amount is not greater than zero", () => {
    expect(() => parseCkbDecimalToShannons("0")).toThrow("must be greater than 0");
  });

  it("ckbDecimalToHexQuantity emits a hex quantity", () => {
    expect(ckbDecimalToHexQuantity("1")).toBe(`0x${SHANNONS_PER_CKB.toString(16)}`);
  });
});

describe("pickStringCandidate", () => {
  it("returns the trimmed value when non-empty", () => {
    expect(pickStringCandidate("  hi ")).toBe("hi");
  });

  it("returns null for empty or non-string values", () => {
    expect(pickStringCandidate("   ")).toBeNull();
    expect(pickStringCandidate(123)).toBeNull();
  });
});

describe("pickRequiredAmount", () => {
  it("returns '0' when the key is missing", () => {
    expect(pickRequiredAmount({}, "amount")).toBe("0");
    expect(pickRequiredAmount(undefined, "amount")).toBe("0");
  });

  it("returns the normalized amount when present", () => {
    expect(pickRequiredAmount({ amount: "0x0a" }, "amount")).toBe("10");
  });
});

describe("normalizeOptionalName", () => {
  it("lowercases and trims strings", () => {
    expect(normalizeOptionalName("  MyChannel ")).toBe("mychannel");
  });

  it("returns an empty string for non-strings", () => {
    expect(normalizeOptionalName(undefined)).toBe("");
  });
});

describe("parseBoolean", () => {
  it("returns undefined for non-strings and blanks", () => {
    expect(parseBoolean(undefined)).toBeUndefined();
    expect(parseBoolean("   ")).toBeUndefined();
  });

  it("recognizes truthy tokens", () => {
    for (const token of ["1", "true", "YES", "on"]) {
      expect(parseBoolean(token)).toBe(true);
    }
  });

  it("recognizes falsy tokens", () => {
    for (const token of ["0", "false", "NO", "off"]) {
      expect(parseBoolean(token)).toBe(false);
    }
  });

  it("returns undefined for unrecognized tokens", () => {
    expect(parseBoolean("maybe")).toBeUndefined();
  });
});

describe("pickTxEvidence", () => {
  it("returns the first present hash candidate", () => {
    expect(pickTxEvidence({ payment_hash: "0xabc" })).toBe("0xabc");
    expect(pickTxEvidence({ tx_hash: "0x111", hash: "0x222" })).toBe("0x111");
  });

  it("returns null when no candidate is a non-empty string", () => {
    expect(pickTxEvidence({ tx_hash: "" })).toBeNull();
    expect(pickTxEvidence(undefined)).toBeNull();
  });
});

describe("parsePositiveInteger", () => {
  it("parses positive integer strings", () => {
    expect(parsePositiveInteger("25")).toBe(25);
  });

  it("returns undefined for non-strings, non-numeric, and non-positive values", () => {
    expect(parsePositiveInteger(undefined)).toBeUndefined();
    expect(parsePositiveInteger("1.5")).toBeUndefined();
    expect(parsePositiveInteger("0")).toBeUndefined();
  });
});
