import { createAdapter } from "@fiber-link/fiber-adapter";
import type { TipIntentListCursor } from "@fiber-link/db";
import { parseWorkerConfig } from "./config";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";
import {
  startSettlementSubscriptionRunner,
  type SettlementSubscriptionRunner,
} from "./settlement-subscription-runner";
import { createWorkerRuntime } from "./worker-runtime";

async function main() {
  const config = parseWorkerConfig(process.env);
  const fiberAdapter = createAdapter({ endpoint: config.fiberRpcUrl });
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
    try {
      subscriptionRunner = await startSettlementSubscriptionRunner({
        adapter: fiberAdapter,
        concurrency: config.subscriptionConcurrency,
        maxPendingEvents: config.subscriptionMaxPendingEvents,
        recentInvoiceDedupeSize: config.subscriptionRecentInvoiceDedupeSize,
      });
      console.info("[worker] settlement strategy enabled", {
        strategy: "subscription",
        pollingFallback: true,
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
