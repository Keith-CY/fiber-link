import type { UserRole, WithdrawalState } from "@fiber-link/db";
import type {
  DashboardApp,
  DashboardBackupBundle,
  DashboardMonitoringSummary,
  DashboardRateLimitConfig,
  DashboardStatusSummary,
  DashboardWithdrawalPolicy,
} from "../../dashboard/dashboard-page-model";
import type { DashboardRateLimitChangeSet, DashboardRateLimitDraft } from "../dashboard-rate-limit";
import type { DashboardBackupCaptureResult, DashboardBackupRestorePlan } from "../dashboard-backups";
import type { WithdrawalPolicyInput } from "../../withdrawal-policy-input";

/**
 * Identity + role the operator request resolved to. Every services call is
 * scoped by this so COMMUNITY_ADMIN access can be narrowed to assigned apps in
 * one place (the services seam) rather than being re-derived in each router.
 */
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

/**
 * The seam every admin tRPC router depends on. The real implementation
 * (`createDbAdminServices`) queries Postgres through the `@fiber-link/db`
 * repositories; the fixture implementation backs unit tests and the Playwright
 * acceptance harness end to end.
 */
export interface AdminServices {
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

  loadMonitoringSummary(): Promise<DashboardMonitoringSummary>;
  loadRateLimitConfig(): Promise<DashboardRateLimitConfig>;
  createRateLimitChangeSet(input: DashboardRateLimitDraft): Promise<DashboardRateLimitChangeSet>;

  listBackupBundles(): Promise<DashboardBackupBundle[]>;
  captureBackup(): Promise<DashboardBackupCaptureResult>;
  buildBackupRestorePlan(backupId: string): Promise<DashboardBackupRestorePlan>;
}
