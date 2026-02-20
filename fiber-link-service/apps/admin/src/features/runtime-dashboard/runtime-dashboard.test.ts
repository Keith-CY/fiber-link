import { describe, expect, it } from "vitest";
import { buildDashboardSummary, redactSecrets } from "./runtime-dashboard";

describe("runtime dashboard", () => {
  it("summarizes operational state at a glance", () => {
    const summary = buildDashboardSummary({
      runtimeState: "degraded",
      lastSuccessAt: "2026-02-20T04:00:00.000Z",
      failureCount24h: 3,
      topErrorClass: "NETWORK_TIMEOUT",
      retryBackoffActive: true,
    });

    expect(summary.runtimeState).toBe("degraded");
    expect(summary.severity).toBe("warning");
    expect(summary.topErrorClass).toBe("NETWORK_TIMEOUT");
  });

  it("redacts sensitive values", () => {
    const redacted = redactSecrets("token=abc password=123 secret=xyz");
    expect(redacted).toBe("token=[REDACTED] password=[REDACTED] secret=[REDACTED]");
  });
});
