import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DashboardApp,
  DashboardBackupBundle,
  DashboardMonitoringSummary,
  DashboardRateLimitConfig,
  DashboardWithdrawal,
  DashboardWithdrawalPolicy,
} from "../../dashboard/dashboard-page-model";
import {
  buildDashboardRateLimitChangeSet,
  parseDashboardRateLimitInput,
} from "../dashboard-rate-limit";
import { buildDashboardBackupRestorePlan } from "../dashboard-backups";
import type { AdminScope, AdminServices, AdminWithdrawal, AdminWithdrawalFilters } from "./types";

/**
 * On-disk fixture shape pointed at by `ADMIN_DASHBOARD_FIXTURE_PATH`. Withdrawal
 * rows accept the optional recovery columns so fixtures can exercise the queue
 * and detail surfaces without standing up Postgres.
 */
export type DashboardFixture = {
  apps: DashboardApp[];
  withdrawals: Array<DashboardWithdrawal & Partial<AdminWithdrawal>>;
  policies: DashboardWithdrawalPolicy[];
  communityAdminAppIds?: string[];
  monitoringSummary?: DashboardMonitoringSummary;
  rateLimitConfig?: DashboardRateLimitConfig;
  backupBundles?: DashboardBackupBundle[];
};

const FIXTURE_CACHE = new Map<string, AdminServices>();

function toAdminWithdrawal(row: DashboardWithdrawal & Partial<AdminWithdrawal>): AdminWithdrawal {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset,
    amount: row.amount,
    toAddress: row.toAddress ?? null,
    state: row.state,
    retryCount: row.retryCount ?? 0,
    nextRetryAt: row.nextRetryAt ?? null,
    lastError: row.lastError ?? null,
    txHash: row.txHash ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
    completedAt: row.completedAt ?? null,
  };
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

export function createFixtureAdminServices(fixture: DashboardFixture): AdminServices {
  const snapshot = {
    apps: fixture.apps.map((app) => ({ ...app })),
    withdrawals: fixture.withdrawals.map(toAdminWithdrawal),
    policies: new Map(fixture.policies.map((policy) => [policy.appId, { ...policy }])),
    monitoringSummary: fixture.monitoringSummary ? { ...fixture.monitoringSummary } : buildDefaultMonitoringSummary(),
    rateLimitConfig: fixture.rateLimitConfig ? { ...fixture.rateLimitConfig } : buildDefaultRateLimitConfig(),
    backupBundles: (fixture.backupBundles ?? []).map((bundle) => ({ ...bundle })),
    captureCount: 0,
  };
  const communityScope = new Set(fixture.communityAdminAppIds ?? fixture.apps.slice(0, 1).map((app) => app.appId));

  function inScope(scope: AdminScope, appId: string): boolean {
    return scope.role !== "COMMUNITY_ADMIN" || communityScope.has(appId);
  }

  return {
    async listApps(scope) {
      return snapshot.apps.filter((app) => inScope(scope, app.appId)).map((app) => ({ ...app }));
    },
    async listWithdrawals(scope, filters?: AdminWithdrawalFilters) {
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return snapshot.withdrawals
        .filter((row) => inScope(scope, row.appId))
        .filter((row) => (filters?.appId ? row.appId === filters.appId : true))
        .filter((row) => (filters?.state ? row.state === filters.state : true))
        .map((row) => ({ ...row, userId: redactPii ? "" : row.userId, toAddress: redactPii ? null : row.toAddress }));
    },
    async listPolicies(scope) {
      return Array.from(snapshot.policies.values())
        .filter((policy) => inScope(scope, policy.appId))
        .map((policy) => ({ ...policy }));
    },
    async upsertPolicy(scope, input) {
      if (scope.role === "COMMUNITY_ADMIN" && !communityScope.has(input.appId)) {
        throw new Error("COMMUNITY_ADMIN can only update policies for managed apps");
      }
      if (!snapshot.apps.some((app) => app.appId === input.appId)) {
        throw new Error(`unknown app: ${input.appId}`);
      }
      const now = new Date().toISOString();
      const existing = snapshot.policies.get(input.appId);
      const next: DashboardWithdrawalPolicy = {
        appId: input.appId,
        allowedAssets: input.allowedAssets,
        maxPerRequest: input.maxPerRequest,
        perUserDailyMax: input.perUserDailyMax,
        perAppDailyMax: input.perAppDailyMax,
        cooldownSeconds: input.cooldownSeconds,
        updatedBy: scope.adminUserId ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      snapshot.policies.set(input.appId, next);
      return { ...next };
    },
    async loadMonitoringSummary() {
      return { ...snapshot.monitoringSummary };
    },
    async loadRateLimitConfig() {
      return { ...snapshot.rateLimitConfig };
    },
    async createRateLimitChangeSet(input) {
      const parsed = parseDashboardRateLimitInput(input);
      return buildDashboardRateLimitChangeSet(snapshot.rateLimitConfig, parsed);
    },
    async listBackupBundles() {
      return snapshot.backupBundles.map((bundle) => ({ ...bundle }));
    },
    async captureBackup() {
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
      return { backupId: bundle.id, backupDir: bundle.backupDir, archiveFile: bundle.archiveFile };
    },
    async buildBackupRestorePlan(backupId) {
      const bundle = snapshot.backupBundles.find((candidate) => candidate.id === backupId);
      if (!bundle) {
        throw new Error(`Unknown backup bundle: ${backupId}`);
      }
      return buildDashboardBackupRestorePlan(bundle);
    },
  };
}

export function loadFixtureAdminServices(env: NodeJS.ProcessEnv = process.env): AdminServices | undefined {
  const fixturePath = env.ADMIN_DASHBOARD_FIXTURE_PATH?.trim();
  if (!fixturePath) {
    return undefined;
  }

  const resolvedPath = resolve(process.cwd(), fixturePath);
  const cached = FIXTURE_CACHE.get(resolvedPath);
  if (cached) {
    return cached;
  }

  const fixture = JSON.parse(readFileSync(resolvedPath, "utf8")) as DashboardFixture;
  const services = createFixtureAdminServices(fixture);
  FIXTURE_CACHE.set(resolvedPath, services);
  return services;
}
