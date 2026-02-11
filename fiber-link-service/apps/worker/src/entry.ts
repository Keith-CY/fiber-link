import { runWithdrawalBatch } from "./withdrawal-batch";

const withdrawalIntervalMs = Number(process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? "30000");
const maxRetries = Number(process.env.WORKER_MAX_RETRIES ?? "3");
const retryDelayMs = Number(process.env.WORKER_RETRY_DELAY_MS ?? "60000");

if (!Number.isInteger(withdrawalIntervalMs) || withdrawalIntervalMs <= 0) {
  throw new Error(`Invalid WORKER_WITHDRAWAL_INTERVAL_MS: ${process.env.WORKER_WITHDRAWAL_INTERVAL_MS ?? ""}`);
}
if (!Number.isInteger(maxRetries) || maxRetries < 0) {
  throw new Error(`Invalid WORKER_MAX_RETRIES: ${process.env.WORKER_MAX_RETRIES ?? ""}`);
}
if (!Number.isInteger(retryDelayMs) || retryDelayMs <= 0) {
  throw new Error(`Invalid WORKER_RETRY_DELAY_MS: ${process.env.WORKER_RETRY_DELAY_MS ?? ""}`);
}

let timer: ReturnType<typeof setInterval> | null = null;

async function processWithdrawals() {
  try {
    const result = await runWithdrawalBatch({
      maxRetries,
      retryDelayMs,
    });
    console.log("[worker] withdrawal batch", result);
  } catch (error) {
    console.error("[worker] withdrawal batch failed", error);
  }
}

async function main() {
  await processWithdrawals();
  timer = setInterval(() => {
    void processWithdrawals();
  }, withdrawalIntervalMs);
  console.log("[worker] started", {
    withdrawalIntervalMs,
    maxRetries,
    retryDelayMs,
  });
}

function shutdown() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void main().catch((error) => {
  console.error("[worker] startup failed", error);
  process.exit(1);
});
