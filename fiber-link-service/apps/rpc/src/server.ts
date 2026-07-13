import Fastify from "fastify";
import { registerRpc } from "./rpc";

const VALID_LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

// JSON-RPC payloads here are small (tip.create with a message is a few KB), so
// 256 KiB is generous while still bounding hostile bodies well below the
// fastify default of 1 MiB.
const DEFAULT_BODY_LIMIT_BYTES = 262_144;
// Time allowed for a client to deliver the complete request (headers + body).
// This does not bound response duration, so long-lived SSE responses on
// /rpc/stream are unaffected.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type RpcServerConfig = {
  logLevel: string;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  trustProxy: boolean | string | number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * RPC_TRUST_PROXY accepts fastify's trustProxy shapes: "true"/"false" style
 * booleans, a bare integer hop count, or an address/CIDR list passed through
 * verbatim. Unset keeps the current behavior (proxies not trusted).
 */
export function parseTrustProxy(raw: string | undefined): boolean | string | number {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  if (lowered === "true" || lowered === "yes" || lowered === "on") return true;
  if (lowered === "false" || lowered === "no" || lowered === "off") return false;
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function parseRpcServerConfig(env: NodeJS.ProcessEnv = process.env): RpcServerConfig {
  const rawLevel = env.RPC_LOG_LEVEL?.trim().toLowerCase();
  return {
    logLevel: rawLevel && VALID_LOG_LEVELS.has(rawLevel) ? rawLevel : "info",
    bodyLimitBytes: parsePositiveInt(env.RPC_BODY_LIMIT_BYTES, DEFAULT_BODY_LIMIT_BYTES),
    requestTimeoutMs: parsePositiveInt(env.RPC_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    trustProxy: parseTrustProxy(env.RPC_TRUST_PROXY),
  };
}

export function buildServer(config: RpcServerConfig = parseRpcServerConfig()) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Defense in depth: the default request serializer does not emit headers,
      // but if a future serializer or ad-hoc log call includes them, the
      // credential-bearing ones must never reach the log stream.
      redact: {
        paths: [
          "req.headers.authorization",
          'req.headers["x-signature"]',
          "headers.authorization",
          'headers["x-signature"]',
        ],
        censor: "[redacted]",
      },
    },
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    trustProxy: config.trustProxy,
  });

  app.decorateRequest("rawBody", "");

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const rawBody = body as string;
    req.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      (error as Error & { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  registerRpc(app);
  return app;
}
