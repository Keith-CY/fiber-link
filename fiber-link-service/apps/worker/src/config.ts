export type WorkerSettlementStrategy = "polling" | "subscription";

export type WorkerConfig = {
  withdrawalIntervalMs: number;
  settlementIntervalMs: number;
  settlementBatchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  settlementMaxRetries: number;
  settlementRetryDelayMs: number;
  settlementPendingTimeoutMs: number;
  shutdownTimeoutMs: number;
  settlementStrategy: WorkerSettlementStrategy;
  settlementCursorFile: string;
  fiberRpcUrl: string;
  subscriptionConcurrency: number;
  subscriptionMaxPendingEvents: number;
  subscriptionRecentInvoiceDedupeSize: number;
};

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${name}: expected integer >= ${min}`);
  }
  return value;
}

function parseStrategy(env: NodeJS.ProcessEnv): WorkerSettlementStrategy {
  const raw = (env.WORKER_SETTLEMENT_STRATEGY ?? "subscription").trim().toLowerCase();
  if (raw === "polling" || raw === "subscription") {
    return raw;
  }
  throw new Error(
    `Invalid WORKER_SETTLEMENT_STRATEGY: expected one of polling, subscription, received "${raw}"`,
  );
}

export function parseWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const withdrawalIntervalMs = parseInteger(env, "WORKER_WITHDRAWAL_INTERVAL_MS", 30_000, 1);
  const settlementIntervalMs = parseInteger(env, "WORKER_SETTLEMENT_INTERVAL_MS", 30_000, 1);
  const settlementBatchSize = parseInteger(env, "WORKER_SETTLEMENT_BATCH_SIZE", 200, 1);
  const maxRetries = parseInteger(env, "WORKER_MAX_RETRIES", 3, 0);
  const retryDelayMs = parseInteger(env, "WORKER_RETRY_DELAY_MS", 60_000, 1);
  const settlementMaxRetries = parseInteger(
    env,
    "WORKER_SETTLEMENT_MAX_RETRIES",
    maxRetries,
    0,
  );
  const settlementRetryDelayMs = parseInteger(
    env,
    "WORKER_SETTLEMENT_RETRY_DELAY_MS",
    retryDelayMs,
    1,
  );
  const settlementPendingTimeoutMs = parseInteger(
    env,
    "WORKER_SETTLEMENT_PENDING_TIMEOUT_MS",
    30 * 60_000,
    1,
  );
  const shutdownTimeoutMs = parseInteger(env, "WORKER_SHUTDOWN_TIMEOUT_MS", 15_000, 1);
  const settlementStrategy = parseStrategy(env);
  const settlementCursorFile = (env.WORKER_SETTLEMENT_CURSOR_FILE ?? "/var/lib/fiber-link/settlement-cursor.json")
    .trim();
  const fiberRpcUrl = (env.FIBER_RPC_URL ?? "").trim();
  const subscriptionConcurrency = parseInteger(
    env,
    "WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY",
    1,
    1,
  );
  const subscriptionMaxPendingEvents = parseInteger(
    env,
    "WORKER_SETTLEMENT_SUBSCRIPTION_MAX_PENDING_EVENTS",
    1000,
    0,
  );
  const subscriptionRecentInvoiceDedupeSize = parseInteger(
    env,
    "WORKER_SETTLEMENT_SUBSCRIPTION_RECENT_INVOICE_DEDUPE_SIZE",
    256,
    0,
  );

  if (!fiberRpcUrl) {
    throw new Error("FIBER_RPC_URL is required");
  }
  if (!settlementCursorFile) {
    throw new Error("WORKER_SETTLEMENT_CURSOR_FILE must not be empty");
  }

  return {
    withdrawalIntervalMs,
    settlementIntervalMs,
    settlementBatchSize,
    maxRetries,
    retryDelayMs,
    settlementMaxRetries,
    settlementRetryDelayMs,
    settlementPendingTimeoutMs,
    shutdownTimeoutMs,
    settlementStrategy,
    settlementCursorFile,
    fiberRpcUrl,
    subscriptionConcurrency,
    subscriptionMaxPendingEvents,
    subscriptionRecentInvoiceDedupeSize,
  };
}
