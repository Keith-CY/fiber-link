import {
  type DbClient,
  type LedgerReconciliationEntry,
  type LedgerReconciliationTipIntent,
  type LedgerReconciliationWithdrawal,
  TipIntentNotFoundError,
  type TipIntentRecord,
  type WithdrawalState,
  createDbAdminAuditRepo,
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentEventRepo,
  createDbTipIntentRepo,
  ledgerEntries,
  reconcileLedger,
  tipIntents,
  withdrawalPolicies,
  withdrawals,
} from "@fiber-link/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
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
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  type AdminLedgerBalanceBreakdown,
  type AdminLedgerCursor,
  type AdminLedgerFilters,
  type AdminLedgerPage,
  type AdminLedgerReconcileParams,
  type AdminLedgerReconciliationResult,
  type AdminScope,
  type AdminServices,
  type AdminSettlementFilters,
  type AdminSettlementIntent,
  type AdminSettlementPage,
  type AdminSettlementTimeline,
  type AdminWithdrawalFilters,
  type AdminWithdrawalPage,
  LEDGER_PAGE_DEFAULT_LIMIT,
  LEDGER_PAGE_MAX_LIMIT,
  encodeLedgerCursor,
} from "./types";

function clampListLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? ADMIN_LIST_DEFAULT_LIMIT, 1), ADMIN_LIST_MAX_LIMIT);
}

/** Keyset "strictly older than" predicate over (createdAt, id), newest-first. */
function keysetAfter(after: AdminLedgerCursor | undefined) {
  return after ? { createdAt: new Date(after.createdAt), id: after.id } : undefined;
}

