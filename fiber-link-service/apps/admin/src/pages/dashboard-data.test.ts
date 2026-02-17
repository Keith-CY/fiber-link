import { describe, expect, it } from "vitest";
import type { DbClient, WithdrawalState } from "@fiber-link/db";
import {
  buildDashboardViewModel,
  loadDashboardState,
  summarizeWithdrawalStates,
  type DashboardDataDependencies,
  type DashboardPageState,
} from "./dashboard-data";

type DashboardAppRow = {
  appId: string;
  createdAt: string;
};

type DashboardWithdrawalRow = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  state: WithdrawalState;
  createdAt: string;
  txHash: string | null;
};

function createDeps({
  apps,
  withdrawals,
}: {
  apps: DashboardAppRow;
  withdrawals: DashboardWithdrawalRow;
}): DashboardDataDependencies {
  const sharedDb = {} as DbClient;

  return {
    createDb: () => sharedDb,
    listApps: async () => [apps],
    listWithdrawals: async () => [withdrawals],
  };
}

describe("dashboard data", () => {
  it("returns error state when x-admin-role is missing", async () => {
    const state = await loadDashboardState({ roleHeader: undefined });

    expect(state).toMatchObject({
      status: "error",
      message: "Missing or invalid x-admin-role header",
    });
  });

  it("loads ready state for SUPER_ADMIN and keeps full visibility", async () => {
    const now = "2026-02-17T00:00:00.000Z";
    const deps = createDeps({
      apps: { appId: "app-1", createdAt: now },
      withdrawals: {
        id: "w-1",
        appId: "app-1",
        userId: "u-1",
        asset: "USDI",
        amount: "5",
        state: "PENDING",
        createdAt: now,
        txHash: null,
      },
    });

    const state = await loadDashboardState(
      {
        roleHeader: "SUPER_ADMIN",
      },
      deps,
    );

    expect(state).toMatchObject({
      status: "ready",
      role: "SUPER_ADMIN",
    });

    const viewModel = buildDashboardViewModel(state);
    expect(viewModel).toMatchObject({
      status: "ready",
      roleVisibility: {
        scopeDescription: "Global visibility across all communities",
        showUserId: true,
      },
    });
    if (viewModel.status === "ready") {
      expect(viewModel.withdrawalColumns).toContain("userId");
    }
  });

  it("loads ready state for COMMUNITY_ADMIN and applies scoped visibility", async () => {
    const now = "2026-02-17T00:00:00.000Z";
    const deps = createDeps({
      apps: { appId: "app-2", createdAt: now },
      withdrawals: {
        id: "w-2",
        appId: "app-2",
        userId: "u-2",
        asset: "CKB",
        amount: "2",
        state: "COMPLETED",
        createdAt: now,
        txHash: "0xabc",
      },
    });

    const state = await loadDashboardState(
      {
        roleHeader: "COMMUNITY_ADMIN",
        adminUserIdHeader: "admin-42",
      },
      deps,
    );

    expect(state).toMatchObject({
      status: "ready",
      role: "COMMUNITY_ADMIN",
    });

    const viewModel = buildDashboardViewModel(state);
    expect(viewModel).toMatchObject({
      status: "ready",
      roleVisibility: {
        scopeDescription: "Scoped visibility for assigned communities",
        showUserId: false,
      },
    });
    if (viewModel.status === "ready") {
      expect(viewModel.withdrawalColumns).not.toContain("userId");
    }
  });

  it("returns error state when data loading throws", async () => {
    const deps: DashboardDataDependencies = {
      createDb: () => {
        throw new Error("DATABASE_URL is required");
      },
      listApps: async () => [],
      listWithdrawals: async () => [],
    };

    const state = await loadDashboardState({ roleHeader: "SUPER_ADMIN" }, deps);
    expect(state).toMatchObject({
      status: "error",
      role: "SUPER_ADMIN",
      message: "DATABASE_URL is required",
    });
  });

  it("summarizes withdrawal states by count", () => {
    const now = "2026-02-17T00:00:00.000Z";
    const summaries = summarizeWithdrawalStates([
      {
        id: "w-1",
        appId: "a1",
        userId: "u1",
        asset: "USDI",
        amount: "1",
        state: "PENDING",
        createdAt: now,
        txHash: null,
      },
      {
        id: "w-2",
        appId: "a1",
        userId: "u2",
        asset: "USDI",
        amount: "2",
        state: "PENDING",
        createdAt: now,
        txHash: null,
      },
      {
        id: "w-3",
        appId: "a2",
        userId: "u3",
        asset: "CKB",
        amount: "3",
        state: "FAILED",
        createdAt: now,
        txHash: null,
      },
    ]);

    expect(summaries).toEqual([
      { state: "PENDING", count: 2 },
      { state: "PROCESSING", count: 0 },
      { state: "RETRY_PENDING", count: 0 },
      { state: "COMPLETED", count: 0 },
      { state: "FAILED", count: 1 },
    ]);
  });

  it("maps loading and error states into render model", () => {
    const loadingView = buildDashboardViewModel({ status: "loading" });
    expect(loadingView).toEqual({ status: "loading", title: "Fiber Link Admin Dashboard" });

    const errorState: DashboardPageState = {
      status: "error",
      role: "SUPER_ADMIN",
      message: "boom",
    };
    const errorView = buildDashboardViewModel(errorState);
    expect(errorView).toEqual({
      status: "error",
      title: "Fiber Link Admin Dashboard",
      message: "boom",
    });
  });
});
