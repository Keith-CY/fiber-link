import { createAdapterProvider, createDefaultHotWalletInventoryProvider } from "@fiber-link/fiber-adapter";
import type { TipIntentListCursor } from "@fiber-link/db";
import { parseWorkerConfig } from "./config";
import { runLiquidityBatch } from "./liquidity-batch";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";
import {
  startSettlementSubscriptionRunner,
  type SettlementSubscriptionRunner,
} from "./settlement-subscription-runner";
import { runWithdrawalBatch } from "./withdrawal-batch";
import { createSettlementPublisher } from "./settlement-publisher";
import { createWorkerRuntime } from "./worker-runtime";

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
  const cursorStore = createFileSettlementCursorStore(config.settlementCursorFile);
  const inventoryProvider = createDefaultHotWalletInventoryProvider();
  let settlementCursor: TipIntentListCursor | undefined = await cursorStore.load();
  let subscriptionRunner: SettlementSubscriptionRunner | null = null;
  const liquidityFallback = {
    mode: config.liquidityFallbackMode,
    channelAcceptRpcUrl: config.channelAcceptRpcUrl,
    channelRotationBootstrapReserve: config.channelRotationBootstrapReserve,
    channelRotationMinRecoverableAmount: config.channelRotationMinRecoverableAmount,
    channelRotationMaxConcurrent: config.channelRotationMaxConcurrent,
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
      console.warn(
        "[worker] settlement subscription strategy requested but FIBER_SETTLEMENT_SUBSCRIPTION_URL is not set; using polling fallback only",
      );
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
      console.info("[worker] settlement strategy enabled", {
        strategy: "subscription",
        pollingFallback: true,
        subscriptionUrlConfigured: hasSettlementSubscriptionUrl,
        subscriptionConcurrency: config.subscriptionConcurrency,
        maxPendingEvents: config.subscriptionMaxPendingEvents,
        recentInvoiceDedupeSize: config.subscriptionRecentInvoiceDedupeSize,
        liquidityFallback,
      });
    } catch (error) {
      console.error("[worker] settlement subscription startup failed; continuing with polling fallback", error);
    }
  } else {
    console.info("[worker] settlement strategy enabled", {
      strategy: "polling",
      pollingFallback: false,
      liquidityFallback,
    });
  }

  async function shutdown(signal: NodeJS.Signals) {
    await subscriptionRunner?.close();
    await settlementPublisher.close().catch((error) => {
      console.warn("[worker] settlement publisher close failed", error);
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
  console.error("[worker] startup failed", error);
  process.exit(1);
});
