import { and, desc, eq, or, sql } from "drizzle-orm";
import { apps, createDbClient, createDbLedgerRepo, createDbWithdrawalRepo, getCreatorAnalytics, tipIntents, withdrawals } from "@fiber-link/db";
import type { AnalyticsRange } from "@fiber-link/db";
import type {
  DashboardSummaryResult,
  DashboardSettlementStateFilterSchema,
  DashboardWithdrawalStateFilterSchema,
} from "../contracts";

type DashboardWithdrawalStateFilter = typeof DashboardWithdrawalStateFilterSchema._type;
type DashboardSettlementStateFilter = typeof DashboardSettlementStateFilterSchema._type;
type DashboardAdminResult = NonNullable<DashboardSummaryResult["admin"]>;

const ADMIN_APPS_LIMIT = 25;
const ADMIN_WITHDRAWALS_LIMIT = 40;
const ADMIN_SETTLEMENTS_LIMIT = 40;
const ADMIN_PIPELINE_INVOICE_ROWS_LIMIT = 40;
const PIPELINE_STAGES = ["UNPAID", "SETTLED", "FAILED"] as const;
type DashboardPipelineStage = (typeof PIPELINE_STAGES)[number];
const CKB_EXPLORER_TX_URL_TEMPLATE =
  process.env.FIBER_LINK_CKB_EXPLORER_TX_URL_TEMPLATE ??
  "https://pudge.explorer.nervos.org/transaction/{txHash}";

function buildCkbExplorerTxUrl(txHash: string | null | undefined) {
  if (!txHash) {
    return null;
  }
  return CKB_EXPLORER_TX_URL_TEMPLATE.replace("{txHash}", encodeURIComponent(txHash));
}

type HandleDashboardSummaryInput = {
  appId: string;
  userId: string;
  limit?: number;
  includeAdmin?: boolean;
  filters?: {
    withdrawalState?: DashboardWithdrawalStateFilter;
    settlementState?: DashboardSettlementStateFilter;
  };
};

let defaultDbClient: ReturnType<typeof createDbClient> | null = null;

function getDefaultDbClient() {
  if (!defaultDbClient) {
    defaultDbClient = createDbClient();
  }
  return defaultDbClient;
}

