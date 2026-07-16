import {
  type DbClient,
  TipIntentNotFoundError,
  type TipIntentRecord,
  type WithdrawalState,
  createDbAdminAuditRepo,
  createDbClient,
  createDbTipIntentEventRepo,
  createDbTipIntentRepo,
  withdrawalPolicies,
  withdrawals,
} from "@fiber-link/db";
import { inArray, sql } from "drizzle-orm";
import {
  type DashboardApp,
  type DashboardBackupBundle,
  type DashboardMonitoringSummary,
  type DashboardRateLimitConfig,
  type DashboardStatusSummary,
  type DashboardWithdrawalPolicy,
  WITHDRAWAL_STATE_ORDER,
} from "../../dashboard/dashboard-page-model";
import type { WithdrawalPolicyInput } from "../../withdrawal-policy-input";
import {
  type DashboardBackupCaptureResult,
  type DashboardBackupRestorePlan,
  buildDashboardBackupRestorePlan,
  captureDashboardBackup,
  listDashboardBackupBundles,
} from "../dashboard-backups";
import { loadDashboardMonitoringSummary } from "../dashboard-monitoring";
import {
  type DashboardRateLimitChangeSet,
  type DashboardRateLimitDraft,
  buildDashboardRateLimitChangeSet,
  loadDashboardRateLimitConfig,
  parseDashboardRateLimitInput,
} from "../dashboard-rate-limit";
import { PolicyScopeError, SettlementNotFoundError, SettlementRetryStateError, UnknownAppError } from "./errors";
import {
  type AdminScope,
  type AdminServices,
  type AdminSettlementIntent,
  type AdminSettlementTimeline,
  type AdminWithdrawal,
  type AdminWithdrawalFilters,
  SETTLEMENT_LIST_LIMIT,
  WITHDRAWAL_LIST_LIMIT,
} from "./types";

const APP_COLUMNS = { appId: true, createdAt: true } as const;

const WITHDRAWAL_COLUMNS = {
  id: true,
  appId: true,
  userId: true,
  asset: true,
  amount: true,
  toAddress: true,
  state: true,
  retryCount: true,
  nextRetryAt: true,
  lastError: true,
  txHash: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} as const;

