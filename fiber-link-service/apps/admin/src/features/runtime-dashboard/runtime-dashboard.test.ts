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
      liquidityPendingCount: 0,
    });

    expect(summary.runtimeState).toBe("degraded");
    expect(summary.severity).toBe("warning");
    expect(summary.topErrorClass).toBe("NETWORK_TIMEOUT");
  });

  it("surfaces liquidity-pending withdrawals as a warning signal", () => {
    const summary = buildDashboardSummary({
      runtimeState: "running",
      lastSuccessAt: "2026-03-07T00:00:00.000Z",
      failureCount24h: 0,
      topErrorClass: null,
      retryBackoffActive: false,
      liquidityPendingCount: 2,
    });

    expect(summary.liquidityPendingCount).toBe(2);
    expect(summary.severity).toBe("warning");
  });

  it("redacts sensitive values in whitespace-delimited text", () => {
    const redacted = redactSecrets("token=abc password=123 secret=xyz");
    expect(redacted).toBe("token=[REDACTED] password=[REDACTED] secret=[REDACTED]");
  });

  it("redacts query-like values without eating neighbor params", () => {
    const redacted = redactSecrets("token=abc&user=456 password=123;mode=fast");
    expect(redacted).toBe("token=[REDACTED]&user=456 password=[REDACTED];mode=fast");
  });

  it("redacts multiple occurrences and mixed delimiters", () => {
    const redacted = redactSecrets("secret=one;token=two password=three&next=ok");
    expect(redacted).toBe("secret=[REDACTED];token=[REDACTED] password=[REDACTED]&next=ok");
  });
});
