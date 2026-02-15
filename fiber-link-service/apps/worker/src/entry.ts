import { createAdapter } from "@fiber-link/fiber-adapter";
import type { TipIntentListCursor } from "@fiber-link/db";
import { runSettlementDiscovery } from "./settlement-discovery";
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
if (!fiberRpcUrl) {
  throw new Error("FIBER_RPC_URL is required");
}

const fiberAdapter = createAdapter({ endpoint: fiberRpcUrl });
let settlementCursor: TipIntentListCursor | undefined;

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
    return summary;
  },
});

process.once("SIGINT", () => {
  void runtime.shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void runtime.shutdown("SIGTERM");
});

void runtime.start().catch((error) => {
  console.error("[worker] startup failed", error);
  process.exit(1);
});
