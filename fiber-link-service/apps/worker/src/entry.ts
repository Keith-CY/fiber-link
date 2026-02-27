import { createAdapterProvider } from "@fiber-link/fiber-adapter";
import type { TipIntentListCursor } from "@fiber-link/db";
import { parseWorkerConfig } from "./config";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";
import {
  startSettlementSubscriptionRunner,
  type SettlementSubscriptionRunner,
} from "./settlement-subscription-runner";
import { runWithdrawalBatch } from "./withdrawal-batch";
import { createWorkerRuntime } from "./worker-runtime";

async function main() {
  const config = parseWorkerConfig(process.env);
  const settlementSubscriptionUrl = (process.env.FIBER_SETTLEMENT_SUBSCRIPTION_URL ?? "").trim();
  const hasSettlementSubscriptionUrl = settlementSubscriptionUrl.length > 0;
  const fiberAdapter = createAdapterProvider({
    endpoint: config.fiberRpcUrl,
    settlementSubscription:
      config.settlementStrategy === "subscription"
        ? {
            enabled: hasSettlementSubscriptionUrl,
            url: hasSettlementSubscriptionUrl ? settlementSubscriptionUrl : undefined,
          }
        : { enabled: false },
  });
  const cursorStore = createFileSettlementCursorStore(config.settlementCursorFile);
  let settlementCursor: TipIntentListCursor | undefined = await cursorStore.load();
  let subscriptionRunner: SettlementSubscriptionRunner | null = null;

  const runtime = createWorkerRuntime({
    intervalMs: Math.min(config.withdrawalIntervalMs, config.settlementIntervalMs),
    withdrawalIntervalMs: config.withdrawalIntervalMs,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    settlementIntervalMs: config.settlementIntervalMs,
    settlementBatchSize: config.settlementBatchSize,
    runWithdrawalBatch: ({ maxRetries, retryDelayMs }) =>
      runWithdrawalBatch({
        maxRetries,
        retryDelayMs,
        executeWithdrawal: async (withdrawal) => {
          const withdrawalResult = await fiberAdapter.executeWithdrawal({
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
      }),
    pollSettlements: async ({ limit }) => {
      const summary = await runSettlementDiscovery({
        limit,
        cursor: settlementCursor,
        adapter: fiberAdapter,
        maxRetries: config.settlementMaxRetries,
        retryDelayMs: config.settlementRetryDelayMs,
        pendingTimeoutMs: config.settlementPendingTimeoutMs,
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
        });
      }
      console.info("[worker] settlement strategy enabled", {
        strategy: "subscription",
        pollingFallback: true,
        subscriptionUrlConfigured: hasSettlementSubscriptionUrl,
        subscriptionConcurrency: config.subscriptionConcurrency,
        maxPendingEvents: config.subscriptionMaxPendingEvents,
        recentInvoiceDedupeSize: config.subscriptionRecentInvoiceDedupeSize,
      });
    } catch (error) {
      console.error("[worker] settlement subscription startup failed; continuing with polling fallback", error);
    }
  } else {
    console.info("[worker] settlement strategy enabled", {
      strategy: "polling",
      pollingFallback: false,
    });
  }

  async function shutdown(signal: NodeJS.Signals) {
    await subscriptionRunner?.close();
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
