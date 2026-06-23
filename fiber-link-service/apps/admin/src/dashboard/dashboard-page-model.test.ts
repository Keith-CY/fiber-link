import { describe, expect, it } from "vitest";
import {
  buildDashboardViewModel,
  buildOpsTriageCards,
  getRoleVisibility,
  parseAdminRole,
  summarizeWithdrawalStates,
  type DashboardWithdrawal,
} from "./dashboard-page-model";

const WITHDRAWALS: DashboardWithdrawal[] = [
  { id: "w1", appId: "a", userId: "u", asset: "CKB", amount: "1", state: "FAILED", createdAt: "t", txHash: null },
  { id: "w2", appId: "a", userId: "u", asset: "CKB", amount: "1", state: "LIQUIDITY_PENDING", createdAt: "t", txHash: null },
  { id: "w3", appId: "a", userId: "u", asset: "CKB", amount: "1", state: "COMPLETED", createdAt: "t", txHash: "0x" },
];

describe("dashboard page model", () => {
  it("parses only known admin roles", () => {
    expect(parseAdminRole("SUPER_ADMIN")).toBe("SUPER_ADMIN");
    expect(parseAdminRole("COMMUNITY_ADMIN")).toBe("COMMUNITY_ADMIN");
    expect(parseAdminRole("nope")).toBeUndefined();
    expect(parseAdminRole(undefined)).toBeUndefined();
  });

  it("describes role visibility", () => {
    expect(getRoleVisibility("SUPER_ADMIN").showGlobalControls).toBe(true);
    expect(getRoleVisibility("COMMUNITY_ADMIN").showUserId).toBe(false);
  });

  it("summarizes withdrawal states in canonical order", () => {
    const summary = summarizeWithdrawalStates(WITHDRAWALS);
    expect(summary.find((s) => s.state === "FAILED")?.count).toBe(1);
    expect(summary.find((s) => s.state === "LIQUIDITY_PENDING")?.count).toBe(1);
    expect(summary.find((s) => s.state === "PENDING")?.count).toBe(0);
  });

  it("builds triage cards from monitoring + withdrawal posture", () => {
    const cards = buildOpsTriageCards({
      status: "ready",
      role: "SUPER_ADMIN",
      apps: [],
      withdrawals: WITHDRAWALS,
      statusSummaries: summarizeWithdrawalStates(WITHDRAWALS),
      policies: [],
      operations: {
        monitoring: {
          status: "ready",
          summary: {
            status: "alert",
            generatedAt: "t",
            readinessStatus: "ready",
            unpaidBacklog: 8,
            retryPendingCount: 1,
            withdrawalParityIssueCount: 0,
            alertCount: 1,
          },
        },
        rateLimit: { status: "error", message: "x" },
        backups: { status: "error", message: "x" },
      },
    });
    const settlement = cards.find((c) => c.id === "settlement-backlog");
    expect(settlement?.value).toBe("9");
    expect(cards.find((c) => c.id === "failed-withdrawals")?.value).toBe("1");
  });

  it("maps page state into view-model variants", () => {
    expect(buildDashboardViewModel({ status: "loading" }).status).toBe("loading");
    expect(buildDashboardViewModel({ status: "error", message: "bad" }).status).toBe("error");
    const ready = buildDashboardViewModel({
      status: "ready",
      role: "COMMUNITY_ADMIN",
      apps: [],
      withdrawals: WITHDRAWALS,
      statusSummaries: summarizeWithdrawalStates(WITHDRAWALS),
      policies: [],
    });
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") {
      expect(ready.withdrawalColumns).not.toContain("userId");
    }
  });
});
