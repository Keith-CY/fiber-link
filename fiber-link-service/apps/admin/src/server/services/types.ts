import type { InvoiceState, UserRole, WithdrawalState } from "@fiber-link/db";
import type {
  DashboardApp,
  DashboardBackupBundle,
  DashboardMonitoringSummary,
  DashboardRateLimitConfig,
  DashboardStatusSummary,
  DashboardWithdrawalPolicy,
} from "../../dashboard/dashboard-page-model";
import type { WithdrawalPolicyInput } from "../../withdrawal-policy-input";
import type { DashboardBackupCaptureResult, DashboardBackupRestorePlan } from "../dashboard-backups";
import type { DashboardRateLimitChangeSet, DashboardRateLimitDraft } from "../dashboard-rate-limit";

/**
 * Identity + role the operator request resolved to. Every services call is
 * scoped by this so COMMUNITY_ADMIN access can be narrowed to assigned apps in
 * one place (the services seam) rather than being re-derived in each router.
 */
export type AdminAuditEventInput = {
  actorId: string;
  actorRole: "SUPER_ADMIN" | "COMMUNITY_ADMIN";
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export type AdminScope = {
  role: UserRole;
  adminUserId?: string;
};

/**
 * Richer withdrawal projection than the legacy dashboard view model: includes
 * the recovery-relevant columns (destination, retry counters, last error) the
 * Withdrawals queue and detail surfaces need.
 */
export type AdminWithdrawal = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  toAddress: string | null;
  state: WithdrawalState;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AdminWithdrawalFilters = {
  state?: WithdrawalState;
  appId?: string;
};

/**
 * Cap for `listWithdrawals`. The queue view is filter-driven; an unbounded
 * SELECT over a production withdrawals table would ship the whole table to the
 * browser on every page load.
 */
export const WITHDRAWAL_LIST_LIMIT = 200;

/** Same rationale as {@link WITHDRAWAL_LIST_LIMIT}, for the settlements queue. */
export const SETTLEMENT_LIST_LIMIT = 200;

/**
 * Settlement projection of a tip intent for the investigation surfaces:
 * current state plus every recovery-relevant column the worker maintains.
 */
export type AdminSettlementIntent = {
  id: string;
  invoice: string;
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
  invoiceState: InvoiceState;
  settlementRetryCount: number;
  settlementNextRetryAt: string | null;
  settlementLastError: string | null;
  settlementFailureReason: string | null;
  settlementLastCheckedAt: string | null;
  createdAt: string;
  settledAt: string | null;
};

/** One `tip_intent_events` row, oldest-first in the timeline. */
export type AdminSettlementEvent = {
  id: string;
  source: string;
  type: string;
  previousInvoiceState: InvoiceState | null;
  nextInvoiceState: InvoiceState | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** An admin action (retry, ops note) recorded against the invoice, newest-first. */
export type AdminSettlementAction = {
  action: string;
  actorId: string;
  actorRole: string;
  reason: string | null;
  createdAt: string;
};

export type AdminSettlementTimeline = {
  intent: AdminSettlementIntent;
  events: AdminSettlementEvent[];
  adminActions: AdminSettlementAction[];
};

export type AdminSettlementFilters = {
  state?: InvoiceState;
  appId?: string;
};

/**
 * The seam every admin tRPC router depends on. The real implementation
 * (`createDbAdminServices`) queries Postgres through the `@fiber-link/db`
 * repositories; the fixture implementation backs unit tests and the Playwright
 * acceptance harness end to end.
 */
export interface AdminServices {
  /**
   * Append a durable audit event for an admin mutation. Implementations must
   * never throw into the caller: auditing is recorded best-effort with an
   * error log, so a broken audit sink cannot take admin operations down —
   * but every mutation path MUST call it.
   */
  appendAuditEvent(event: AdminAuditEventInput): Promise<void>;
  /** Test hook exposed by the fixture implementation only. */
  __listAuditEventsForTests?: () => AdminAuditEventInput[];

  listApps(scope: AdminScope): Promise<DashboardApp[]>;
  /** Newest first, capped at {@link WITHDRAWAL_LIST_LIMIT} rows. */
  listWithdrawals(scope: AdminScope, filters?: AdminWithdrawalFilters): Promise<AdminWithdrawal[]>;
  /**
   * Per-state withdrawal counts over the WHOLE scope (not the capped list),
   * zero-filled in canonical state order.
   */
  summarizeWithdrawals(scope: AdminScope): Promise<DashboardStatusSummary[]>;
  listPolicies(scope: AdminScope): Promise<DashboardWithdrawalPolicy[]>;
  upsertPolicy(scope: AdminScope, input: WithdrawalPolicyInput): Promise<DashboardWithdrawalPolicy>;

  /** Newest first, capped at {@link SETTLEMENT_LIST_LIMIT} rows. */
  listSettlements(scope: AdminScope, filters?: AdminSettlementFilters): Promise<AdminSettlementIntent[]>;
  /**
   * Full investigation view for one invoice: current intent state, the
   * `tip_intent_events` lifecycle timeline, and prior admin actions (retries,
   * ops notes) recorded in the audit trail. Throws `SettlementNotFoundError`
   * for unknown or out-of-scope invoices.
   */
  getSettlementTimeline(scope: AdminScope, invoice: string): Promise<AdminSettlementTimeline>;
  /**
   * Clear the settlement retry/failure state so the worker re-checks the
   * invoice on its next poll. Only valid while the invoice is UNPAID (SETTLED
   * and FAILED are terminal); throws `SettlementRetryStateError` otherwise.
   */
  retrySettlementNow(scope: AdminScope, invoice: string): Promise<AdminSettlementIntent>;

  loadMonitoringSummary(): Promise<DashboardMonitoringSummary>;
  loadRateLimitConfig(): Promise<DashboardRateLimitConfig>;
  createRateLimitChangeSet(input: DashboardRateLimitDraft): Promise<DashboardRateLimitChangeSet>;

  listBackupBundles(): Promise<DashboardBackupBundle[]>;
  captureBackup(): Promise<DashboardBackupCaptureResult>;
  buildBackupRestorePlan(backupId: string): Promise<DashboardBackupRestorePlan>;
}
