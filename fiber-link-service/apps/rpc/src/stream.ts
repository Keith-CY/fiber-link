import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { createDbClient, createDbTipIntentRepo, TipIntentNotFoundError } from "@fiber-link/db";

const STREAM_TIMEOUT_MS = 60_000;

function getRedisUrl(): string | null {
  return process.env.FIBER_LINK_NONCE_REDIS_URL ?? process.env.REDIS_URL ?? null;
}

// Singleton DB to avoid a new connection pool per SSE request.
let defaultDb: ReturnType<typeof createDbClient> | null = null;
function getDefaultDb() {
  if (!defaultDb) defaultDb = createDbClient();
  return defaultDb;
}

// Shared subscriber connection with per-channel listener dispatch, so we open
// one Redis connection regardless of how many concurrent SSE connections exist.
let sharedRedis: Redis | null = null;
const channelListeners = new Map<string, Set<(msg: string) => void>>();

function getOrCreateSharedRedis(redisUrl: string): Redis {
  if (!sharedRedis) {
    sharedRedis = new Redis(redisUrl, { lazyConnect: false });
    sharedRedis.on("message", (ch: string, msg: string) => {
      channelListeners.get(ch)?.forEach((fn) => fn(msg));
    });
    sharedRedis.on("error", () => {}); // ioredis reconnects automatically; avoid crash on transient errors
  }
  return sharedRedis;
}

/**
 * Close the shared subscriber connection and drop all channel listeners.
 * Wired into fastify's onClose so a graceful shutdown does not leave the
 * process pinned by the singleton Redis connection. Idempotent; the next
 * stream request after a close lazily recreates the connection.
 */
export async function closeSharedStreamResources(): Promise<void> {
  channelListeners.clear();
  if (sharedRedis) {
    const redis = sharedRedis;
    sharedRedis = null;
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
}

async function addChannelListener(sub: Redis, channel: string, fn: (msg: string) => void) {
  let set = channelListeners.get(channel);
  if (!set) {
    set = new Set();
    channelListeners.set(channel, set);
    await sub.subscribe(channel);
  }
  set.add(fn);
}

function removeChannelListener(sub: Redis, channel: string, fn: (msg: string) => void) {
  const set = channelListeners.get(channel);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) {
    channelListeners.delete(channel);
    sub.unsubscribe(channel).catch(() => {});
  }
}

const POLL_INTERVAL_MS = 800;

const DEFAULT_MAX_CONNECTIONS = 200;
const DEFAULT_MAX_CONNECTIONS_PER_APP = 20;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Like parsePositiveIntEnv but allows 0 (used to disable the heartbeat).
function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export type StreamInvoiceRecord = { invoiceState: string; appId: string };

