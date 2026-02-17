import { describe, expect, it } from "vitest";
import {
  createReadyDashboardState,
  summarizeWithdrawalStates,
  type DashboardApp,
  type DashboardState,
  type DashboardWithdrawal,
} from "./dashboard-model";
import { buildDashboardRenderModel } from "./dashboard-view";

function createFixtures() {
  const now = new Date("2026-02-17T10:00:00.000Z");
  const apps: DashboardApp[] = [
    { appId: "app-alpha", createdAt: now },
    { appId: "app-beta", createdAt: now },
  ];
  const withdrawals: DashboardWithdrawal[] = [
    {
      id: "w-1",
      appId: "app-alpha",
      userId: "u-1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q000",
      state: "PENDING",
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      txHash: null,
    },
    {
      id: "w-2",
      appId: "app-beta",
      userId: "u-2",
      asset: "CKB",
      amount: "20",
      toAddress: "ckt1q111",
      state: "FAILED",
      retryCount: 2,
      nextRetryAt: null,
      lastError: "insufficient balance",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      txHash: null,
    },
  ];

  return { apps, withdrawals };
}

describe("dashboard view model", () => {
  it("builds loading state render model", () => {
    const renderModel = buildDashboardRenderModel({ kind: "loading" });
    expect(renderModel.kind).toBe("loading");
    if (renderModel.kind === "loading") {
      expect(renderModel.message).toContain("Loading");
    }
  });

  it("builds error state render model", () => {
    const renderModel = buildDashboardRenderModel({ kind: "error", message: "DB not configured" });
    expect(renderModel.kind).toBe("error");
    if (renderModel.kind === "error") {
      expect(renderModel.message).toBe("DB not configured");
    }
  });

  it("shows full withdrawal columns for SUPER_ADMIN", () => {
    const { apps, withdrawals } = createFixtures();
    const state: DashboardState = createReadyDashboardState("SUPER_ADMIN", apps, withdrawals);

    const renderModel = buildDashboardRenderModel(state);
    expect(renderModel.kind).toBe("ready");
    if (renderModel.kind !== "ready") {
      return;
    }

    expect(renderModel.showUserColumn).toBe(true);
    expect(renderModel.scopeLabel).toContain("Global");
    expect(renderModel.summaryRows.find((row) => row.state === "PENDING")?.count).toBe(1);
    expect(renderModel.summaryRows.find((row) => row.state === "FAILED")?.count).toBe(1);
    expect(renderModel.withdrawalRows[0]?.userId).toBe("u-1");
  });

  it("hides user ids for COMMUNITY_ADMIN", () => {
    const { apps, withdrawals } = createFixtures();
    const state: DashboardState = createReadyDashboardState("COMMUNITY_ADMIN", apps, withdrawals);

    const renderModel = buildDashboardRenderModel(state);
    expect(renderModel.kind).toBe("ready");
    if (renderModel.kind !== "ready") {
      return;
    }

    expect(renderModel.showUserColumn).toBe(false);
    expect(renderModel.scopeLabel).toContain("Scoped");
    expect(renderModel.withdrawalRows.every((row) => row.userId === "Restricted")).toBe(true);
  });
});

describe("withdrawal summary", () => {
  it("counts each state and keeps total", () => {
    const { withdrawals } = createFixtures();
    const summary = summarizeWithdrawalStates(withdrawals);
    expect(summary.total).toBe(2);
    expect(summary.byState.PENDING).toBe(1);
    expect(summary.byState.FAILED).toBe(1);
    expect(summary.byState.COMPLETED).toBe(0);
  });
});
