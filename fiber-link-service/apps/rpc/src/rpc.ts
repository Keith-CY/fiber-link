import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDbClient } from "@fiber-link/db";
import { verifyHmac } from "./auth/hmac";
import { handleTipCreate } from "./methods/tip";
import { createNonceStore } from "./nonce-store";
import { type AppRepo, createDbAppRepo } from "./repositories/app-repo";
import { loadSecretMap, resolveSecretForApp } from "./secret-map";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const TipCreateSchema = z.object({
  postId: z.string().min(1),
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  asset: z.enum(["CKB", "USDI"]),
  amount: z.string().min(1),
});

const NONCE_TTL_MS = 5 * 60 * 1000;
const nonceStore = createNonceStore();
const secretMap = loadSecretMap();

let defaultAppRepo: AppRepo | null | undefined;

function getDefaultAppRepo(): AppRepo | null {
  if (defaultAppRepo !== undefined) {
    return defaultAppRepo;
  }
  try {
    defaultAppRepo = createDbAppRepo(createDbClient());
  } catch (error) {
    console.error("Failed to initialize default AppRepo, RPC will fall back to env secrets.", error);
    defaultAppRepo = null;
  }
  return defaultAppRepo;
}

function isTimestampFresh(ts: string) {
  const numeric = Number(ts);
  if (!Number.isFinite(numeric)) return false;
  const delta = Math.abs(Date.now() - numeric * 1000);
  return delta <= NONCE_TTL_MS;
}

function getFallbackSecret() {
  return process.env.FIBER_LINK_HMAC_SECRET ?? "";
}

type HealthProbeStatus = {
  status: "ok" | "error";
  message?: string;
};

type ReadinessChecks = {
  database: HealthProbeStatus;
  redis: HealthProbeStatus;
  coreService: HealthProbeStatus;
};

type ReadinessProbeResult = {
  ready: boolean;
  checks: ReadinessChecks;
};

type ReadinessProbeFn = () => Promise<ReadinessProbeResult>;

function getHealthcheckTimeoutMs() {
  const parsed = Number(process.env.RPC_HEALTHCHECK_TIMEOUT_MS ?? "3000");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3000;
  }
  return Math.floor(parsed);
}