export function registerStreamRoute(
  app: FastifyInstance,
  options: {
    getInvoice?: (invoice: string) => Promise<StreamInvoiceRecord | null>;
    pollInvoiceStateFn?: (invoice: string) => Promise<string | null>;
    pollIntervalMs?: number;
    createSubscriber?: (redisUrl: string) => Redis;
    timeoutMs?: number;
    maxConnections?: number;
    maxConnectionsPerApp?: number;
    corsOrigin?: string;
    heartbeatIntervalMs?: number;
  } = {},
) {
  // Release the shared subscriber when the server shuts down gracefully.
  app.addHook("onClose", async () => {
    await closeSharedStreamResources();
  });

  const maxConnections = options.maxConnections ?? parsePositiveIntEnv("RPC_STREAM_MAX_CONNECTIONS", DEFAULT_MAX_CONNECTIONS);
  const maxConnectionsPerApp =
    options.maxConnectionsPerApp ?? parsePositiveIntEnv("RPC_STREAM_MAX_CONNECTIONS_PER_APP", DEFAULT_MAX_CONNECTIONS_PER_APP);
  const corsOrigin = options.corsOrigin ?? (process.env.RPC_STREAM_CORS_ORIGIN?.trim() || "*");
  // Periodic SSE comment lines keep the connection alive through reverse
  // proxies / load balancers that close idle connections; 0 disables it.
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? parseNonNegativeIntEnv("RPC_STREAM_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_INTERVAL_MS);

  // Long-lived SSE connections pin a response, a channel listener, and (on the
  // fallback path) a poll timer for up to a minute each, so bound them globally
  // and per app. Counters are scoped to this registration.
  let activeConnections = 0;
  const activePerApp = new Map<string, number>();

  function tryAcquireStreamSlot(appId: string): (() => void) | null {
    const appActive = activePerApp.get(appId) ?? 0;
    if (activeConnections >= maxConnections || appActive >= maxConnectionsPerApp) {
      return null;
    }
    activeConnections += 1;
    activePerApp.set(appId, appActive + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeConnections -= 1;
      const current = activePerApp.get(appId) ?? 1;
      if (current <= 1) {
        activePerApp.delete(appId);
      } else {
        activePerApp.set(appId, current - 1);
      }
    };
  }
  const getInvoice =
    options.getInvoice ??
    (async (invoice: string): Promise<StreamInvoiceRecord | null> => {
      try {
        const repo = createDbTipIntentRepo(getDefaultDb());
        const intent = await repo.findByInvoiceOrThrow(invoice);
        return { invoiceState: intent.invoiceState, appId: intent.appId };
      } catch (e) {
        if (e instanceof TipIntentNotFoundError) return null;
        throw e;
      }
    });

  // Duplicate query params arrive as arrays; take the first value.
  function firstValue(value: string | string[] | undefined): string {
    return (Array.isArray(value) ? value[0] : value) ?? "";
  }

  app.get("/rpc/stream", async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | string[]>;
    const invoice = firstValue(query.invoice).trim();
    if (!invoice) {
      return reply.status(400).send({ error: "Missing invoice" });
    }

    // Server-side proxies identify via the x-app-id header; browser EventSource
    // clients cannot set headers, so the appId query param is the fallback.
    const requesterAppId = (
      firstValue(req.headers["x-app-id"]) || firstValue(query.appId)
    ).trim();
    if (!requesterAppId) {
      return reply.status(401).send({ error: "Missing app id" });
    }

    const releaseSlot = tryAcquireStreamSlot(requesterAppId);
    if (!releaseSlot) {
      return reply.status(429).send({ error: "Too many concurrent streams" });
    }

    // finally guarantees the slot is released on every path, including
    // exceptions thrown during setup; the long-lived path only returns after
    // the response closes, so release timing matches connection lifetime.
    try {
      let intent: StreamInvoiceRecord | null;
      try {
        intent = await getInvoice(invoice);
      } catch {
        return reply.status(503).send({ error: "Stream temporarily unavailable" });
      }

      if (intent === null) {
        return reply.status(404).send({ error: "Invoice not found" });
      }

      if (intent.appId !== requesterAppId) {
        return reply.status(403).send({ error: "Invoice does not belong to this app" });
      }

      const currentState = intent.invoiceState;

      if (currentState === "SETTLED") {
        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("Access-Control-Allow-Origin", corsOrigin);
        reply.raw.write(`data: ${JSON.stringify({ invoice, status: "SETTLED" })}\n\n`);
        reply.raw.end();
        return;
      }

      const redisUrl = getRedisUrl();
      if (!redisUrl && !options.createSubscriber) {
        return reply.status(503).send({ error: "Stream unavailable: no Redis" });
      }

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Access-Control-Allow-Origin", corsOrigin);

      const channel = `fiber-link:settlement:${invoice}`;

      // Tests inject createSubscriber for a per-request mock; production uses the shared singleton.
      const useShared = !options.createSubscriber;
      const sub = useShared
        ? getOrCreateSharedRedis(redisUrl ?? "")
        : options.createSubscriber!(redisUrl ?? "");

      let finished = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      function startHeartbeat() {
        if (finished || heartbeatIntervalMs <= 0) return;
        heartbeatTimer = setInterval(() => {
          if (finished || reply.raw.writableEnded || reply.raw.destroyed) return;
          // The timer fires outside Fastify's request lifecycle, so a synchronous
          // write() throw (e.g. ERR_STREAM_DESTROYED on an abruptly closed socket)
          // would become an uncaught exception. Guard and finish() instead.
          try {
            // SSE comment line: ignored by clients, but resets proxy idle timers.
            reply.raw.write(`: heartbeat\n\n`);
          } catch {
            finish();
          }
        }, heartbeatIntervalMs);
      }

      function messageHandler(raw: string) {
        if (finished) return;
        try {
          const payload = JSON.parse(raw);
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
          if (payload.status === "SETTLED") {
            clearTimeout(timeout);
            finish();
          }
        } catch {
          // malformed message — ignore
        }
      }

      function finish() {
        if (finished) return;
        finished = true;
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (useShared) {
          removeChannelListener(sub, channel, messageHandler);
        } else {
          sub.unsubscribe(channel).catch(() => {});
          sub.disconnect();
        }
        if (!reply.raw.writableEnded) reply.raw.end();
      }

      function schedulePoll() {
        if (finished || !options.pollInvoiceStateFn) return;
        const intervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
        pollTimer = setTimeout(async () => {
          if (finished) return;
          try {
            const state = await options.pollInvoiceStateFn!(invoice);
            if (!finished && state === "SETTLED") {
              clearTimeout(timeout);
              reply.raw.write(`data: ${JSON.stringify({ invoice, status: "SETTLED" })}\n\n`);
              finish();
              return;
            }
          } catch {
            // poll failure is non-fatal; Redis path remains active
          }
          schedulePoll();
        }, intervalMs);
      }

      const timeout = setTimeout(() => {
        if (!finished) {
          reply.raw.write(`data: ${JSON.stringify({ invoice, status: "TIMEOUT" })}\n\n`);
          finish();
        }
      }, options.timeoutMs ?? STREAM_TIMEOUT_MS);

      reply.raw.on("close", () => {
        clearTimeout(timeout);
        finish();
      });

      if (useShared) {
        try {
          await addChannelListener(sub, channel, messageHandler);
          reply.raw.write(`data: ${JSON.stringify({ invoice, status: "LISTENING" })}\n\n`);
          schedulePoll();
          startHeartbeat();
        } catch {
          clearTimeout(timeout);
          finish();
        }
      } else {
        sub.on("error", () => {
          clearTimeout(timeout);
          finish();
        });

        sub.subscribe(channel, (err) => {
          if (err) {
            clearTimeout(timeout);
            finish();
            return;
          }
          reply.raw.write(`data: ${JSON.stringify({ invoice, status: "LISTENING" })}\n\n`);
          schedulePoll();
          startHeartbeat();
        });

        sub.on("message", (_ch: string, raw: string) => {
          messageHandler(raw);
        });
      }

      await new Promise<void>((resolve) => {
        reply.raw.on("finish", resolve);
        reply.raw.on("error", resolve);
        reply.raw.on("close", resolve);
      });
    } finally {
      releaseSlot();
    }
  });
}
