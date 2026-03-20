import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DbClient } from "@fiber-link/db";
import type { DashboardDataDependencies } from "./dashboard-data";
import type { DashboardApp, DashboardWithdrawal, DashboardWithdrawalPolicy } from "../dashboard/dashboard-page-model";
import type { WithdrawalPolicyInput } from "../withdrawal-policy-input";
import type { TrpcContext } from "./api/trpc";

export type DashboardFixture = {
  apps: DashboardApp[];
  withdrawals: DashboardWithdrawal[];
  policies: DashboardWithdrawalPolicy[];
  communityAdminAppIds?: string[];
};

type DashboardFixtureDeps = DashboardDataDependencies & {
  upsertPolicy: (input: {
    ctx: TrpcContext;
    input: WithdrawalPolicyInput;
  }) => Promise<DashboardWithdrawalPolicy>;
};

type DashboardFixtureState = {
  deps: DashboardFixtureDeps;
  snapshot: {
    apps: DashboardApp[];
    withdrawals: DashboardWithdrawal[];
    policies: Map<string, DashboardWithdrawalPolicy>;
  };
};

const FIXTURE_CACHE = new Map<string, DashboardFixtureState>();

function createCommunityScope(fixture: DashboardFixture): Set<string> {
  return new Set(fixture.communityAdminAppIds ?? fixture.apps.slice(0, 1).map((app) => app.appId));
}

function filterByScope<T extends { appId: string }>(ctx: TrpcContext, rows: T[], communityScope: Set<string>): T[] {
  if (ctx.role === "COMMUNITY_ADMIN") {
    return rows.filter((row) => communityScope.has(row.appId));
  }

  return rows;
}

export function createDashboardFixtureDependencies(fixture: DashboardFixture): DashboardFixtureState {
  const snapshot = {
    apps: fixture.apps.map((app) => ({ ...app })),
    withdrawals: fixture.withdrawals.map((withdrawal) => ({ ...withdrawal })),
    policies: new Map(fixture.policies.map((policy) => [policy.appId, { ...policy }])),
  };
  const communityScope = createCommunityScope(fixture);
  const sharedDb = {} as DbClient;

  const deps: DashboardFixtureDeps = {
    createDb: () => sharedDb,
    listApps: async (ctx) => filterByScope(ctx, snapshot.apps, communityScope),
    listWithdrawals: async (ctx) => filterByScope(ctx, snapshot.withdrawals, communityScope),
    listPolicies: async (ctx) => filterByScope(ctx, Array.from(snapshot.policies.values()), communityScope),
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

      return snapshot.policies.get(input.appId)!;
    },
  };

  return { deps, snapshot };
}

export function getDashboardFixtureDependencies(env: NodeJS.ProcessEnv = process.env): DashboardFixtureDeps | undefined {
  const fixturePath = env.ADMIN_DASHBOARD_FIXTURE_PATH?.trim();
  if (!fixturePath) {
    return undefined;
  }

  const resolvedPath = resolve(process.cwd(), fixturePath);
  const cached = FIXTURE_CACHE.get(resolvedPath);
  if (cached) {
    return cached.deps;
  }

  const fixture = JSON.parse(readFileSync(resolvedPath, "utf8")) as DashboardFixture;
  const state = createDashboardFixtureDependencies(fixture);
  FIXTURE_CACHE.set(resolvedPath, state);
  return state.deps;
}
