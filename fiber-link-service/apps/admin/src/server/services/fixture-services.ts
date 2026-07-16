import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type DashboardApp,
  type DashboardBackupBundle,
  type DashboardMonitoringSummary,
  type DashboardRateLimitConfig,
  type DashboardWithdrawal,
  type DashboardWithdrawalPolicy,
  summarizeWithdrawalStates,
} from "../../dashboard/dashboard-page-model";
import { buildDashboardBackupRestorePlan } from "../dashboard-backups";
import { buildDashboardRateLimitChangeSet, parseDashboardRateLimitInput } from "../dashboard-rate-limit";
import { PolicyScopeError, SettlementNotFoundError, SettlementRetryStateError, UnknownAppError } from "./errors";
import {
  type AdminAuditEventInput,
  type AdminScope,
  type AdminServices,
  type AdminSettlementEvent,
  type AdminSettlementIntent,
  type AdminWithdrawal,
  type AdminWithdrawalFilters,
  SETTLEMENT_LIST_LIMIT,
  WITHDRAWAL_LIST_LIMIT,
} from "./types";

/**
 * On-disk fixture shape pointed at by `ADMIN_DASHBOARD_FIXTURE_PATH`. Withdrawal
 * rows accept the optional recovery columns so fixtures can exercise the queue
 * and detail surfaces without standing up Postgres.
 */
/**
 * Settlement fixture rows only need the identity fields; everything else
 * defaults to a fresh UNPAID intent so tests stay terse.
 */
export type DashboardFixtureSettlement = Partial<AdminSettlementIntent> &
  Pick<AdminSettlementIntent, "invoice" | "appId"> & {
    events?: Array<Partial<AdminSettlementEvent> & Pick<AdminSettlementEvent, "type">>;
  };

