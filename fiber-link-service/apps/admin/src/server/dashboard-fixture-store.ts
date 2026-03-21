import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DbClient } from "@fiber-link/db";
import type { DashboardDataDependencies } from "./dashboard-data";
import {
  buildDashboardBackupRestorePlan,
  type DashboardBackupCaptureResult,
  type DashboardBackupRestorePlan,
} from "./dashboard-backups";
import {
  buildDashboardRateLimitChangeSet,
  parseDashboardRateLimitInput,
  type DashboardRateLimitChangeSet,
  type DashboardRateLimitDraft,
} from "./dashboard-rate-limit";
import type {
  DashboardApp,
  DashboardBackupBundle,
  DashboardMonitoringSummary,
  DashboardRateLimitConfig,
  DashboardWithdrawal,
  DashboardWithdrawalPolicy,
} from "../dashboard/dashboard-page-model";
import type { WithdrawalPolicyInput } from "../withdrawal-policy-input";
import type { TrpcContext } from "./api/trpc";

export type DashboardFixture = {
  apps: DashboardApp[];
  withdrawals: DashboardWithdrawal[];
  policies: DashboardWithdrawalPolicy[];
  communityAdminAppIds?: string[];
  monitoringSummary?: DashboardMonitoringSummary;
  rateLimitConfig?: DashboardRateLimitConfig;
  backupBundles?: DashboardBackupBundle[];
};

export type DashboardFixtureDeps = DashboardDataDependencies & {
  upsertPolicy: (input: {
    ctx: TrpcContext;
    input: WithdrawalPolicyInput;
  }) => Promise<DashboardWithdrawalPolicy>;
  createRateLimitChangeSet: (input: DashboardRateLimitDraft) => Promise<DashboardRateLimitChangeSet>;
  captureBackup: () => Promise<DashboardBackupCaptureResult>;
  buildBackupRestorePlan: (backupId: string) => Promise<DashboardBackupRestorePlan>;
};

type DashboardFixtureState = {
  deps: DashboardFixtureDeps;
  snapshot: {
    apps: DashboardApp[];
    withdrawals: DashboardWithdrawal[];
    policies: Map<string, DashboardWithdrawalPolicy>;
    monitoringSummary: DashboardMonitoringSummary;
    rateLimitConfig: DashboardRateLimitConfig;
    backupBundles: DashboardBackupBundle[];
    captureCount: number;
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

function buildDefaultMonitoringSummary(): DashboardMonitoringSummary {
  return {
    status: "ok",
    generatedAt: "2026-03-18T00:00:00.000Z",
    readinessStatus: "ready",
    unpaidBacklog: 0,
    retryPendingCount: 0,
    withdrawalParityIssueCount: 0,
    alertCount: 0,
    rawJson: JSON.stringify({ status: "ok" }, null, 2),
  };
}

function buildDefaultRateLimitConfig(): DashboardRateLimitConfig {
  return {
    enabled: true,
    windowMs: "60000",
    maxRequests: "300",
    redisUrl: "redis://redis:6379/1",
    sourceLabel: "fixture",
  };
}

export function createDashboardFixtureDependencies(fixture: DashboardFixture): DashboardFixtureState {
  const snapshot = {
    apps: fixture.apps.map((app) => ({ ...app })),
    withdrawals: fixture.withdrawals.map((withdrawal) => ({ ...withdrawal })),
    policies: new Map(fixture.policies.map((policy) => [policy.appId, { ...policy }])),
    monitoringSummary: fixture.monitoringSummary ? { ...fixture.monitoringSummary } : buildDefaultMonitoringSummary(),
    rateLimitConfig: fixture.rateLimitConfig ? { ...fixture.rateLimitConfig } : buildDefaultRateLimitConfig(),
    backupBundles: (fixture.backupBundles ?? []).map((bundle) => ({ ...bundle })),
    captureCount: 0,
  };
  const communityScope = createCommunityScope(fixture);
  const sharedDb = {} as DbClient;

  const deps: DashboardFixtureDeps = {
    createDb: () => sharedDb,
    listApps: async (ctx) => filterByScope(ctx, snapshot.apps, communityScope),
    listWithdrawals: async (ctx) => filterByScope(ctx, snapshot.withdrawals, communityScope),
    listPolicies: async (ctx) => filterByScope(ctx, Array.from(snapshot.policies.values()), communityScope),
    loadMonitoringSummary: async () => ({ ...snapshot.monitoringSummary }),
    loadRateLimitConfig: async () => ({ ...snapshot.rateLimitConfig }),
    listBackupBundles: async () => snapshot.backupBundles.map((bundle) => ({ ...bundle })),
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
    createRateLimitChangeSet: async (input) => {
      const parsed = parseDashboardRateLimitInput(input);
      return buildDashboardRateLimitChangeSet(snapshot.rateLimitConfig, parsed);
    },
    captureBackup: async () => {
      snapshot.captureCount += 1;
      const backupId = `fixture-backup-${String(snapshot.captureCount).padStart(3, "0")}`;
      const bundle: DashboardBackupBundle = {
        id: backupId,
        generatedAt: backupId,
        overallStatus: "PASS",
        retentionDays: 30,
        dryRun: true,
        backupDir: `/tmp/${backupId}`,
        archiveFile: `/tmp/${backupId}.tar.gz`,
      };
      snapshot.backupBundles.unshift(bundle);
      return {
        backupId: bundle.id,
        backupDir: bundle.backupDir,
        archiveFile: bundle.archiveFile,
      };
    },
    buildBackupRestorePlan: async (backupId) => {
      const bundle = snapshot.backupBundles.find((candidate) => candidate.id === backupId);
      if (!bundle) {
        throw new Error(`Unknown backup bundle: ${backupId}`);
      }
      return buildDashboardBackupRestorePlan(bundle);
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
