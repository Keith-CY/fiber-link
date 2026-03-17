import { and, desc, eq, gte, like } from "drizzle-orm";
import {
  createDbClient,
  createDbTipIntentRepo,
  ledgerEntries,
  withdrawals,
  type DbClient,
  type TipIntentRepo,
} from "@fiber-link/db";
import { buildWithdrawalParityReport, type WithdrawalParityReport } from "./withdrawal-reconciliation";
import { runWorkerReadinessChecks, type WorkerReadinessResult } from "./worker-readiness";

export type WorkerOpsConfig = {
  maxUnpaidBacklog: number;
  maxOldestUnpaidAgeMs: number;
  maxRetryPendingCount: number;
  maxRecentFailedSettlements: number;
  recentFailureLookbackHours: number;
  maxWithdrawalParityIssues: number;
  withdrawalLookbackHours: number;
  withdrawalSampleLimit: number;
};

export type SettlementOpsSnapshot = {
  backlogUnpaid: number;
  oldestUnpaidAgeMs: number | null;
  retryPendingCount: number;
  recentFailedSettlements: number;
};

export type WorkerOpsAlert = {
  component: "dependencies" | "settlement" | "withdrawals";
  code: string;
  message: string;
};

export type WorkerOpsSummary = {
  status: "ok" | "alert";
  generatedAt: string;
  checks: WorkerReadinessResult;
  settlement: SettlementOpsSnapshot;
  withdrawalParity: WithdrawalParityReport;
  config: WorkerOpsConfig;
  alerts: WorkerOpsAlert[];
};

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function parseWorkerOpsConfig(env: NodeJS.ProcessEnv = process.env): WorkerOpsConfig {
  return {
    maxUnpaidBacklog: parsePositiveInteger(env.WORKER_OPS_MAX_UNPAID_BACKLOG, 25),
    maxOldestUnpaidAgeMs: parsePositiveInteger(env.WORKER_OPS_MAX_OLDEST_UNPAID_AGE_MS, 15 * 60_000),
    maxRetryPendingCount: parsePositiveInteger(env.WORKER_OPS_MAX_RETRY_PENDING, 3),
    maxRecentFailedSettlements: parsePositiveInteger(env.WORKER_OPS_MAX_RECENT_FAILED_SETTLEMENTS, 0),
    recentFailureLookbackHours: parsePositiveInteger(env.WORKER_OPS_RECENT_FAILURE_LOOKBACK_HOURS, 24),
    maxWithdrawalParityIssues: parsePositiveInteger(env.WORKER_OPS_MAX_WITHDRAWAL_PARITY_ISSUES, 0),
    withdrawalLookbackHours: parsePositiveInteger(env.WORKER_OPS_WITHDRAWAL_LOOKBACK_HOURS, 24),
    withdrawalSampleLimit: Math.max(1, parsePositiveInteger(env.WORKER_OPS_WITHDRAWAL_SAMPLE_LIMIT, 500)),
  };
}

export async function collectSettlementOpsSnapshot(input: {
  tipIntentRepo: Pick<TipIntentRepo, "countByInvoiceState" | "listByInvoiceState" | "countSettlementRetryPending">;
  now?: Date;
  recentFailureLookbackHours: number;
}): Promise<SettlementOpsSnapshot> {
  const now = input.now ?? new Date();
  const lookbackStart = new Date(now.getTime() - input.recentFailureLookbackHours * 60 * 60_000);
  const [backlogUnpaid, oldestRows, retryPendingCount, recentFailedSettlements] = await Promise.all([
    input.tipIntentRepo.countByInvoiceState("UNPAID"),
    input.tipIntentRepo.listByInvoiceState("UNPAID", { limit: 1 }),
    input.tipIntentRepo.countSettlementRetryPending(),
    input.tipIntentRepo.countByInvoiceState("FAILED", { createdAtFrom: lookbackStart }),
  ]);

  const oldest = oldestRows[0];
  return {
    backlogUnpaid,
    oldestUnpaidAgeMs: oldest ? Math.max(0, now.getTime() - oldest.createdAt.getTime()) : null,
    retryPendingCount,
    recentFailedSettlements,
  };
}

export async function collectWithdrawalParityReport(input: {
  db: DbClient;
  now?: Date;
  lookbackHours: number;
  limit: number;
}): Promise<WithdrawalParityReport> {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - input.lookbackHours * 60 * 60_000);
  const [withdrawalRows, debitRows] = await Promise.all([
    input.db
      .select({
        id: withdrawals.id,
        appId: withdrawals.appId,
        userId: withdrawals.userId,
        asset: withdrawals.asset,
        amount: withdrawals.amount,
        state: withdrawals.state,
        txHash: withdrawals.txHash,
      })
      .from(withdrawals)
      .where(gte(withdrawals.createdAt, from))
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
      .limit(input.limit),
    input.db
      .select({
        appId: ledgerEntries.appId,
        userId: ledgerEntries.userId,
        asset: ledgerEntries.asset,
        amount: ledgerEntries.amount,
        refId: ledgerEntries.refId,
        idempotencyKey: ledgerEntries.idempotencyKey,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.type, "debit"),
          like(ledgerEntries.idempotencyKey, "withdrawal:debit:%"),
          gte(ledgerEntries.createdAt, from),
        ),
      )
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(input.limit * 4),
  ]);

  return buildWithdrawalParityReport({
    withdrawals: withdrawalRows.map((row) => ({
      ...row,
      amount: String(row.amount),
    })),
    debits: debitRows.map((row) => ({
      ...row,
      amount: String(row.amount),
    })),
  });
}

