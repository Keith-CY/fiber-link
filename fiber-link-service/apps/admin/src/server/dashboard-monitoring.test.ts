import { describe, expect, it } from "vitest";
import { loadDashboardMonitoringSummary } from "./dashboard-monitoring";

describe("dashboard monitoring", () => {
  it("parses alert payloads even when the monitoring command exits non-zero", async () => {
    const error = Object.assign(new Error("command failed"), {
      code: 2,
      stdout: JSON.stringify(
        {
          status: "alert",
          generatedAt: "2026-03-22T00:00:00.000Z",
          checks: { status: "not_ready" },
          settlement: {
            backlogUnpaid: 4,
            retryPendingCount: 2,
          },
          withdrawalParity: {
            totals: { issueCount: 1 },
          },
          alerts: [{ code: "backlog" }, { code: "parity" }],
        },
        null,
        2,
      ),
      stderr: "alert status",
    });

    const summary = await loadDashboardMonitoringSummary({
      runner: async () => {
        throw error;
      },
    });

    expect(summary).toEqual({
      status: "alert",
      generatedAt: "2026-03-22T00:00:00.000Z",
      readinessStatus: "not_ready",
      unpaidBacklog: 4,
      retryPendingCount: 2,
      withdrawalParityIssueCount: 1,
      alertCount: 2,
      rawJson: error.stdout,
    });
  });

  it("still fails when a non-zero exit does not contain parseable JSON", async () => {
    const error = Object.assign(new Error("command failed"), {
      code: 2,
      stdout: "",
      stderr: "boom",
    });

    await expect(
      loadDashboardMonitoringSummary({
        runner: async () => {
          throw error;
        },
      }),
    ).rejects.toThrow("command failed");
  });
});
