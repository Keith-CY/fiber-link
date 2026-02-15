import type { FastifyInstance } from "fastify";
import { TipIntentNotFoundError, createDbClient } from "@fiber-link/db";
import { verifyHmac } from "./auth/hmac";
import {
  RpcErrorCode,
  RpcIdSchema,
  RpcRequestSchema,
  TipCreateParamsSchema,
  TipCreateResultSchema,
  TipStatusParamsSchema,
  TipStatusResultSchema,
  type RpcId,
} from "./contracts";
import { handleTipCreate, handleTipStatus } from "./methods/tip";
import { createNonceStore } from "./nonce-store";
import { type AppRepo, createDbAppRepo } from "./repositories/app-repo";
import { rpcErrorResponse, rpcResultResponse } from "./rpc-error";
import { loadSecretMap, resolveSecretForApp } from "./secret-map";

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

function extractRpcId(body: unknown): RpcId {
  if (!body || typeof body !== "object" || !("id" in body)) {
    return null;
  }
  const parsed = RpcIdSchema.safeParse((body as { id?: unknown }).id);
  return parsed.success ? parsed.data : null;
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
        return reply
          .status(500)
          .send(
            rpcErrorResponse(
              extractRpcId(body),
              RpcErrorCode.INTERNAL_ERROR,
              "Internal error: could not read raw request body.",
            ),
          );
      }
      const payload = rawBody;
      const appId = String(req.headers["x-app-id"] ?? "");
      const ts = String(req.headers["x-ts"] ?? "");
      const nonce = String(req.headers["x-nonce"] ?? "");
      const signature = String(req.headers["x-signature"] ?? "");

      const parsedRequest = RpcRequestSchema.safeParse(body);
      if (!parsedRequest.success) {
        return reply.send(rpcErrorResponse(null, RpcErrorCode.INVALID_REQUEST, "Invalid Request"));
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
        return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.UNAUTHORIZED, "Unauthorized"));
      }

      if (!isTimestampFresh(ts)) {
        return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.UNAUTHORIZED, "Unauthorized"));
      }

      // HMAC is always verified after resolving the secret with DB precedence over env secrets.
      if (!verifyHmac.check({ secret, payload, ts, nonce, signature })) {
        return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.UNAUTHORIZED, "Unauthorized"));
      }

      const isReplay = await nonceStore.isReplay(appId, nonce, NONCE_TTL_MS);
      if (isReplay) {
        return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.UNAUTHORIZED, "Unauthorized"));
      }

      if (rpc.method === "health.ping") {
        return reply.send(rpcResultResponse(rpc.id, { status: "ok" as const }));
      }
      if (rpc.method === "tip.create") {
        const parsed = TipCreateParamsSchema.safeParse(rpc.params);
        if (!parsed.success) {
          return reply.send(
            rpcErrorResponse(rpc.id, RpcErrorCode.INVALID_PARAMS, "Invalid params", parsed.error.issues),
          );
        }
        try {
          const result = await handleTipCreate({ ...parsed.data, appId });
          const validated = TipCreateResultSchema.safeParse(result);
          if (!validated.success) {
            req.log.error(validated.error, "tip.create produced invalid response payload");
            return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
          }
          return reply.send(rpcResultResponse(rpc.id, validated.data));
        } catch (error) {
          req.log.error(error);
          return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
        }
      }
      if (rpc.method === "tip.status" || rpc.method === "tip.get") {
        const parsed = TipStatusParamsSchema.safeParse(rpc.params);
        if (!parsed.success) {
          return reply.send(
            rpcErrorResponse(rpc.id, RpcErrorCode.INVALID_PARAMS, "Invalid params", parsed.error.issues),
          );
        }
        try {
          const result = await handleTipStatus({ ...parsed.data });
          const validated = TipStatusResultSchema.safeParse(result);
          if (!validated.success) {
            req.log.error(validated.error, "tip.status/tip.get produced invalid response payload");
            return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
          }
          return reply.send(rpcResultResponse(rpc.id, validated.data));
        } catch (error) {
          if (error instanceof TipIntentNotFoundError) {
            return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.TIP_NOT_FOUND, "Tip not found"));
          }
          req.log.error(error);
          return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
        }
      }

      return reply.send(rpcErrorResponse(rpc.id, RpcErrorCode.METHOD_NOT_FOUND, "Method not found"));
    } catch (error) {
      req.log.error(error);
      return reply.send(
        rpcErrorResponse(
          extractRpcId(req.body as unknown),
          RpcErrorCode.INTERNAL_ERROR,
          "Internal error",
        ),
      );
    }
  });
}