export async function handleDashboardSummary(input: HandleDashboardSummaryInput) {
  const db = getDefaultDbClient();
  const ledgerRepo = createDbLedgerRepo(db);
  const withdrawalRepo = createDbWithdrawalRepo(db);
  const limit = input.limit ?? 20;

  const SUPPORTED_ASSETS = ["CKB", "USDI"] as const;

  const [balance, lockedBalance, usdiBalance, usdiLockedBalance, recentTips, recentWithdrawals, tipSummary] = await Promise.all([
    ledgerRepo.getBalance({
      appId: input.appId,
      userId: input.userId,
      asset: "CKB",
    }),
    withdrawalRepo.getPendingTotal({
      appId: input.appId,
      userId: input.userId,
      asset: "CKB",
    }),
    ledgerRepo.getBalance({
      appId: input.appId,
      userId: input.userId,
      asset: "USDI",
    }),
    withdrawalRepo.getPendingTotal({
      appId: input.appId,
      userId: input.userId,
      asset: "USDI",
    }),
    db
      .select()
      .from(tipIntents)
      .where(
        and(
          eq(tipIntents.appId, input.appId),
          eq(tipIntents.toUserId, input.userId),
        ),
      )
      .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
      .limit(limit),
    db
      .select({
        id: withdrawals.id,
        amount: withdrawals.amount,
        asset: withdrawals.asset,
        state: withdrawals.state,
        destinationKind: withdrawals.destinationKind,
        toAddress: withdrawals.toAddress,
        txHash: withdrawals.txHash,
        createdAt: withdrawals.createdAt,
        updatedAt: withdrawals.updatedAt,
        completedAt: withdrawals.completedAt,
      })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.appId, input.appId),
          eq(withdrawals.userId, input.userId),
        ),
      )
      .orderBy(desc(withdrawals.updatedAt), desc(withdrawals.id))
      .limit(limit),
    (async () => {
      const [row] = await db
        .select({
          pendingAmount:
            sql<string>`COALESCE(SUM(CASE WHEN ${tipIntents.toUserId} = ${input.userId} AND ${tipIntents.invoiceState} = 'UNPAID' THEN ${tipIntents.amount} ELSE 0 END), 0)`,
          pendingCount: sql<number>`COALESCE(SUM(CASE WHEN ${tipIntents.toUserId} = ${input.userId} AND ${tipIntents.invoiceState} = 'UNPAID' THEN 1 ELSE 0 END), 0)::int`,
          completedCount: sql<number>`COALESCE(SUM(CASE WHEN ${tipIntents.toUserId} = ${input.userId} AND ${tipIntents.invoiceState} = 'SETTLED' THEN 1 ELSE 0 END), 0)::int`,
          failedCount: sql<number>`COALESCE(SUM(CASE WHEN ${tipIntents.toUserId} = ${input.userId} AND ${tipIntents.invoiceState} = 'FAILED' THEN 1 ELSE 0 END), 0)::int`,
        })
        .from(tipIntents)
        .where(
          and(
            eq(tipIntents.appId, input.appId),
            eq(tipIntents.toUserId, input.userId),
          ),
        );
      return row ?? null;
    })(),
  ]);

  let admin: DashboardAdminResult | undefined;

  if (input.includeAdmin) {
    const withdrawalState = input.filters?.withdrawalState ?? "ALL";
    const settlementState = input.filters?.settlementState ?? "ALL";

    const withdrawalPredicates = [eq(withdrawals.appId, input.appId)];
    if (withdrawalState !== "ALL") {
      withdrawalPredicates.push(eq(withdrawals.state, withdrawalState));
    }

    const settlementPredicates = [eq(tipIntents.appId, input.appId)];
    if (settlementState !== "ALL") {
      settlementPredicates.push(eq(tipIntents.invoiceState, settlementState));
    }

    const [appRows, withdrawalRows, settlementRows, pipelineStageCounts, pipelineInvoiceRows] = await Promise.all([
      db
        .select({ appId: apps.appId, createdAt: apps.createdAt })
        .from(apps)
        .orderBy(desc(apps.createdAt))
        .limit(ADMIN_APPS_LIMIT),
      db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          asset: withdrawals.asset,
          amount: withdrawals.amount,
          state: withdrawals.state,
          retryCount: withdrawals.retryCount,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          txHash: withdrawals.txHash,
          nextRetryAt: withdrawals.nextRetryAt,
          lastError: withdrawals.lastError,
        })
        .from(withdrawals)
        .where(and(...withdrawalPredicates))
        .orderBy(desc(withdrawals.updatedAt), desc(withdrawals.id))
        .limit(ADMIN_WITHDRAWALS_LIMIT),
      db
        .select({
          id: tipIntents.id,
          invoice: tipIntents.invoice,
          fromUserId: tipIntents.fromUserId,
          toUserId: tipIntents.toUserId,
          state: tipIntents.invoiceState,
          retryCount: tipIntents.settlementRetryCount,
          createdAt: tipIntents.createdAt,
          settledAt: tipIntents.settledAt,
          nextRetryAt: tipIntents.settlementNextRetryAt,
          lastCheckedAt: tipIntents.settlementLastCheckedAt,
          lastError: tipIntents.settlementLastError,
          failureReason: tipIntents.settlementFailureReason,
        })
        .from(tipIntents)
        .where(and(...settlementPredicates))
        .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
        .limit(ADMIN_SETTLEMENTS_LIMIT),
      db
        .select({
          state: tipIntents.invoiceState,
          count: sql<number>`count(*)::int`,
        })
        .from(tipIntents)
        .where(eq(tipIntents.appId, input.appId))
        .groupBy(tipIntents.invoiceState),
      db
        .select({
          invoice: tipIntents.invoice,
          state: tipIntents.invoiceState,
          amount: tipIntents.amount,
          asset: tipIntents.asset,
          fromUserId: tipIntents.fromUserId,
          toUserId: tipIntents.toUserId,
          createdAt: tipIntents.createdAt,
        })
        .from(tipIntents)
        .where(eq(tipIntents.appId, input.appId))
        .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
        .limit(ADMIN_PIPELINE_INVOICE_ROWS_LIMIT),
    ]);

    const pipelineCountByStage: Record<DashboardPipelineStage, number> = {
      UNPAID: 0,
      SETTLED: 0,
      FAILED: 0,
    };
    for (const row of pipelineStageCounts) {
      if (row.state === "UNPAID" || row.state === "SETTLED" || row.state === "FAILED") {
        pipelineCountByStage[row.state] = Number(row.count) || 0;
      }
    }

    admin = {
      filtersApplied: {
        withdrawalState,
        settlementState,
      },
      apps: appRows.map((row) => ({
        appId: row.appId,
        createdAt: row.createdAt.toISOString(),
      })),
      withdrawals: withdrawalRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        asset: row.asset,
        amount: String(row.amount),
        state: row.state,
        retryCount: row.retryCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        txHash: row.txHash,
        nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
        lastError: row.lastError,
      })),
      settlements: settlementRows.map((row) => ({
        id: row.id,
        invoice: row.invoice,
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        state: row.state,
        retryCount: row.retryCount,
        createdAt: row.createdAt.toISOString(),
        settledAt: row.settledAt ? row.settledAt.toISOString() : null,
        nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
        lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
        lastError: row.lastError,
        failureReason: row.failureReason,
      })),
      pipelineBoard: {
        stageCounts: PIPELINE_STAGES.map((stage) => ({
          stage,
          count: pipelineCountByStage[stage],
        })),
        invoiceRows: pipelineInvoiceRows.map((row) => ({
          invoice: row.invoice,
          state: row.state,
          amount: String(row.amount),
          asset: row.asset,
          fromUserId: row.fromUserId,
          toUserId: row.toUserId,
          createdAt: row.createdAt.toISOString(),
          timelineHref: `/fiber-link/timeline/${encodeURIComponent(row.invoice)}`,
        })),
      },
    };
  }

  return {
    balance: String(balance),
    balances: {
      available: String(balance),
      pending: String(tipSummary?.pendingAmount ?? "0"),
      locked: String(lockedBalance),
      asset: "CKB" as const,
    },
    assetBalances: [
      {
        asset: "CKB" as const,
        available: String(balance),
        pending: String(tipSummary?.pendingAmount ?? "0"),
        locked: String(lockedBalance),
      },
      {
        asset: "USDI" as const,
        available: String(usdiBalance),
        pending: "0",
        locked: String(usdiLockedBalance),
      },
    ],
    stats: {
      pendingCount: Number(tipSummary?.pendingCount ?? 0),
      completedCount: Number(tipSummary?.completedCount ?? 0),
      failedCount: Number(tipSummary?.failedCount ?? 0),
    },
    tips: [
      ...recentTips
        .filter((row) => row.toUserId === input.userId)
        .map((row) => ({
          id: row.id,
          invoice: row.invoice,
          postId: row.postId,
          amount: String(row.amount),
          asset: row.asset,
          state: row.invoiceState,
          direction: "IN" as const,
          counterpartyUserId: row.fromUserId,
          message: row.message ?? null,
          createdAt: row.createdAt.toISOString(),
          settledAt: row.settledAt ? row.settledAt.toISOString() : null,
          activityType: "TIP" as const,
          txHash: null,
          explorerUrl: null,
          destinationKind: null,
          destination: null,
        })),
      ...recentWithdrawals.map((row) => ({
        id: row.id,
        invoice: `withdrawal:${row.id}`,
        postId: "withdrawal",
        amount: String(row.amount),
        asset: row.asset,
        state: row.state,
        direction: "WITHDRAWAL" as const,
        counterpartyUserId: input.userId,
        message: row.txHash ? "On-chain withdrawal completed" : "Withdrawal request",
        createdAt: row.updatedAt.toISOString(),
        settledAt: row.completedAt ? row.completedAt.toISOString() : null,
        activityType: "WITHDRAWAL" as const,
        txHash: row.txHash,
        explorerUrl: buildCkbExplorerTxUrl(row.txHash),
        destinationKind: row.destinationKind,
        destination: row.toAddress,
      })),
    ]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit),
    ...(admin ? { admin } : {}),
    generatedAt: new Date().toISOString(),
  };
}

export async function handleDashboardAnalytics({
  appId,
  userId,
  range,
}: {
  appId: string;
  userId: string;
  range: AnalyticsRange;
}) {
  const db = getDefaultDbClient();
  const result = await getCreatorAnalytics(db, { appId, userId, range });
  return { ...result, range, generatedAt: new Date().toISOString() };
}
