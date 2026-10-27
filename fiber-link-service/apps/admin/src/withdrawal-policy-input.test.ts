import { describe, expect, it } from "vitest";
import { parseWithdrawalPolicyInput } from "./withdrawal-policy-input";

describe("withdrawal policy input", () => {
  it("parses and normalizes string asset input", () => {
    const parsed = parseWithdrawalPolicyInput({
      appId: "  app-beta  ",
      allowedAssets: "USDI, CKB, USDI, invalid",
      maxPerRequest: "1500",
      perUserDailyMax: "4500",
      perAppDailyMax: "25000",
      cooldownSeconds: "45",
    });

    expect(parsed).toEqual({
      appId: "app-beta",
      allowedAssets: ["USDI", "CKB"],
      maxPerRequest: "1500",
      perUserDailyMax: "4500",
      perAppDailyMax: "25000",
      cooldownSeconds: 45,
    });
  });

  it("parses array asset input and deduplicates supported assets", () => {
    const parsed = parseWithdrawalPolicyInput({
      appId: "app-alpha",
      allowedAssets: ["CKB", "USDI", "CKB", "ignored"],
      maxPerRequest: "10",
      perUserDailyMax: "20",
      perAppDailyMax: "40",
      cooldownSeconds: 0,
    });

    expect(parsed.allowedAssets).toEqual(["CKB", "USDI"]);
  });

  it("rejects non-object input", () => {
    expect(() => parseWithdrawalPolicyInput(undefined)).toThrow("input must be an object");
  });

  it("rejects blank app ids", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "   ",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: 0,
      }),
    ).toThrow("appId is required");
  });

  it("rejects missing supported assets", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: ["BTC"],
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: 0,
      }),
    ).toThrow("allowedAssets must include CKB or USDI");
  });

  it("rejects missing thresholds", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: 0,
      }),
    ).toThrow("maxPerRequest, perUserDailyMax, and perAppDailyMax are required");
  });

  it("rejects non-positive decimal thresholds", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "0",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: 0,
      }),
    ).toThrow("maxPerRequest, perUserDailyMax, and perAppDailyMax must be positive decimals");
  });

  it("rejects per-request values above per-user daily max", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "5",
        perUserDailyMax: "4",
        perAppDailyMax: "10",
        cooldownSeconds: 0,
      }),
    ).toThrow("maxPerRequest must be <= perUserDailyMax");
  });

  it("rejects negative or non-integer cooldowns", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: "-1",
      }),
    ).toThrow("cooldownSeconds must be an integer between 0 and 2147483647");

    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: "2.5",
      }),
    ).toThrow("cooldownSeconds must be an integer between 0 and 2147483647");
  });

  it.each([
    ["exponent number", 1e12],
    ["exponent string", "1e3"],
    ["boolean", true],
    ["empty string", ""],
    ["blank string", "   "],
    ["null", null],
    ["missing", undefined],
    ["hex string", "0x10"],
    ["int4 overflow", 2147483648],
    ["int4 overflow string", "2147483648"],
  ])("rejects a %s cooldown instead of coercing it", (_label, cooldownSeconds) => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds,
      }),
    ).toThrow("cooldownSeconds must be an integer between 0 and 2147483647");
  });

  it("accepts the int4 maximum cooldown and a trimmed digit string", () => {
    const base = {
      appId: "app-alpha",
      allowedAssets: "CKB",
      maxPerRequest: "1",
      perUserDailyMax: "2",
      perAppDailyMax: "3",
    };
    expect(parseWithdrawalPolicyInput({ ...base, cooldownSeconds: 2147483647 }).cooldownSeconds).toBe(2147483647);
    expect(parseWithdrawalPolicyInput({ ...base, cooldownSeconds: " 60 " }).cooldownSeconds).toBe(60);
  });

  it("rejects a per-app daily max below the per-user daily max", () => {
    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "10",
        perAppDailyMax: "5",
        cooldownSeconds: 0,
      }),
    ).toThrow("perUserDailyMax must be <= perAppDailyMax");
  });
});
