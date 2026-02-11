import { createWorkerRuntime } from "./worker-runtime";

const withdrawalIntervalMs = Number(process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? "30000");
const maxRetries = Number(process.env.WORKER_MAX_RETRIES ?? "3");
const retryDelayMs = Number(process.env.WORKER_RETRY_DELAY_MS ?? "60000");
const shutdownTimeoutMs = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "15000");

if (!Number.isInteger(withdrawalIntervalMs) || withdrawalIntervalMs <= 0) {
  throw new Error(`Invalid WORKER_WITHDRAWAL_INTERVAL_MS: ${process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? ""}`);
}
if (!Number.isInteger(maxRetries) || maxRetries < 0) {
  throw new Error(`Invalid WORKER_MAX_RETRIES: ${process.env.WORKER_MAX_RETRIES ?? ""}`);
}
if (!Number.isInteger(retryDelayMs) || retryDelayMs <= 0) {
  throw new Error(`Invalid WORKER_RETRY_DELAY_MS: ${process.env.WORKER_RETRY_DELAY_MS ?? ""}`);
}
if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
  throw new Error(`Invalid WORKER_SHUTDOWN_TIMEOUT_MS: ${process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? ""}`);
}

const runtime = createWorkerRuntime({
  intervalMs: withdrawalIntervalMs,
  maxRetries,
  retryDelayMs,
  shutdownTimeoutMs,
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
