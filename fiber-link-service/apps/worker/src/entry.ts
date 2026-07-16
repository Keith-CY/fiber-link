import {
  type TipIntentListCursor,
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  createDbWorkerStateRepo,
  withdrawals,
} from "@fiber-link/db";
import { createAdapterProvider, createDefaultHotWalletInventoryProvider } from "@fiber-link/fiber-adapter";
import { sql } from "drizzle-orm";
import { parseWorkerConfig } from "./config";
import { runLiquidityBatch } from "./liquidity-batch";
import { createComponentLogger } from "./logger";
import {
  configureWorkerMetricsSources,
  parseWorkerMetricsPort,
  parseWorkerMetricsToken,
  startWorkerMetricsServer,
} from "./metrics";
import { createDbSettlementCursorStore, createFileSettlementCursorStore } from "./settlement-cursor-store";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createSettlementPublisher } from "./settlement-publisher";
import { type SettlementSubscriptionRunner, startSettlementSubscriptionRunner } from "./settlement-subscription-runner";
import { runWithdrawalBatch } from "./withdrawal-batch";
import { createWorkerRuntime } from "./worker-runtime";

const logger = createComponentLogger("worker");

// RPC URLs may carry userinfo (user:pass@host); strip credentials before logging.
function redactUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return `${u.origin}${u.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

async function main() {
  const config = parseWorkerConfig(process.env);
  const settlementSubscriptionUrl = (process.env.FIBER_SETTLEMENT_SUBSCRIPTION_URL ?? "").trim();
  const hasSettlementSubscriptionUrl = settlementSubscriptionUrl.length > 0;
  const createFiberAdapter = (signal?: AbortSignal) =>
    createAdapterProvider({
      endpoint: config.fiberRpcUrl,
      signal,
      settlementSubscription:
        config.settlementStrategy === "subscription"
          ? {
              enabled: hasSettlementSubscriptionUrl,
              url: hasSettlementSubscriptionUrl ? settlementSubscriptionUrl : undefined,
            }
          : { enabled: false },
    });
  const createChannelAcceptAdapter = (signal?: AbortSignal) =>
    config.channelAcceptRpcUrl === config.fiberRpcUrl
      ? createFiberAdapter(signal)
      : createAdapterProvider({
          endpoint: config.channelAcceptRpcUrl,
          signal,
        });
  const fiberAdapter = createFiberAdapter();
  const settlementPublisher = createSettlementPublisher();
  const fileCursorStore = createFileSettlementCursorStore(config.settlementCursorFile);
  const cursorStore =
    config.settlementCursorStore === "file"
      ? fileCursorStore
      : createDbSettlementCursorStore(createDbWorkerStateRepo(createDbClient()), {
          legacyFileStore: fileCursorStore,
        });
  const inventoryProvider = createDefaultHotWalletInventoryProvider();

  // Scrapeable metrics are opt-in: exposed only when WORKER_METRICS_PORT is
  // set. Gauges query Postgres at scrape time through their own client so a
  // slow scrape cannot interfere with batch db work.
  const metricsPort = parseWorkerMetricsPort(process.env);
  let metricsServer: ReturnType<typeof startWorkerMetricsServer> | null = null;
  if (metricsPort !== null) {
    const metricsDb = createDbClient();
    const metricsTipIntentRepo = createDbTipIntentRepo(metricsDb);
    const metricsLedgerRepo = createDbLedgerRepo(metricsDb);
    configureWorkerMetricsSources({
      countUnpaidBacklog: () => metricsTipIntentRepo.countByInvoiceState("UNPAID"),
      countSettlementRetryPending: () => metricsTipIntentRepo.countSettlementRetryPending(),
      countWithdrawalsByState: async () => {
        const rows = await metricsDb
          .select({ state: withdrawals.state, count: sql<number>`count(*)::int` })
          .from(withdrawals)
          .groupBy(withdrawals.state);
        return rows.map((row) => ({ state: String(row.state), count: Number(row.count) }));
      },
      countNegativeBalanceAccounts: () => metricsLedgerRepo.countNegativeBalanceAccounts(),
    });
    metricsServer = startWorkerMetricsServer({ port: metricsPort, token: parseWorkerMetricsToken(process.env) });
  }
  let settlementCursor: TipIntentListCursor | undefined = await cursorStore.load();
  let subscriptionRunner: SettlementSubscriptionRunner | null = null;
  const liquidityFallback = {
    mode: config.liquidityFallbackMode,
    channelAcceptRpcUrl: config.channelAcceptRpcUrl,
    channelRotationBootstrapReserve: config.channelRotationBootstrapReserve,
    channelRotationMinRecoverableAmount: config.channelRotationMinRecoverableAmount,
    channelRotationMaxConcurrent: config.channelRotationMaxConcurrent,
  };
  const liquidityFallbackForLog = {
    ...liquidityFallback,
    channelAcceptRpcUrl: redactUrlForLog(liquidityFallback.channelAcceptRpcUrl),
  };

  const runtime = createWorkerRuntime({
    intervalMs: Math.min(config.withdrawalIntervalMs, config.settlementIntervalMs),
    withdrawalIntervalMs: config.withdrawalIntervalMs,
    runLiquidityBatch: ({ signal }) => {
      const cycleFiberAdapter = createFiberAdapter(signal);
      const cycleChannelAcceptAdapter = createChannelAcceptAdapter(signal);
      return runLiquidityBatch({
        liquidityProvider: {
          getLiquidityCapabilities: cycleFiberAdapter.getLiquidityCapabilities,
          listChannels: cycleFiberAdapter.listChannels,
          openChannel: cycleFiberAdapter.openChannel,
          acceptChannel: cycleChannelAcceptAdapter.acceptChannel,
          getCkbChannelAcceptancePolicy: cycleChannelAcceptAdapter.getCkbChannelAcceptancePolicy,
          shutdownChannel: cycleFiberAdapter.shutdownChannel,
          ensureChainLiquidity: cycleFiberAdapter.ensureChainLiquidity,
          getRebalanceStatus: cycleFiberAdapter.getRebalanceStatus,
        },
        fallbackMode: config.liquidityFallbackMode,
        channelRotationBootstrapReserve: config.channelRotationBootstrapReserve,
        channelRotationMinRecoverableAmount: config.channelRotationMinRecoverableAmount,
        inventoryProvider,
      });
    },
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    settlementIntervalMs: config.settlementIntervalMs,
    settlementBatchSize: config.settlementBatchSize,
    runWithdrawalBatch: ({ maxRetries, retryDelayMs, signal }) => {
      const cycleFiberAdapter = createFiberAdapter(signal);
      return runWithdrawalBatch({
        maxRetries,
        retryDelayMs,
        executeWithdrawal: async (withdrawal) => {
          const withdrawalResult = await cycleFiberAdapter.executeWithdrawal({
            amount: withdrawal.amount,
            asset: withdrawal.asset,
            destination:
              withdrawal.destinationKind === "CKB_ADDRESS"
                ? { kind: "CKB_ADDRESS", address: withdrawal.toAddress }
                : { kind: "PAYMENT_REQUEST", paymentRequest: withdrawal.toAddress },
            requestId: withdrawal.id,
          });
          return {
            ok: true,
            txHash: withdrawalResult.txHash,
          };
        },
      });
    },
    pollSettlements: async ({ limit, signal }) => {
      const cycleFiberAdapter = createFiberAdapter(signal);
      const summary = await runSettlementDiscovery({
        limit,
        cursor: settlementCursor,
        adapter: cycleFiberAdapter,
        maxRetries: config.settlementMaxRetries,
        retryDelayMs: config.settlementRetryDelayMs,
        pendingTimeoutMs: config.settlementPendingTimeoutMs,
        publisher: settlementPublisher,
      });
      settlementCursor = summary.nextCursor ?? undefined;
      await cursorStore.save(settlementCursor);
      return summary;
    },
  });

  if (config.settlementStrategy === "subscription") {
    if (!hasSettlementSubscriptionUrl) {
      logger.warn("worker.settlement_subscription_url_missing", { fallback: "polling" });
    }

    try {
      if (hasSettlementSubscriptionUrl) {
        subscriptionRunner = await startSettlementSubscriptionRunner({
          adapter: fiberAdapter,
          concurrency: config.subscriptionConcurrency,
          maxPendingEvents: config.subscriptionMaxPendingEvents,
          recentInvoiceDedupeSize: config.subscriptionRecentInvoiceDedupeSize,
          publisher: settlementPublisher,
        });
      }
      logger.info("worker.settlement_strategy_enabled", {
        strategy: "subscription",
        pollingFallback: true,
        subscriptionUrlConfigured: hasSettlementSubscriptionUrl,
        subscriptionConcurrency: config.subscriptionConcurrency,
        maxPendingEvents: config.subscriptionMaxPendingEvents,
        recentInvoiceDedupeSize: config.subscriptionRecentInvoiceDedupeSize,
        liquidityFallback: liquidityFallbackForLog,
      });
    } catch (error) {
      logger.error("worker.settlement_subscription_startup_failed", { error, fallback: "polling" });
    }
  } else {
    logger.info("worker.settlement_strategy_enabled", {
      strategy: "polling",
      pollingFallback: false,
      liquidityFallback: liquidityFallbackForLog,
    });
  }

  async function shutdown(signal: NodeJS.Signals) {
    metricsServer?.close();
    await subscriptionRunner?.close();
    await settlementPublisher.close().catch((error) => {
      logger.warn("worker.settlement_publisher_close_failed", { error });
    });
    await runtime.shutdown(signal);
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await runtime.start();
}

void main().catch((error) => {
  logger.error("worker.startup_failed", { error });
  process.exit(1);
});
