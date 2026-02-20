import { describe, expect, it } from "vitest";
import { formatHealthCheck, runHealthCheck } from "./health-check";

describe("health check", () => {
  it("returns deterministic error codes and remediation", () => {
    const result = runHealthCheck({
      correlationId: "cid-1",
      dependenciesReady: true,
      configValid: false,
      permissionsOk: true,
      endpointReachable: false,
    });

    expect(result.status).toBe("red");
    expect(result.findings.map((f) => f.code)).toEqual([
      "HC_DEPENDENCIES",
      "HC_CONFIG",
      "HC_PERMISSIONS",
      "HC_CONNECTIVITY",
    ]);
    expect(result.findings.find((f) => f.code === "HC_CONFIG")?.remediation).toContain("invalid config");
  });

  it("supports machine-readable and human-readable output", () => {
    const result = runHealthCheck({
      correlationId: "cid-2",
      dependenciesReady: true,
      configValid: true,
      permissionsOk: true,
      endpointReachable: true,
    });

    expect(JSON.parse(formatHealthCheck(result, "json")).correlationId).toBe("cid-2");
    const text = formatHealthCheck(result, "text");
    expect(text).toContain("correlation_id=cid-2");
    expect(text).toContain("HC_CONNECTIVITY");
  });
});