export function evaluateWorkerOpsSummary(input: {
  generatedAt?: Date;
  checks: WorkerReadinessResult;
  settlement: SettlementOpsSnapshot;
  withdrawalParity: WithdrawalParityReport;
  config: WorkerOpsConfig;
}): WorkerOpsSummary {
  const alerts: WorkerOpsAlert[] = [];

  if (input.checks.status !== "ready") {
    alerts.push({
      component: "dependencies",
      code: "DEPENDENCY_NOT_READY",
      message: "worker readiness checks reported not_ready",
    });
  }

  if (input.settlement.backlogUnpaid > input.config.maxUnpaidBacklog) {
    alerts.push({
      component: "settlement",
      code: "UNPAID_BACKLOG_EXCEEDED",
      message: `unpaid backlog ${input.settlement.backlogUnpaid} exceeded threshold ${input.config.maxUnpaidBacklog}`,
    });
  }

  if (
    input.settlement.oldestUnpaidAgeMs !== null &&
    input.settlement.oldestUnpaidAgeMs > input.config.maxOldestUnpaidAgeMs
  ) {
    alerts.push({
      component: "settlement",
      code: "OLDEST_UNPAID_AGE_EXCEEDED",
      message: `oldest unpaid age ${input.settlement.oldestUnpaidAgeMs}ms exceeded threshold ${input.config.maxOldestUnpaidAgeMs}ms`,
    });
  }

  if (input.settlement.retryPendingCount > input.config.maxRetryPendingCount) {
    alerts.push({
      component: "settlement",
      code: "RETRY_PENDING_EXCEEDED",
      message: `retry-pending count ${input.settlement.retryPendingCount} exceeded threshold ${input.config.maxRetryPendingCount}`,
    });
  }

  if (input.settlement.recentFailedSettlements > input.config.maxRecentFailedSettlements) {
    alerts.push({
      component: "settlement",
      code: "RECENT_FAILED_SETTLEMENTS_EXCEEDED",
      message: `recent failed settlements ${input.settlement.recentFailedSettlements} exceeded threshold ${input.config.maxRecentFailedSettlements}`,
    });
  }

  if (input.withdrawalParity.totals.issueCount > input.config.maxWithdrawalParityIssues) {
    alerts.push({
      component: "withdrawals",
      code: "WITHDRAWAL_PARITY_ISSUES_EXCEEDED",
      message: `withdrawal parity issues ${input.withdrawalParity.totals.issueCount} exceeded threshold ${input.config.maxWithdrawalParityIssues}`,
    });
  }

  return {
    status: alerts.length === 0 ? "ok" : "alert",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    checks: input.checks,
    settlement: input.settlement,
    withdrawalParity: input.withdrawalParity,
    config: input.config,
    alerts,
  };
}

export async function collectWorkerOpsSummary(input: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  db?: DbClient;
  tipIntentRepo?: TipIntentRepo;
  fetchImpl?: typeof fetch;
} = {}): Promise<WorkerOpsSummary> {
  const env = input.env ?? process.env;
  const fiberRpcUrl = env.FIBER_RPC_URL;
  if (!fiberRpcUrl) {
    throw new Error("FIBER_RPC_URL is required");
  }

  const timeoutMs = parsePositiveInteger(env.WORKER_READINESS_TIMEOUT_MS, 5000);
  const config = parseWorkerOpsConfig(env);
  const db = input.db ?? createDbClient();
  const tipIntentRepo = input.tipIntentRepo ?? createDbTipIntentRepo(db);
  const now = input.now ?? new Date();

  const [checks, settlement, withdrawalParity] = await Promise.all([
    runWorkerReadinessChecks(
      {
        fiberRpcUrl,
        timeoutMs,
      },
      {
        fetchImpl: input.fetchImpl,
      },
    ),
    collectSettlementOpsSnapshot({
      tipIntentRepo,
      now,
      recentFailureLookbackHours: config.recentFailureLookbackHours,
    }),
    collectWithdrawalParityReport({
      db,
      now,
      lookbackHours: config.withdrawalLookbackHours,
      limit: config.withdrawalSampleLimit,
    }),
  ]);

  return evaluateWorkerOpsSummary({
    generatedAt: now,
    checks,
    settlement,
    withdrawalParity,
    config,
  });
}
