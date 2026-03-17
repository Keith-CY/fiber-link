import { describe, expect, it } from "vitest";
import type { TipIntentRepo } from "@fiber-link/db";
import {
  collectSettlementOpsSnapshot,
  evaluateWorkerOpsSummary,
  parseWorkerOpsConfig,
  type WorkerOpsConfig,
} from "./ops-summary";
import type { WorkerReadinessResult } from "./worker-readiness";
import type { WithdrawalParityReport } from "./withdrawal-reconciliation";

function createHealthyReadiness(): WorkerReadinessResult {
  return {
    status: "ready",
    checks: {
      database: { status: "ok" },
      coreService: { status: "ok" },
    },
  };
}

function createParityReport(overrides: Partial<WithdrawalParityReport> = {}): WithdrawalParityReport {
  return {
    healthy: true,
    totals: {
      withdrawals: 4,
      completedWithdrawals: 2,
      debitEntries: 2,
      matchedDebits: 2,
      issueCount: 0,
    },
    issuesByKind: {
      MALFORMED_DEBIT_IDEMPOTENCY_KEY: 0,
      ORPHAN_DEBIT_ENTRY: 0,
      COMPLETED_WITHDRAWAL_MISSING_TX_HASH: 0,
      COMPLETED_WITHDRAWAL_MISSING_DEBIT: 0,
      NON_COMPLETED_WITHDRAWAL_HAS_DEBIT: 0,
      DUPLICATE_DEBIT_ENTRIES: 0,
      DEBIT_ACCOUNT_MISMATCH: 0,
      DEBIT_AMOUNT_MISMATCH: 0,
    },
    issues: [],
    ...overrides,
  };
}

function createConfig(overrides: Partial<WorkerOpsConfig> = {}): WorkerOpsConfig {
  return {
    maxUnpaidBacklog: 5,
    maxOldestUnpaidAgeMs: 15 * 60_000,
    maxRetryPendingCount: 1,
    maxRecentFailedSettlements: 0,
    recentFailureLookbackHours: 24,
    maxWithdrawalParityIssues: 0,
    withdrawalLookbackHours: 24,
    withdrawalSampleLimit: 500,
    ...overrides,
  };
}

describe("worker ops summary", () => {
  it("collects settlement backlog, retry, and recent failure signals", async () => {
    const now = new Date("2026-03-18T12:00:00.000Z");
    const repo = {
      countByInvoiceState: async (state: string, options?: { createdAtFrom?: Date }) => {
        if (state === "UNPAID") {
          return 2;
        }
        if (state === "FAILED") {
          expect(options?.createdAtFrom?.toISOString()).toBe("2026-03-17T12:00:00.000Z");
          return 1;
        }
        return 0;
      },
      listByInvoiceState: async () => [
        {
          id: "tip-1",
          appId: "app-1",
          postId: "post-1",
          fromUserId: "u1",
          toUserId: "u2",
          asset: "USDI",
          amount: "10",
          invoice: "inv-1",
          message: null,
          invoiceState: "UNPAID",
          settlementRetryCount: 1,
          settlementNextRetryAt: new Date("2026-03-18T12:01:00.000Z"),
          settlementLastError: null,
          settlementFailureReason: null,
          settlementLastCheckedAt: now,
          createdAt: new Date("2026-03-18T11:45:00.000Z"),
          settledAt: null,
        },
      ],
      countSettlementRetryPending: async () => 1,
    } satisfies Pick<TipIntentRepo, "countByInvoiceState" | "listByInvoiceState" | "countSettlementRetryPending">;

    const snapshot = await collectSettlementOpsSnapshot({
      tipIntentRepo: repo,
      now,
      recentFailureLookbackHours: 24,
    });

    expect(snapshot).toEqual({
      backlogUnpaid: 2,
      oldestUnpaidAgeMs: 15 * 60_000,
      retryPendingCount: 1,
      recentFailedSettlements: 1,
    });
  });

  it("returns alert summary when readiness, backlog, retry, or parity thresholds are breached", () => {
    const summary = evaluateWorkerOpsSummary({
      generatedAt: new Date("2026-03-18T12:00:00.000Z"),
      checks: {
        status: "not_ready",
        checks: {
          database: { status: "error", message: "timeout" },
          coreService: { status: "ok" },
        },
      },
      settlement: {
        backlogUnpaid: 9,
        oldestUnpaidAgeMs: 20 * 60_000,
        retryPendingCount: 2,
        recentFailedSettlements: 1,
      },
      withdrawalParity: createParityReport({
        healthy: false,
        totals: {
          withdrawals: 4,
          completedWithdrawals: 2,
          debitEntries: 2,
          matchedDebits: 1,
          issueCount: 2,
        },
        issues: [{ kind: "COMPLETED_WITHDRAWAL_MISSING_DEBIT", withdrawalId: "w-1", detail: "missing debit" }],
      }),
      config: createConfig(),
    });

    expect(summary.status).toBe("alert");
    expect(summary.alerts.map((alert) => alert.code)).toEqual([
      "DEPENDENCY_NOT_READY",
      "UNPAID_BACKLOG_EXCEEDED",
      "OLDEST_UNPAID_AGE_EXCEEDED",
      "RETRY_PENDING_EXCEEDED",
      "RECENT_FAILED_SETTLEMENTS_EXCEEDED",
      "WITHDRAWAL_PARITY_ISSUES_EXCEEDED",
    ]);
  });

  it("parses worker ops config from environment overrides", () => {
    const config = parseWorkerOpsConfig({
      WORKER_OPS_MAX_UNPAID_BACKLOG: "11",
      WORKER_OPS_MAX_OLDEST_UNPAID_AGE_MS: "120000",
      WORKER_OPS_MAX_RETRY_PENDING: "4",
      WORKER_OPS_MAX_RECENT_FAILED_SETTLEMENTS: "2",
      WORKER_OPS_RECENT_FAILURE_LOOKBACK_HOURS: "48",
      WORKER_OPS_MAX_WITHDRAWAL_PARITY_ISSUES: "3",
      WORKER_OPS_WITHDRAWAL_LOOKBACK_HOURS: "72",
      WORKER_OPS_WITHDRAWAL_SAMPLE_LIMIT: "900",
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      maxUnpaidBacklog: 11,
      maxOldestUnpaidAgeMs: 120000,
      maxRetryPendingCount: 4,
      maxRecentFailedSettlements: 2,
      recentFailureLookbackHours: 48,
      maxWithdrawalParityIssues: 3,
      withdrawalLookbackHours: 72,
      withdrawalSampleLimit: 900,
    });
  });

  it("returns ok summary when signals stay within configured thresholds", () => {
    const summary = evaluateWorkerOpsSummary({
      generatedAt: new Date("2026-03-18T12:00:00.000Z"),
      checks: createHealthyReadiness(),
      settlement: {
        backlogUnpaid: 1,
        oldestUnpaidAgeMs: 60_000,
        retryPendingCount: 0,
        recentFailedSettlements: 0,
      },
      withdrawalParity: createParityReport(),
      config: createConfig(),
    });

    expect(summary.status).toBe("ok");
    expect(summary.alerts).toEqual([]);
  });
});
