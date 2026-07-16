import crypto from "node:crypto";
import { type Server, createServer } from "node:http";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { createComponentLogger } from "./logger";

const logger = createComponentLogger("worker-metrics");

// Dedicated registry so importing this module from tests never leaks
// process-wide collectors (same pattern as apps/rpc/src/metrics.ts).
export const workerMetricsRegistry = new Registry();

let defaultMetricsStarted = false;
export function ensureWorkerDefaultMetrics() {
  if (defaultMetricsStarted) return;
  defaultMetricsStarted = true;
  collectDefaultMetrics({ register: workerMetricsRegistry });
}

/**
 * Optional bearer token protecting GET /metrics, mirroring RPC_METRICS_TOKEN:
 * unset/blank keeps the endpoint open for network-isolated deployments; when
 * set, scrapes must send `Authorization: Bearer <token>`.
 */
export function parseWorkerMetricsToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.WORKER_METRICS_TOKEN?.trim();
  return raw ? raw : null;
}

/** Metrics are exposed only when WORKER_METRICS_PORT is set to a valid port. */
export function parseWorkerMetricsPort(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.WORKER_METRICS_PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`WORKER_METRICS_PORT must be an integer port, got: ${raw}`);
  }
  return port;
}

function timingSafeEquals(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

const MAX_AUTHORIZATION_HEADER_LENGTH = 500;

export function isWorkerMetricsRequestAuthorized(
  authorizationHeader: string | undefined,
  token: string | null,
): boolean {
  if (!token) return true;
  if (typeof authorizationHeader !== "string" || authorizationHeader.length > MAX_AUTHORIZATION_HEADER_LENGTH) {
    return false;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return false;
  return timingSafeEquals(match[1], token);
}

// --- Counters (incremented inline on the worker's hot paths) ---------------

export const settlementCreditedTotal = new Counter({
  name: "fiber_link_settlement_credited_total",
  help: "Tip settlements that applied a ledger credit (idempotent replays not counted).",
  registers: [workerMetricsRegistry],
});

export const settlementFailuresTotal = new Counter({
  name: "fiber_link_settlement_failures_total",
  help: "Tip settlements marked terminally failed, labeled by failure reason.",
  labelNames: ["reason"] as const,
  registers: [workerMetricsRegistry],
});

export const withdrawalFailuresTotal = new Counter({
  name: "fiber_link_withdrawal_failures_total",
  help: "Withdrawal executions that failed, labeled by classification (transient, permanent, timeout_recovery).",
  labelNames: ["kind"] as const,
  registers: [workerMetricsRegistry],
});

export const webhookDeliveryFailuresTotal = new Counter({
  name: "fiber_link_webhook_delivery_failures_total",
  help: "Webhook notification deliveries that exhausted all attempts without a 2xx response.",
  registers: [workerMetricsRegistry],
});

export const withdrawalBatchDuration = new Histogram({
  name: "fiber_link_withdrawal_batch_duration_seconds",
  help: "Wall-clock duration of one withdrawal batch run.",
  buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300],
  registers: [workerMetricsRegistry],
});

export function recordWebhookDeliveryFailure(): void {
  webhookDeliveryFailuresTotal.inc();
}

// --- Gauges (computed from the database at scrape time) ---------------------

/**
 * Data sources for the scrape-time gauges. Injected (rather than importing a
 * db client here) so tests can drive the gauges without Postgres and the
 * entrypoint controls which connection is used.
 */
export type WorkerMetricsSources = {
  countUnpaidBacklog(): Promise<number>;
  countSettlementRetryPending(): Promise<number>;
  countWithdrawalsByState(): Promise<Array<{ state: string; count: number }>>;
  countNegativeBalanceAccounts(): Promise<number>;
};

let metricsSources: WorkerMetricsSources | null = null;

export function configureWorkerMetricsSources(sources: WorkerMetricsSources | null): void {
  metricsSources = sources;
}

const settlementBacklogUnpaid = new Gauge({
  name: "fiber_link_settlement_backlog_unpaid",
  help: "Tip intents currently in invoice state UNPAID.",
  registers: [workerMetricsRegistry],
  async collect() {
    if (!metricsSources) return;
    this.set(await metricsSources.countUnpaidBacklog());
  },
});

const settlementRetryPending = new Gauge({
  name: "fiber_link_settlement_retry_pending",
  help: "UNPAID tip intents waiting on a scheduled settlement retry.",
  registers: [workerMetricsRegistry],
  async collect() {
    if (!metricsSources) return;
    this.set(await metricsSources.countSettlementRetryPending());
  },
});

const withdrawalStateCount = new Gauge({
  name: "fiber_link_withdrawal_state_count",
  help: "Current number of withdrawals per state.",
  labelNames: ["state"] as const,
  registers: [workerMetricsRegistry],
  async collect() {
    if (!metricsSources) return;
    const rows = await metricsSources.countWithdrawalsByState();
    this.reset();
    for (const row of rows) {
      this.set({ state: row.state }, row.count);
    }
  },
});

const ledgerNegativeBalanceAccounts = new Gauge({
  name: "fiber_link_ledger_negative_balance_accounts",
  help: "Accounts (app, user, asset) whose ledger balance sums below zero. Any value above 0 is an accounting anomaly.",
  registers: [workerMetricsRegistry],
  async collect() {
    if (!metricsSources) return;
    this.set(await metricsSources.countNegativeBalanceAccounts());
  },
});

// Referenced so the gauges are not tree-shaken / flagged as unused; their real
// work happens in collect() during a scrape.
export const workerGauges = {
  settlementBacklogUnpaid,
  settlementRetryPending,
  withdrawalStateCount,
  ledgerNegativeBalanceAccounts,
};

// --- HTTP exposition ---------------------------------------------------------

export type WorkerMetricsServerOptions = {
  port: number;
  token: string | null;
};

/** Minimal HTTP server exposing GET /metrics; anything else is 404. */
export function startWorkerMetricsServer(options: WorkerMetricsServerOptions): Server {
  ensureWorkerDefaultMetrics();
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || (req.url ?? "").split("?")[0] !== "/metrics") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (!isWorkerMetricsRequestAuthorized(req.headers.authorization, options.token)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    try {
      const body = await workerMetricsRegistry.metrics();
      res.writeHead(200, { "content-type": workerMetricsRegistry.contentType });
      res.end(body);
    } catch (error) {
      logger.error("worker.metrics_scrape_failed", { error });
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("scrape failed");
    }
  });
  server.listen(options.port, () => {
    const address = server.address();
    logger.info("worker.metrics_server_listening", {
      port: typeof address === "object" && address ? address.port : options.port,
      tokenProtected: Boolean(options.token),
    });
  });
  return server;
}