/** Per-source row cap for one reconciliation pass; the report flags truncation. */
const RECONCILE_MAX_ROWS = 2000;
/** Default reconciliation window when `from` is omitted. */
const RECONCILE_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
  const ledgerRepo = createDbLedgerRepo(db);

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

    async listWithdrawals(scope, filters?: AdminWithdrawalFilters): Promise<AdminWithdrawalPage> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return { items: [], nextCursor: null };
      }

      const limit = clampListLimit(filters?.limit);
      const after = keysetAfter(filters?.after);
      const rows = await db.query.withdrawals.findMany({
        columns: WITHDRAWAL_COLUMNS,
        orderBy: (w, { desc }) => [desc(w.createdAt), desc(w.id)],
        // One extra row purely to detect whether a next page exists.
        limit: limit + 1,
        where: (w, { and, or, eq, gte, lte, lt, inArray }) => {
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
          if (filters?.userId) {
            clauses.push(eq(w.userId, filters.userId));
          }
          if (filters?.asset) {
            clauses.push(eq(w.asset, filters.asset));
          }
          if (filters?.id) {
            clauses.push(eq(w.id, filters.id));
          }
          if (filters?.txHash) {
            clauses.push(eq(w.txHash, filters.txHash));
          }
          if (filters?.createdFrom) {
            clauses.push(gte(w.createdAt, new Date(filters.createdFrom)));
          }
          if (filters?.createdTo) {
            clauses.push(lte(w.createdAt, new Date(filters.createdTo)));
          }
          if (after) {
            const keyset = or(
              lt(w.createdAt, after.createdAt),
              and(eq(w.createdAt, after.createdAt), lt(w.id, after.id)),
            );
            if (keyset) {
              clauses.push(keyset);
            }
          }
          return clauses.length > 0 ? and(...clauses) : undefined;
        },
      });

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      // COMMUNITY_ADMIN must not see end-user PII (user id or payout
      // destination); redact server-side so the restriction is enforced before
      // the data leaves the procedure, independent of which columns the UI shows.
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      return {
        items: page.map((row) => ({
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
        })),
        nextCursor:
          rows.length > limit && last
            ? encodeLedgerCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
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

    async listSettlements(scope, filters?: AdminSettlementFilters): Promise<AdminSettlementPage> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return { items: [], nextCursor: null };
      }

      const limit = clampListLimit(filters?.limit);
      const after = keysetAfter(filters?.after);
      const rows = await db.query.tipIntents.findMany({
        orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
        // One extra row purely to detect whether a next page exists.
        limit: limit + 1,
        where: (t, { and, or, eq, gte, lte, lt, inArray }) => {
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
          if (filters?.invoice) {
            clauses.push(eq(t.invoice, filters.invoice));
          }
          if (filters?.asset) {
            clauses.push(eq(t.asset, filters.asset));
          }
          if (filters?.userId) {
            const either = or(eq(t.fromUserId, filters.userId), eq(t.toUserId, filters.userId));
            if (either) {
              clauses.push(either);
            }
          }
          if (filters?.createdFrom) {
            clauses.push(gte(t.createdAt, new Date(filters.createdFrom)));
          }
          if (filters?.createdTo) {
            clauses.push(lte(t.createdAt, new Date(filters.createdTo)));
          }
          if (after) {
            const keyset = or(
              lt(t.createdAt, after.createdAt),
              and(eq(t.createdAt, after.createdAt), lt(t.id, after.id)),
            );
            if (keyset) {
              clauses.push(keyset);
            }
          }
          return clauses.length > 0 ? and(...clauses) : undefined;
        },
      });

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const redactPii = scope.role === "COMMUNITY_ADMIN";
      const items = page.map((row) => ({
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
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeLedgerCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
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

    async listLedgerEntries(scope, filters: AdminLedgerFilters): Promise<AdminLedgerPage> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && !scoped.includes(filters.appId)) {
        return { entries: [], nextCursor: null };
      }

      const limit = Math.min(Math.max(filters.limit ?? LEDGER_PAGE_DEFAULT_LIMIT, 1), LEDGER_PAGE_MAX_LIMIT);
      const rows = await ledgerRepo.listEntries({
        appId: filters.appId,
        userId: filters.userId,
        asset: filters.asset,
        type: filters.type,
        // Fetch one extra row purely to detect whether a next page exists.
        limit: limit + 1,
        after: filters.after ? { createdAt: new Date(filters.after.createdAt), id: filters.after.id } : undefined,
      });

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((row) => ({
          id: row.id,
          appId: row.appId,
          userId: row.userId,
          asset: row.asset,
          amount: row.amount,
          type: row.type,
          refId: row.refId,
          idempotencyKey: row.idempotencyKey,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length > limit && last
            ? encodeLedgerCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    },

    async getLedgerBalanceBreakdown(scope, params): Promise<AdminLedgerBalanceBreakdown> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && !scoped.includes(params.appId)) {
        // Out-of-scope apps read as empty accounts rather than existence oracles.
        return {
          appId: params.appId,
          userId: params.userId,
          asset: params.asset,
          balance: "0",
          creditTotal: "0",
          debitTotal: "0",
          creditCount: 0,
          debitCount: 0,
          firstEntryAt: null,
          lastEntryAt: null,
        };
      }

      const breakdown = await ledgerRepo.getBalanceBreakdown(params);
      return {
        ...breakdown,
        firstEntryAt: isoOrNull(breakdown.firstEntryAt),
        lastEntryAt: isoOrNull(breakdown.lastEntryAt),
      };
    },

    async reconcileLedger(scope, params: AdminLedgerReconcileParams): Promise<AdminLedgerReconciliationResult> {
      const scoped = await resolveScopedAppIds(db, scope);
      const to = params.to ? new Date(params.to) : new Date();
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - RECONCILE_DEFAULT_WINDOW_MS);
      const window = { from: from.toISOString(), to: to.toISOString() };

      const outOfScope = scoped !== "ALL" && (params.appId ? !scoped.includes(params.appId) : scoped.length === 0);
      if (outOfScope) {
        // Out-of-scope apps read as an empty (clean) report rather than an
        // existence oracle for other communities' data.
        return {
          ...reconcileLedger({ tipIntents: [], withdrawals: [], entries: [] }),
          window,
          truncated: false,
        };
      }

      const appClauses = (column: typeof tipIntents.appId | typeof withdrawals.appId | typeof ledgerEntries.appId) => {
        const clauses = [];
        if (params.appId) {
          clauses.push(eq(column, params.appId));
        } else if (scoped !== "ALL") {
          clauses.push(inArray(column, scoped));
        }
        return clauses;
      };

      const [tipRows, withdrawalRows, entryRowsInWindow] = await Promise.all([
        db
          .select({
            id: tipIntents.id,
            appId: tipIntents.appId,
            toUserId: tipIntents.toUserId,
            asset: tipIntents.asset,
            amount: tipIntents.amount,
            invoiceState: tipIntents.invoiceState,
          })
          .from(tipIntents)
          .where(and(gte(tipIntents.createdAt, from), lte(tipIntents.createdAt, to), ...appClauses(tipIntents.appId)))
          .limit(RECONCILE_MAX_ROWS),
        db
          .select({
            id: withdrawals.id,
            appId: withdrawals.appId,
            userId: withdrawals.userId,
            asset: withdrawals.asset,
            amount: withdrawals.amount,
            state: withdrawals.state,
          })
          .from(withdrawals)
          .where(
            and(gte(withdrawals.createdAt, from), lte(withdrawals.createdAt, to), ...appClauses(withdrawals.appId)),
          )
          .limit(RECONCILE_MAX_ROWS),
        db
          .select()
          .from(ledgerEntries)
          .where(
            and(
              gte(ledgerEntries.createdAt, from),
              lte(ledgerEntries.createdAt, to),
              ...appClauses(ledgerEntries.appId),
            ),
          )
          .limit(RECONCILE_MAX_ROWS),
      ]);

      // Ledger writes can land slightly outside the window that produced the
      // tip/withdrawal row (and vice versa), so pull the rows referenced by
      // what we already have before classifying. Otherwise boundary rows show
      // up as false "missing credit"/"unknown reference" anomalies.
      const knownRefIds = [...tipRows.map((row) => row.id), ...withdrawalRows.map((row) => row.id)];
      const extraEntryRows =
        knownRefIds.length > 0
          ? await db
              .select()
              .from(ledgerEntries)
              .where(inArray(ledgerEntries.refId, knownRefIds))
              .limit(RECONCILE_MAX_ROWS)
          : [];

      const entryById = new Map(
        [...entryRowsInWindow, ...extraEntryRows].map((row) => [
          row.id,
          {
            id: row.id,
            appId: row.appId,
            userId: row.userId,
            asset: row.asset,
            amount: typeof row.amount === "string" ? row.amount : String(row.amount),
            type: row.type,
            refId: row.refId,
          } satisfies LedgerReconciliationEntry,
        ]),
      );
      const entries = Array.from(entryById.values());

      const tipIds = new Set(tipRows.map((row) => row.id));
      const withdrawalIds = new Set(withdrawalRows.map((row) => row.id));
      const creditRefIds = entries
        .filter((entry) => entry.type === "credit" && !tipIds.has(entry.refId))
        .map((entry) => entry.refId);
      const debitRefIds = entries
        .filter((entry) => entry.type === "debit" && !withdrawalIds.has(entry.refId))
        .map((entry) => entry.refId);

      const [extraTipRows, extraWithdrawalRows] = await Promise.all([
        creditRefIds.length > 0
          ? db
              .select({
                id: tipIntents.id,
                appId: tipIntents.appId,
                toUserId: tipIntents.toUserId,
                asset: tipIntents.asset,
                amount: tipIntents.amount,
                invoiceState: tipIntents.invoiceState,
              })
              .from(tipIntents)
              .where(inArray(tipIntents.id, creditRefIds))
              .limit(RECONCILE_MAX_ROWS)
          : Promise.resolve([]),
        debitRefIds.length > 0
          ? db
              .select({
                id: withdrawals.id,
                appId: withdrawals.appId,
                userId: withdrawals.userId,
                asset: withdrawals.asset,
                amount: withdrawals.amount,
                state: withdrawals.state,
              })
              .from(withdrawals)
              .where(inArray(withdrawals.id, debitRefIds))
              .limit(RECONCILE_MAX_ROWS)
          : Promise.resolve([]),
      ]);

      const toTip = (row: (typeof tipRows)[number]): LedgerReconciliationTipIntent => ({
        id: row.id,
        appId: row.appId,
        toUserId: row.toUserId,
        asset: row.asset,
        amount: typeof row.amount === "string" ? row.amount : String(row.amount),
        invoiceState: row.invoiceState,
      });
      const toWithdrawal = (row: (typeof withdrawalRows)[number]): LedgerReconciliationWithdrawal => ({
        id: row.id,
        appId: row.appId,
        userId: row.userId,
        asset: row.asset,
        amount: typeof row.amount === "string" ? row.amount : String(row.amount),
        state: row.state,
      });

      const report = reconcileLedger({
        tipIntents: [...tipRows, ...extraTipRows].map(toTip),
        withdrawals: [...withdrawalRows, ...extraWithdrawalRows].map(toWithdrawal),
        entries,
      });

      const truncated =
        tipRows.length >= RECONCILE_MAX_ROWS ||
        withdrawalRows.length >= RECONCILE_MAX_ROWS ||
        entryRowsInWindow.length >= RECONCILE_MAX_ROWS ||
        extraEntryRows.length >= RECONCILE_MAX_ROWS;

      return {
        ...report,
        window,
        truncated,
      };
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
