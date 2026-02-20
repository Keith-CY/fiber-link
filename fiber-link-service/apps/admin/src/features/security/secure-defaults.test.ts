import { describe, expect, it } from "vitest";
import { SECURE_DEFAULTS, canRunHighRiskAction, evaluatePolicyDecision, maskSensitive } from "./secure-defaults";

describe("secure defaults", () => {
  it("ships secure baseline enabled by default", () => {
    expect(SECURE_DEFAULTS.leastPrivilegeMode).toBe(true);
    expect(SECURE_DEFAULTS.maskSensitiveOutput).toBe(true);
    expect(SECURE_DEFAULTS.requireHighRiskConfirmation).toBe(true);
    expect(SECURE_DEFAULTS.failClosedOnPolicyUncertainty).toBe(true);
  });

  it("requires explicit confirmation for high-risk actions", () => {
    expect(canRunHighRiskAction(false)).toBe(false);
    expect(canRunHighRiskAction(true)).toBe(true);
  });

  it("fails closed when policy is uncertain and masks secrets", () => {
    expect(evaluatePolicyDecision({ policyKnown: false })).toBe("deny");
    expect(maskSensitive("abc123secretxyz")).toContain("***");
  });
});
