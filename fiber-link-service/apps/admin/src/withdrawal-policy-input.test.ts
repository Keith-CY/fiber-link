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
    ).toThrow("cooldownSeconds must be an integer >= 0");

    expect(() =>
      parseWithdrawalPolicyInput({
        appId: "app-alpha",
        allowedAssets: "CKB",
        maxPerRequest: "1",
        perUserDailyMax: "2",
        perAppDailyMax: "3",
        cooldownSeconds: "2.5",
      }),
    ).toThrow("cooldownSeconds must be an integer >= 0");
  });
});
