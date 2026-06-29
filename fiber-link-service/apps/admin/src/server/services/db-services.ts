import { createDbClient, withdrawalPolicies, type DbClient } from "@fiber-link/db";
import type {
  DashboardApp,
  DashboardWithdrawalPolicy,
  DashboardMonitoringSummary,
  DashboardRateLimitConfig,
  DashboardBackupBundle,
} from "../../dashboard/dashboard-page-model";
import { loadDashboardMonitoringSummary } from "../dashboard-monitoring";
import {
  buildDashboardRateLimitChangeSet,
  loadDashboardRateLimitConfig,
  parseDashboardRateLimitInput,
  type DashboardRateLimitChangeSet,
  type DashboardRateLimitDraft,
} from "../dashboard-rate-limit";
import {
  buildDashboardBackupRestorePlan,
  captureDashboardBackup,
  listDashboardBackupBundles,
  type DashboardBackupCaptureResult,
  type DashboardBackupRestorePlan,
} from "../dashboard-backups";
import type { WithdrawalPolicyInput } from "../../withdrawal-policy-input";
import type {
  AdminScope,
  AdminServices,
  AdminWithdrawal,
  AdminWithdrawalFilters,
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
  return {
    async listApps(scope): Promise<DashboardApp[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.apps.findMany({
        columns: APP_COLUMNS,
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
        toAddress: redactPii ? null : row.toAddress ?? null,
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

    async listPolicies(scope): Promise<DashboardWithdrawalPolicy[]> {
      const scoped = await resolveScopedAppIds(db, scope);
      if (scoped !== "ALL" && scoped.length === 0) {
        return [];
      }

      const rows = await db.query.withdrawalPolicies.findMany({
        columns: POLICY_COLUMNS,
        ...(scoped === "ALL" ? {} : { where: (p, { inArray }) => inArray(p.appId, scoped) }),
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
          throw new Error("COMMUNITY_ADMIN can only update policies for managed apps");
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
        throw new Error(`unknown app: ${input.appId}`);
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

      await db
        .insert(withdrawalPolicies)
        .values({ appId: input.appId, createdAt: now, ...set })
        .onConflictDoUpdate({ target: withdrawalPolicies.appId, set });

      const rows = await db.query.withdrawalPolicies.findMany({
        columns: POLICY_COLUMNS,
        where: (p, { eq }) => eq(p.appId, input.appId),
      });
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
