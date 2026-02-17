import { createAdapter } from "@fiber-link/fiber-adapter";
import type { TipIntentListCursor } from "@fiber-link/db";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";
import {
  startSettlementSubscriptionRunner,
  type SettlementSubscriptionRunner,
} from "./settlement-subscription-runner";
import { createWorkerRuntime } from "./worker-runtime";

const withdrawalIntervalMs = Number(process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? "30000");
const settlementIntervalMs = Number(process.env.WORKER_SETTLEMENT_INTERVAL_MS ?? "30000");
const settlementBatchSize = Number(process.env.WORKER_SETTLEMENT_BATCH_SIZE ?? "200");
const maxRetries = Number(process.env.WORKER_MAX_RETRIES ?? "3");
const retryDelayMs = Number(process.env.WORKER_RETRY_DELAY_MS ?? "60000");
const settlementMaxRetries = Number(process.env.WORKER_SETTLEMENT_MAX_RETRIES ?? String(maxRetries));
const settlementRetryDelayMs = Number(process.env.WORKER_SETTLEMENT_RETRY_DELAY_MS ?? String(retryDelayMs));
const settlementPendingTimeoutMs = Number(process.env.WORKER_SETTLEMENT_PENDING_TIMEOUT_MS ?? "1800000");
const shutdownTimeoutMs = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "15000");
const settlementStrategyRaw = (process.env.WORKER_SETTLEMENT_STRATEGY ?? "polling").trim().toLowerCase();
const settlementStrategy = settlementStrategyRaw as "polling" | "subscription";
const settlementCursorFile =
  process.env.WORKER_SETTLEMENT_CURSOR_FILE ?? "/var/lib/fiber-link/settlement-cursor.json";
const fiberRpcUrl = process.env.FIBER_RPC_URL;

if (!Number.isInteger(withdrawalIntervalMs) || withdrawalIntervalMs <= 0) {
  throw new Error(`Invalid WORKER_WITHDRAWAL_INTERVAL_MS: ${process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? ""}`);
}
if (!Number.isInteger(settlementIntervalMs) || settlementIntervalMs <= 0) {
  throw new Error(`Invalid WORKER_SETTLEMENT_INTERVAL_MS: ${process.env.WORKER_SETTLEMENT_INTERVAL_MS ?? ""}`);
}
if (!Number.isInteger(settlementBatchSize) || settlementBatchSize <= 0) {
  throw new Error(`Invalid WORKER_SETTLEMENT_BATCH_SIZE: ${process.env.WORKER_SETTLEMENT_BATCH_SIZE ?? ""}`);
}
if (!Number.isInteger(maxRetries) || maxRetries < 0) {
  throw new Error(`Invalid WORKER_MAX_RETRIES: ${process.env.WORKER_MAX_RETRIES ?? ""}`);
}
if (!Number.isInteger(retryDelayMs) || retryDelayMs <= 0) {
  throw new Error(`Invalid WORKER_RETRY_DELAY_MS: ${process.env.WORKER_RETRY_DELAY_MS ?? ""}`);
}
if (!Number.isInteger(settlementMaxRetries) || settlementMaxRetries < 0) {
  throw new Error(`Invalid WORKER_SETTLEMENT_MAX_RETRIES: ${process.env.WORKER_SETTLEMENT_MAX_RETRIES ?? ""}`);
}
if (!Number.isInteger(settlementRetryDelayMs) || settlementRetryDelayMs <= 0) {
  throw new Error(
    `Invalid WORKER_SETTLEMENT_RETRY_DELAY_MS: ${process.env.WORKER_SETTLEMENT_RETRY_DELAY_MS ?? ""}`,
  );
}
if (!Number.isInteger(settlementPendingTimeoutMs) || settlementPendingTimeoutMs <= 0) {
  throw new Error(
    `Invalid WORKER_SETTLEMENT_PENDING_TIMEOUT_MS: ${process.env.WORKER_SETTLEMENT_PENDING_TIMEOUT_MS ?? ""}`,
  );
}
if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
  throw new Error(`Invalid WORKER_SHUTDOWN_TIMEOUT_MS: ${process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? ""}`);
}
if (settlementStrategy !== "polling" && settlementStrategy !== "subscription") {
  throw new Error(`Invalid WORKER_SETTLEMENT_STRATEGY: ${process.env.WORKER_SETTLEMENT_STRATEGY ?? ""}`);
}
if (!fiberRpcUrl) {
  throw new Error("FIBER_RPC_URL is required");
}
if (!settlementCursorFile.trim()) {
  throw new Error("WORKER_SETTLEMENT_CURSOR_FILE must not be empty");
}

async function main() {
  const fiberAdapter = createAdapter({ endpoint: fiberRpcUrl });
  const cursorStore = createFileSettlementCursorStore(settlementCursorFile);
  let settlementCursor: TipIntentListCursor | undefined = await cursorStore.load();
  let subscriptionRunner: SettlementSubscriptionRunner | null = null;

  const runtime = createWorkerRuntime({
    intervalMs: Math.min(withdrawalIntervalMs, settlementIntervalMs),
    withdrawalIntervalMs,
    maxRetries,
    retryDelayMs,
    shutdownTimeoutMs,
    settlementIntervalMs,
    settlementBatchSize,
    pollSettlements: async ({ limit }) => {
      const summary = await runSettlementDiscovery({
        limit,
        cursor: settlementCursor,
        adapter: fiberAdapter,
        maxRetries: settlementMaxRetries,
        retryDelayMs: settlementRetryDelayMs,
        pendingTimeoutMs: settlementPendingTimeoutMs,
      });
      settlementCursor = summary.nextCursor ?? undefined;
      await cursorStore.save(settlementCursor);
      return summary;
    },
  });

  if (settlementStrategy === "subscription") {
    try {
      subscriptionRunner = await startSettlementSubscriptionRunner({
        adapter: fiberAdapter,
      });
      console.info("[worker] settlement strategy enabled", {
        strategy: "subscription",
        pollingFallback: true,
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
