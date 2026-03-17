import type { DbClient, WithdrawalState } from "@fiber-link/db";
import type { DashboardDataDependencies, DashboardWithdrawalPolicy } from "../pages/dashboard-data";
import type { AdminConsoleDependencies } from "./admin-console-server";
import type { TrpcContext } from "./api/trpc";

type FixtureApp = {
  appId: string;
  createdAt: string;
};

type FixtureWithdrawal = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  state: WithdrawalState;
  createdAt: string;
  txHash: string | null;
};

type FixturePolicy = DashboardWithdrawalPolicy;

export type AdminConsoleFixture = {
  apps: FixtureApp[];
  withdrawals: FixtureWithdrawal[];
  policies: FixturePolicy[];
  communityAdminAppIds?: string[];
};

export function createFixtureAdminConsoleDependencies(fixture: AdminConsoleFixture): {
  deps: AdminConsoleDependencies;
  snapshot: {
    apps: FixtureApp[];
    withdrawals: FixtureWithdrawal[];
    policies: Map<string, FixturePolicy>;
  };
} {
  const snapshot = {
    apps: fixture.apps,
    withdrawals: fixture.withdrawals,
    policies: new Map(fixture.policies.map((policy) => [policy.appId, { ...policy }])),
  };
  const communityScope = new Set(fixture.communityAdminAppIds ?? fixture.apps.slice(0, 1).map((app) => app.appId));
  const sharedDb = {} as DbClient;

  const filterByScope = <T extends { appId: string }>(ctx: TrpcContext, rows: T[]): T[] => {
    if (ctx.role === "COMMUNITY_ADMIN") {
      return rows.filter((row) => communityScope.has(row.appId));
    }
    return rows;
  };

  const deps: DashboardDataDependencies & AdminConsoleDependencies = {
    createDb: () => sharedDb,
    listApps: async (ctx) => filterByScope(ctx, snapshot.apps),
    listWithdrawals: async (ctx) => filterByScope(ctx, snapshot.withdrawals),
    listPolicies: async (ctx) => filterByScope(ctx, Array.from(snapshot.policies.values())),
    upsertPolicy: async ({ ctx, input }) => {
      if (ctx.role === "COMMUNITY_ADMIN" && !communityScope.has(input.appId)) {
        throw new Error("COMMUNITY_ADMIN can only update policies for managed apps");
      }

      const now = new Date().toISOString();
      snapshot.policies.set(input.appId, {
        appId: input.appId,
        allowedAssets: input.allowedAssets,
        maxPerRequest: input.maxPerRequest,
        perUserDailyMax: input.perUserDailyMax,
        perAppDailyMax: input.perAppDailyMax,
        cooldownSeconds: input.cooldownSeconds,
        updatedBy: ctx.adminUserId ?? null,
        createdAt: snapshot.policies.get(input.appId)?.createdAt ?? now,
        updatedAt: now,
      });
      return snapshot.policies.get(input.appId);
    },
  };

  return { deps, snapshot };
}
