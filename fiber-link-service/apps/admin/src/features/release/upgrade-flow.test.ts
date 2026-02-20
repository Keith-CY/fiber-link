import { describe, expect, it } from "vitest";
import { runUpgradeFlow } from "./upgrade-flow";

describe("upgrade flow", () => {
  it("blocks upgrade when prechecks fail", () => {
    const result = runUpgradeFlow({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      prechecks: { compatibilityOk: false, diskOk: true, servicesReady: true },
      postchecks: { runtimeHealthy: true, firstPathValidated: true },
      autoRollback: true,
    });

    expect(result.finalVersion).toBe("1.0.0");
    expect(result.records[0]?.message).toContain("blocked by prechecks");
  });

  it("rolls back cleanly when postchecks fail and auto rollback enabled", () => {
    const result = runUpgradeFlow({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      prechecks: { compatibilityOk: true, diskOk: true, servicesReady: true },
      postchecks: { runtimeHealthy: false, firstPathValidated: true },
      autoRollback: true,
    });

    expect(result.finalVersion).toBe("1.0.0");
    expect(result.records.map((r) => r.action)).toEqual(["upgrade", "rollback"]);
  });

  it("records explicit failed-upgrade audit when postchecks fail and auto rollback is disabled", () => {
    const result = runUpgradeFlow({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      prechecks: { compatibilityOk: true, diskOk: true, servicesReady: true },
      postchecks: { runtimeHealthy: false, firstPathValidated: false },
      autoRollback: false,
    });

    expect(result.finalVersion).toBe("1.1.0");
    expect(result.records.map((r) => [r.action, r.success, r.message])).toEqual([
      ["upgrade", true, "upgrade applied"],
      ["upgrade", false, "postcheck failure, no rollback performed"],
    ]);
  });
});