const POLICY_COLUMNS = {
  appId: true,
  allowedAssets: true,
  maxPerRequest: true,
  perUserDailyMax: true,
  perAppDailyMax: true,
  cooldownSeconds: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toSettlementIntent(record: TipIntentRecord): AdminSettlementIntent {
  return {
    id: record.id,
    invoice: record.invoice,
    appId: record.appId,
    postId: record.postId,
    fromUserId: record.fromUserId,
    toUserId: record.toUserId,
    asset: record.asset,
    amount: record.amount,
    invoiceState: record.invoiceState,
    settlementRetryCount: record.settlementRetryCount,
    settlementNextRetryAt: isoOrNull(record.settlementNextRetryAt),
    settlementLastError: record.settlementLastError ?? null,
    settlementFailureReason: record.settlementFailureReason ?? null,
    settlementLastCheckedAt: isoOrNull(record.settlementLastCheckedAt),
    createdAt: record.createdAt.toISOString(),
    settledAt: isoOrNull(record.settledAt),
  };
}

/**
 * Resolve the set of app ids the scope may read. Returns `"ALL"` for
 * SUPER_ADMIN, the assigned app ids for COMMUNITY_ADMIN, or an empty array
 * when a community admin has no memberships.
 */
async function resolveScopedAppIds(db: DbClient, scope: AdminScope): Promise<"ALL" | string[]> {
  if (scope.role === "SUPER_ADMIN") {
    return "ALL";
  }

  const adminUserId = scope.adminUserId;
  if (!adminUserId) {
    throw new Error("Admin identity not configured");
  }

  const memberships = await db.query.appAdmins.findMany({
    columns: { appId: true },
    where: (a, { eq }) => eq(a.adminUserId, adminUserId),
  });
  return memberships.map((m) => m.appId);
}

export function createDbAdminServices(db: DbClient = createDbClient()): AdminServices {
  const auditRepo = createDbAdminAuditRepo(db);
  const tipIntentRepo = createDbTipIntentRepo(db);
  const tipIntentEventRepo = createDbTipIntentEventRepo(db);

  /** Resolve an in-scope tip intent or collapse to "not found" (no probing). */
  async function findScopedTipIntent(scope: AdminScope, invoice: string): Promise<TipIntentRecord> {
    const scoped = await resolveScopedAppIds(db, scope);
    let record: TipIntentRecord;
    try {
      record = await tipIntentRepo.findByInvoiceOrThrow(invoice);
    } catch (error) {
      if (error instanceof TipIntentNotFoundError) {
        throw new SettlementNotFoundError(invoice);
      }
      throw error;
    }
    if (scoped !== "ALL" && !scoped.includes(record.appId)) {
      throw new SettlementNotFoundError(invoice);
    }
    return record;
  }

  return {
    async appendAuditEvent(event) {
      try {
        await auditRepo.append(event);
      } catch (error) {
        console.error("[admin] failed to append audit event", { action: event.action, error });
      }
    },

    async listApps(scope): Promise<DashboardApp[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.apps.findMany({
        columns: APP_COLUMNS,
        orderBy: (a, { asc }) => [asc(a.appId)],
        ...(scoped === "ALL" ? {} : { where: (a, { inArray }) => inArray(a.appId, scoped) }),
      });
      return rows.map((row) => ({ appId: row.appId, createdAt: row.createdAt.toISOString() }));
    },

    async listWithdrawals(scope, filters?: AdminWithdrawalFilters): Promise<AdminWithdrawal[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.withdrawals.findMany({
        columns: WITHDRAWAL_COLUMNS,
        orderBy: (w, { desc }) => [desc(w.createdAt)],
        limit: WITHDRAWAL_LIST_LIMIT,
        where: (w, { and, eq, inArray }) => {
          const clauses = [];
          if (scoped !== "ALL") {
            clauses.push(inArray(w.appId, scoped));
          }
          if (filters?.appId) {
            clauses.push(eq(w.appId, filters.appId));
          }
          if (filters?.state) {
            clauses.push(eq(w.state, filters.state));
          }
          return clauses.length > 0 ? and(...clauses) : undefined;
        },
      });

      // COMMUNITY_ADMIN must not see end-user PII (user id or payout
      // destination); redact server-side so the restriction is enforced before
      // the data leaves the procedure, independent of which columns the UI shows.
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return rows.map((row) => ({
        id: row.id,
        appId: row.appId,
        userId: redactPii ? "" : row.userId,
        asset: row.asset,
        amount: row.amount,
        toAddress: redactPii ? null : (row.toAddress ?? null),
        state: row.state,
        retryCount: row.retryCount ?? 0,
        nextRetryAt: isoOrNull(row.nextRetryAt),
        lastError: row.lastError ?? null,
        txHash: row.txHash ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        completedAt: isoOrNull(row.completedAt),
      }));
    },

    async summarizeWithdrawals(scope): Promise<DashboardStatusSummary[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      const counts = new Map<WithdrawalState, number>();

      if (scoped === "ALL" || scoped.length > 0) {
        // Aggregate in SQL so the Overview cards do not pull the whole table.
        const grouped = (await db
          .select({ state: withdrawals.state, count: sql<number>`count(*)::int` })
          .from(withdrawals)
          .where(scoped === "ALL" ? undefined : inArray(withdrawals.appId, scoped))
          .groupBy(withdrawals.state)) as Array<{ state: WithdrawalState; count: number }>;
        for (const row of grouped) {
          counts.set(row.state, row.count);
        }
      }

      return WITHDRAWAL_STATE_ORDER.map((state) => ({ state, count: counts.get(state) ?? 0 }));
    },

    async listPolicies(scope): Promise<DashboardWithdrawalPolicy[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.withdrawalPolicies.findMany({
        columns: POLICY_COLUMNS,
        orderBy: (p, { asc }) => [asc(p.appId)],
        ...(scoped === "ALL" ? {} : { where: (p, { inArray: inArr }) => inArr(p.appId, scoped) }),
      });
      return rows.map((row) => ({
        appId: row.appId,
        allowedAssets: row.allowedAssets,
        maxPerRequest: row.maxPerRequest,
        perUserDailyMax: row.perUserDailyMax,
        perAppDailyMax: row.perAppDailyMax,
        cooldownSeconds: row.cooldownSeconds,
        updatedBy: row.updatedBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },

    async upsertPolicy(scope, input: WithdrawalPolicyInput): Promise<DashboardWithdrawalPolicy> {
      if (scope.role === "COMMUNITY_ADMIN") {
        const scoped = await resolveScopedAppIds(db, scope);
        if (scoped === "ALL" || !scoped.includes(input.appId)) {
          throw new PolicyScopeError();
        }
      }

      // withdrawal_policies is keyed by text with no FK to apps, so reject
      // unknown app ids instead of persisting a durable orphan policy (e.g.
      // from a typo'd /apps/<id> URL).
      const appRows = await db.query.apps.findMany({
        columns: { appId: true },
        where: (a, { eq }) => eq(a.appId, input.appId),
      });
      if (appRows.length === 0) {
        throw new UnknownAppError(input.appId);
      }

      const now = new Date();
      const updatedBy = scope.adminUserId ?? null;
      const set = {
        allowedAssets: input.allowedAssets,
        maxPerRequest: input.maxPerRequest,
        perUserDailyMax: input.perUserDailyMax,
        perAppDailyMax: input.perAppDailyMax,
        cooldownSeconds: input.cooldownSeconds,
        updatedBy,
        updatedAt: now,
      };

      const rows = await db
        .insert(withdrawalPolicies)
        .values({ appId: input.appId, createdAt: now, ...set })
        .onConflictDoUpdate({ target: withdrawalPolicies.appId, set })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("failed to persist withdrawal policy");
      }
      return {
        appId: row.appId,
        allowedAssets: row.allowedAssets,
        maxPerRequest: row.maxPerRequest,
        perUserDailyMax: row.perUserDailyMax,
        perAppDailyMax: row.perAppDailyMax,
        cooldownSeconds: row.cooldownSeconds,
        updatedBy: row.updatedBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async listSettlements(scope, filters): Promise<AdminSettlementIntent[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.tipIntents.findMany({
        orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
        limit: SETTLEMENT_LIST_LIMIT,
        where: (t, { and, eq, inArray }) => {
          const clauses = [];
          if (scoped !== "ALL") {
            clauses.push(inArray(t.appId, scoped));
          }
          if (filters?.appId) {
            clauses.push(eq(t.appId, filters.appId));
          }
          if (filters?.state) {
            clauses.push(eq(t.invoiceState, filters.state));
          }
          return clauses.length > 0 ? and(...clauses) : undefined;
        },
      });

      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return rows.map((row) => ({
        id: row.id,
        invoice: row.invoice,
        appId: row.appId,
        postId: row.postId,
        fromUserId: redactPii ? "" : row.fromUserId,
        toUserId: redactPii ? "" : row.toUserId,
        asset: row.asset,
        amount: typeof row.amount === "string" ? row.amount : String(row.amount),
        invoiceState: row.invoiceState,
        settlementRetryCount: row.settlementRetryCount ?? 0,
        settlementNextRetryAt: isoOrNull(row.settlementNextRetryAt),
        settlementLastError: row.settlementLastError ?? null,
        settlementFailureReason: row.settlementFailureReason ?? null,
        settlementLastCheckedAt: isoOrNull(row.settlementLastCheckedAt),
        createdAt: row.createdAt.toISOString(),
        settledAt: isoOrNull(row.settledAt),
      }));
    },

    async getSettlementTimeline(scope, invoice): Promise<AdminSettlementTimeline> {
      const record = await findScopedTipIntent(scope, invoice);
      const [events, auditEvents] = await Promise.all([
        tipIntentEventRepo.listByInvoice(invoice),
        auditRepo.listRecentByTarget("tip_intent", invoice),
      ]);

      const intent = toSettlementIntent(record);
      if (scope.role === "COMMUNITY_ADMIN") {
        intent.fromUserId = "";
        intent.toUserId = "";
      }

      return {
        intent,
        events: events.map((event) => ({
          id: event.id,
          source: event.source,
          type: event.type,
          previousInvoiceState: event.previousInvoiceState,
          nextInvoiceState: event.nextInvoiceState,
          metadata: event.metadata,
          createdAt: event.createdAt.toISOString(),
        })),
        adminActions: auditEvents.map((event) => ({
          action: event.action,
          actorId: event.actorId,
          actorRole: event.actorRole,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        })),
      };
    },

    async retrySettlementNow(scope, invoice): Promise<AdminSettlementIntent> {
      const record = await findScopedTipIntent(scope, invoice);
      // SETTLED and FAILED are terminal; the worker only re-polls UNPAID
      // intents, so clearing retry state on anything else would be a silent
      // no-op that misleads the operator.
      if (record.invoiceState !== "UNPAID") {
        throw new SettlementRetryStateError(record.invoiceState);
      }
      const updated = await tipIntentRepo.clearSettlementFailure(invoice, { now: new Date() });
      return toSettlementIntent(updated);
    },

    async loadMonitoringSummary(): Promise<DashboardMonitoringSummary> {
      return loadDashboardMonitoringSummary();
    },

    async loadRateLimitConfig(): Promise<DashboardRateLimitConfig> {
      return loadDashboardRateLimitConfig();
    },

    async createRateLimitChangeSet(input): Promise<DashboardRateLimitChangeSet> {
      const parsed = parseDashboardRateLimitInput(input as DashboardRateLimitDraft);
      const current = loadDashboardRateLimitConfig();
      return buildDashboardRateLimitChangeSet(current, parsed);
    },

    async listBackupBundles(): Promise<DashboardBackupBundle[]> {
      return listDashboardBackupBundles();
    },

    async captureBackup(): Promise<DashboardBackupCaptureResult> {
      return captureDashboardBackup();
    },

    async buildBackupRestorePlan(backupId): Promise<DashboardBackupRestorePlan> {
      const bundles = listDashboardBackupBundles();
      const bundle = bundles.find((candidate) => candidate.id === backupId);
      if (!bundle) {
        throw new Error(`Unknown backup bundle: ${backupId}`);
      }
      return buildDashboardBackupRestorePlan(bundle);
    },
  };
}
