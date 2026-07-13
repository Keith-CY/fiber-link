import { Counter, Registry, collectDefaultMetrics } from "prom-client";

// A dedicated registry (rather than the global default) keeps metrics isolated
// and makes the module safe to import from tests without leaking process-wide
// collectors.
export const metricsRegistry = new Registry();

let defaultMetricsStarted = false;
// Called lazily from the /metrics handler so importing this module (e.g. from
// unit tests) doesn't start collectDefaultMetrics' background timers.
export function ensureDefaultMetrics() {
  if (defaultMetricsStarted) return;
  defaultMetricsStarted = true;
  collectDefaultMetrics({ register: metricsRegistry });
}

// Known RPC method names, so the `method` label has bounded cardinality even if
// a client sends an unrecognized method (bucketed as "unknown").
const KNOWN_RPC_METHODS = new Set<string>([
  "health.ping",
  "tip.create",
  "tip.status",
  "tip.get",
  "tip.settled_feed",
  "dashboard.summary",
  "dashboard.analytics",
  "withdrawal.quote",
  "withdrawal.request",
  "notification.channel.create",
  "notification.channel.list",
]);

export function normalizeMethodLabel(method: unknown): string {
  return typeof method === "string" && KNOWN_RPC_METHODS.has(method) ? method : "unknown";
}

export const rpcRequestsTotal = new Counter({
  name: "fiber_link_rpc_requests_total",
  help: "Total RPC requests dispatched, labeled by method (bounded set; unknown methods bucketed).",
  labelNames: ["method"] as const,
  registers: [metricsRegistry],
});

// Requests authenticated through a non-DB HMAC secret source. env_fallback in
// particular is a shared secret that cannot distinguish apps, so a rising rate
// here is an operational signal to migrate to per-app secrets.
export const hmacSecretSourceTotal = new Counter({
  name: "fiber_link_rpc_hmac_secret_source_total",
  help: "RPC auth attempts by HMAC secret source (db, env_map, env_fallback, missing).",
  labelNames: ["source"] as const,
  registers: [metricsRegistry],
});
