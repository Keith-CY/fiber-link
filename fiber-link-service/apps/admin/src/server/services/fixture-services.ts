import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcileLedger } from "@fiber-link/db";
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
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  type AdminAuditEventInput,
  type AdminLedgerEntry,
  type AdminScope,
  type AdminServices,
  type AdminSettlementEvent,
  type AdminSettlementIntent,
  type AdminWithdrawal,
  type AdminWithdrawalFilters,
  LEDGER_PAGE_DEFAULT_LIMIT,
  LEDGER_PAGE_MAX_LIMIT,
  encodeLedgerCursor,
} from "./types";

function clampListLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? ADMIN_LIST_DEFAULT_LIMIT, 1), ADMIN_LIST_MAX_LIMIT);
}

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

/** Ledger fixture rows only need the accounting identity; timestamps default. */
export type DashboardFixtureLedgerEntry = Partial<AdminLedgerEntry> &
  Pick<AdminLedgerEntry, "id" | "appId" | "userId" | "amount" | "type" | "refId">;

export type DashboardFixture = {
  apps: DashboardApp[];
  withdrawals: Array<DashboardWithdrawal & Partial<AdminWithdrawal>>;
  policies: DashboardWithdrawalPolicy[];
  settlements?: DashboardFixtureSettlement[];
  ledgerEntries?: DashboardFixtureLedgerEntry[];
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

function toFixtureLedgerEntry(row: DashboardFixtureLedgerEntry): AdminLedgerEntry {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset ?? "CKB",
    amount: row.amount,
    type: row.type,
    refId: row.refId,
    idempotencyKey: row.idempotencyKey ?? `fixture:${row.type}:${row.refId}`,
    createdAt: row.createdAt ?? "2026-03-18T00:00:00.000Z",
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
    ledgerEntries: (fixture.ledgerEntries ?? []).map(toFixtureLedgerEntry),
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
      const limit = clampListLimit(filters?.limit);
      let items = snapshot.withdrawals
        .filter((row) => inScope(scope, row.appId))
        .filter((row) => (filters?.appId ? row.appId === filters.appId : true))
        .filter((row) => (filters?.state ? row.state === filters.state : true))
        .filter((row) => (filters?.userId ? row.userId === filters.userId : true))
        .filter((row) => (filters?.asset ? row.asset === filters.asset : true))
        .filter((row) => (filters?.id ? row.id === filters.id : true))
        .filter((row) => (filters?.txHash ? row.txHash === filters.txHash : true))
        .filter((row) => (filters?.createdFrom ? row.createdAt >= filters.createdFrom : true))
        .filter((row) => (filters?.createdTo ? row.createdAt <= filters.createdTo : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const after = filters?.after;
      if (after) {
        items = items.filter(
          (row) => row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id),
        );
      }
      const page = items.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          ...row,
          userId: redactPii ? "" : row.userId,
          toAddress: redactPii ? null : row.toAddress,
        })),
        nextCursor:
          items.length > limit && last ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
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
      const limit = clampListLimit(filters?.limit);
      let items = snapshot.settlements
        .filter((row) => inScope(scope, row.intent.appId))
        .filter((row) => (filters?.appId ? row.intent.appId === filters.appId : true))
        .filter((row) => (filters?.state ? row.intent.invoiceState === filters.state : true))
        .filter((row) => (filters?.invoice ? row.intent.invoice === filters.invoice : true))
        .filter((row) => (filters?.asset ? row.intent.asset === filters.asset : true))
        .filter((row) =>
          filters?.userId ? row.intent.fromUserId === filters.userId || row.intent.toUserId === filters.userId : true,
        )
        .filter((row) => (filters?.createdFrom ? row.intent.createdAt >= filters.createdFrom : true))
        .filter((row) => (filters?.createdTo ? row.intent.createdAt <= filters.createdTo : true))
        .sort((a, b) => b.intent.createdAt.localeCompare(a.intent.createdAt) || b.intent.id.localeCompare(a.intent.id));
      const after = filters?.after;
      if (after) {
        items = items.filter(
          (row) =>
            row.intent.createdAt < after.createdAt ||
            (row.intent.createdAt === after.createdAt && row.intent.id < after.id),
        );
      }
      const page = items.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          ...row.intent,
          fromUserId: redactPii ? "" : row.intent.fromUserId,
          toUserId: redactPii ? "" : row.intent.toUserId,
        })),
        nextCursor:
          items.length > limit && last
            ? encodeLedgerCursor({ createdAt: last.intent.createdAt, id: last.intent.id })
            : null,
      };
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
    async listLedgerEntries(scope, filters) {
      if (!inScope(scope, filters.appId)) {
        return { entries: [], nextCursor: null };
      }
      const limit = Math.min(Math.max(filters.limit ?? LEDGER_PAGE_DEFAULT_LIMIT, 1), LEDGER_PAGE_MAX_LIMIT);
      let items = snapshot.ledgerEntries.filter((row) => row.appId === filters.appId);
      if (filters.userId) {
        items = items.filter((row) => row.userId === filters.userId);
      }
      if (filters.asset) {
        items = items.filter((row) => row.asset === filters.asset);
      }
      if (filters.type) {
        items = items.filter((row) => row.type === filters.type);
      }
      items = items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const after = filters.after;
      if (after) {
        items = items.filter(
          (row) => row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id),
        );
      }
      const page = items.slice(0, limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((row) => ({ ...row })),
        nextCursor:
          items.length > limit && last ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
    async getLedgerBalanceBreakdown(scope, params) {
      const relevant = inScope(scope, params.appId)
        ? snapshot.ledgerEntries.filter(
            (row) => row.appId === params.appId && row.userId === params.userId && row.asset === params.asset,
          )
        : [];
      const credits = relevant.filter((row) => row.type === "credit");
      const debits = relevant.filter((row) => row.type === "debit");
      const total = (rows: AdminLedgerEntry[]) => rows.reduce((acc, row) => acc + Number(row.amount), 0);
      const timestamps = relevant.map((row) => row.createdAt).sort();
      return {
        appId: params.appId,
        userId: params.userId,
        asset: params.asset,
        balance: String(total(credits) - total(debits)),
        creditTotal: String(total(credits)),
        debitTotal: String(total(debits)),
        creditCount: credits.length,
        debitCount: debits.length,
        firstEntryAt: timestamps[0] ?? null,
        lastEntryAt: timestamps[timestamps.length - 1] ?? null,
      };
    },
    async reconcileLedger(scope, params) {
      const now = new Date();
      const window = {
        from: params.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: params.to ?? now.toISOString(),
      };
      const appMatches = (appId: string) => inScope(scope, appId) && (params.appId ? appId === params.appId : true);
      const report = reconcileLedger({
        tipIntents: snapshot.settlements
          .filter((row) => appMatches(row.intent.appId))
          .map((row) => ({
            id: row.intent.id,
            appId: row.intent.appId,
            toUserId: row.intent.toUserId,
            asset: row.intent.asset,
            amount: row.intent.amount,
            invoiceState: row.intent.invoiceState,
          })),
        withdrawals: snapshot.withdrawals
          .filter((row) => appMatches(row.appId))
          .map((row) => ({
            id: row.id,
            appId: row.appId,
            userId: row.userId,
            asset: row.asset,
            amount: row.amount,
            state: row.state,
          })),
        entries: snapshot.ledgerEntries
          .filter((row) => appMatches(row.appId))
          .map((row) => ({
            id: row.id,
            appId: row.appId,
            userId: row.userId,
            asset: row.asset,
            amount: row.amount,
            type: row.type,
            refId: row.refId,
          })),
      });
      return { ...report, window, truncated: false };
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