async function runDefaultReadinessProbe(appRepo: AppRepo | null): Promise<ReadinessProbeResult> {
  const checks: ReadinessChecks = {
    database: { status: "error", message: "not checked" },
    redis: { status: "error", message: "not checked" },
    coreService: { status: "error", message: "not checked" },
  };

  try {
    if (!appRepo) {
      throw new Error("AppRepo unavailable (DATABASE_URL missing or initialization failed)");
    }
    await appRepo.findByAppId("__healthz_probe__");
    checks.database = { status: "ok" };
  } catch (error) {
    checks.database = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const nonce = `healthz-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await nonceStore.isReplay("__healthz_probe__", nonce, 1000);
    checks.redis = { status: "ok" };
  } catch (error) {
    checks.redis = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const endpoint = process.env.FIBER_RPC_URL;
    if (!endpoint) {
      throw new Error("FIBER_RPC_URL is not configured");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getHealthcheckTimeoutMs());
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"id":"healthz","jsonrpc":"2.0","method":"ping","params":[]}',
        signal: controller.signal,
      });
      if (response.status >= 500) {
        throw new Error(`core service returned HTTP ${response.status}`);
      }
      checks.coreService = { status: "ok" };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    checks.coreService = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const ready = Object.values(checks).every((entry) => entry.status === "ok");
  return { ready, checks };
}

export function registerRpc(
  app: FastifyInstance,
  options: { appRepo?: AppRepo; readinessProbe?: ReadinessProbeFn } = {},
) {
  app.get("/healthz/live", async () => {
    return { status: "alive" as const };
  });

  app.get("/healthz/ready", async (req, reply) => {
    try {
      const result = options.readinessProbe
        ? await options.readinessProbe()
        : await runDefaultReadinessProbe(options.appRepo ?? getDefaultAppRepo());

      if (!result.ready) {
        return reply.status(503).send({ status: "not_ready", checks: result.checks });
      }
      return reply.send({ status: "ready", checks: result.checks });
    } catch (error) {
      req.log.error(error, "readiness probe failed unexpectedly");
      return reply.status(503).send({
        status: "not_ready",
        checks: {
          database: { status: "error", message: "probe failure" },
          redis: { status: "error", message: "probe failure" },
          coreService: { status: "error", message: "probe failure" },
        },
      });
    }
  });

  app.post("/rpc", async (req, reply) => {
    try {
      const body = req.body as unknown;
      const rawBody = req.rawBody;
      if (!rawBody) {
        return reply.status(500).send({
          jsonrpc: "2.0",
          id: (body as RpcRequest | undefined)?.id ?? null,
          error: { code: -32603, message: "Internal error: could not read raw request body." },
        });
      }
      const payload = rawBody;
      const appId = String(req.headers["x-app-id"] ?? "");
      const ts = String(req.headers["x-ts"] ?? "");
      const nonce = String(req.headers["x-nonce"] ?? "");
      const signature = String(req.headers["x-signature"] ?? "");

      const parsedRequest = RpcRequestSchema.safeParse(body);
      if (!parsedRequest.success) {
        return reply.send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request" },
        });
      }
      const rpc = parsedRequest.data;

      const appRepo = options.appRepo ?? getDefaultAppRepo();
      let secret = "";
      if (appRepo) {
        secret = await resolveSecretForApp(appId, {
            appRepo,
            envSecretMap: secretMap,
            envFallbackSecret: getFallbackSecret(),
            onResolve: ({ source }) => {
              if (source !== "db") {
                req.log.info({ appId, source }, "RPC secret resolved by fallback source");
              }
            },
          });
      } else {
        const fromMap = secretMap?.[appId];
        const fallback = getFallbackSecret();
        secret = fromMap ?? fallback;

        const source = fromMap ? "env_map" : fallback ? "env_fallback" : "missing";
        req.log.info({ appId, source }, "RPC secret resolved by fallback source");
      }

      if (!appId || !ts || !nonce || !signature || !secret) {
        return reply.send({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32001, message: "Unauthorized" },
        });
      }

      if (!isTimestampFresh(ts)) {
        return reply.send({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32001, message: "Unauthorized" },
        });
      }

      // HMAC is always verified after resolving the secret with DB precedence over env secrets.
      if (!verifyHmac.check({ secret, payload, ts, nonce, signature })) {
        return reply.send({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32001, message: "Unauthorized" },
        });
      }

      const isReplay = await nonceStore.isReplay(appId, nonce, NONCE_TTL_MS);
      if (isReplay) {
        return reply.send({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32001, message: "Unauthorized" },
        });
      }

      if (rpc.method === "health.ping") {
        return reply.send({ jsonrpc: "2.0", id: rpc.id, result: { status: "ok" } });
      }
      if (rpc.method === "tip.create") {
        const parsed = TipCreateSchema.safeParse(rpc.params);
        if (!parsed.success) {
          return reply.send({
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32602, message: "Invalid params", data: parsed.error.issues },
          });
        }
        try {
          const result = await handleTipCreate({ ...parsed.data, appId });
          return reply.send({ jsonrpc: "2.0", id: rpc.id, result });
        } catch (error) {
          req.log.error(error);
          return reply.send({
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32603, message: "Internal error" },
          });
        }
      }

      return reply.send({
        jsonrpc: "2.0",
        id: rpc.id,
        error: { code: -32601, message: "Method not found" },
      });
    } catch (error) {
      req.log.error(error);
      return reply.send({
        jsonrpc: "2.0",
        id: (req.body as RpcRequest | null | undefined)?.id ?? null,
        error: { code: -32603, message: "Internal error" },
      });
    }
  });
}