export type DashboardFixture = {
  apps: DashboardApp[];
  withdrawals: Array<DashboardWithdrawal & Partial<AdminWithdrawal>>;
  policies: DashboardWithdrawalPolicy[];
  settlements?: DashboardFixtureSettlement[];
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

function toFixtureSettlement(row: DashboardFixtureSettlement): {
  intent: AdminSettlementIntent;
  events: AdminSettlementEvent[];
} {
  const createdAt = row.createdAt ?? "2026-03-18T00:00:00.000Z";
  return {
    intent: {
      id: row.id ?? row.invoice,
      invoice: row.invoice,
      appId: row.appId,
      postId: row.postId ?? "post-1",
      fromUserId: row.fromUserId ?? "tipper-1",
      toUserId: row.toUserId ?? "author-1",
      asset: row.asset ?? "CKB",
      amount: row.amount ?? "100",
      invoiceState: row.invoiceState ?? "UNPAID",
      settlementRetryCount: row.settlementRetryCount ?? 0,
      settlementNextRetryAt: row.settlementNextRetryAt ?? null,
      settlementLastError: row.settlementLastError ?? null,
      settlementFailureReason: row.settlementFailureReason ?? null,
      settlementLastCheckedAt: row.settlementLastCheckedAt ?? null,
      createdAt,
      settledAt: row.settledAt ?? null,
    },
    events: (row.events ?? []).map((event, index) => ({
      id: event.id ?? `${row.invoice}-event-${index + 1}`,
      source: event.source ?? "SETTLEMENT_DISCOVERY",
      type: event.type,
      previousInvoiceState: event.previousInvoiceState ?? null,
      nextInvoiceState: event.nextInvoiceState ?? null,
      metadata: event.metadata ?? null,
      createdAt: event.createdAt ?? createdAt,
    })),
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
  const auditEvents: Array<AdminAuditEventInput & { createdAt: string }> = [];

  const snapshot = {
    apps: fixture.apps.map((app) => ({ ...app })),
    withdrawals: fixture.withdrawals.map(toAdminWithdrawal),
    policies: new Map(fixture.policies.map((policy) => [policy.appId, { ...policy }])),
    settlements: (fixture.settlements ?? []).map(toFixtureSettlement),
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
    async appendAuditEvent(event) {
      auditEvents.push({ ...event, createdAt: new Date().toISOString() });
    },
    __listAuditEventsForTests() {
      return auditEvents.map((e) => ({ ...e }));
    },

    async listApps(scope) {
      return snapshot.apps
        .filter((app) => inScope(scope, app.appId))
        .map((app) => ({ ...app }))
        .sort((a, b) => a.appId.localeCompare(b.appId));
    },
    async listWithdrawals(scope, filters?: AdminWithdrawalFilters) {
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return snapshot.withdrawals
        .filter((row) => inScope(scope, row.appId))
        .filter((row) => (filters?.appId ? row.appId === filters.appId : true))
        .filter((row) => (filters?.state ? row.state === filters.state : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, WITHDRAWAL_LIST_LIMIT)
        .map((row) => ({ ...row, userId: redactPii ? "" : row.userId, toAddress: redactPii ? null : row.toAddress }));
    },
    async summarizeWithdrawals(scope) {
      return summarizeWithdrawalStates(snapshot.withdrawals.filter((row) => inScope(scope, row.appId)));
    },
    async listPolicies(scope) {
      return Array.from(snapshot.policies.values())
        .filter((policy) => inScope(scope, policy.appId))
        .map((policy) => ({ ...policy }))
        .sort((a, b) => a.appId.localeCompare(b.appId));
    },
    async upsertPolicy(scope, input) {
      if (scope.role === "COMMUNITY_ADMIN" && !communityScope.has(input.appId)) {
        throw new PolicyScopeError();
      }
      if (!snapshot.apps.some((app) => app.appId === input.appId)) {
        throw new UnknownAppError(input.appId);
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
    async listSettlements(scope, filters) {
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return snapshot.settlements
        .filter((row) => inScope(scope, row.intent.appId))
        .filter((row) => (filters?.appId ? row.intent.appId === filters.appId : true))
        .filter((row) => (filters?.state ? row.intent.invoiceState === filters.state : true))
        .sort((a, b) => b.intent.createdAt.localeCompare(a.intent.createdAt))
        .slice(0, SETTLEMENT_LIST_LIMIT)
        .map((row) => ({
          ...row.intent,
          fromUserId: redactPii ? "" : row.intent.fromUserId,
          toUserId: redactPii ? "" : row.intent.toUserId,
        }));
    },
    async getSettlementTimeline(scope, invoice) {
      const row = snapshot.settlements.find((candidate) => candidate.intent.invoice === invoice);
      if (!row || !inScope(scope, row.intent.appId)) {
        throw new SettlementNotFoundError(invoice);
      }
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return {
        intent: {
          ...row.intent,
          fromUserId: redactPii ? "" : row.intent.fromUserId,
          toUserId: redactPii ? "" : row.intent.toUserId,
        },
        events: row.events.map((event) => ({ ...event })),
        adminActions: auditEvents
          .filter((event) => event.targetType === "tip_intent" && event.targetId === invoice)
          .map((event) => ({
            action: event.action,
            actorId: event.actorId,
            actorRole: event.actorRole,
            reason: event.reason ?? null,
            createdAt: event.createdAt,
          }))
          .reverse(),
      };
    },
    async retrySettlementNow(scope, invoice) {
      const row = snapshot.settlements.find((candidate) => candidate.intent.invoice === invoice);
      if (!row || !inScope(scope, row.intent.appId)) {
        throw new SettlementNotFoundError(invoice);
      }
      if (row.intent.invoiceState !== "UNPAID") {
        throw new SettlementRetryStateError(row.intent.invoiceState);
      }
      row.intent.settlementRetryCount = 0;
      row.intent.settlementNextRetryAt = null;
      row.intent.settlementLastError = null;
      row.intent.settlementFailureReason = null;
      row.intent.settlementLastCheckedAt = new Date().toISOString();
      return { ...row.intent };
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
