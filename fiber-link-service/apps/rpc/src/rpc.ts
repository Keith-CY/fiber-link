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
  } catch {
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

export function registerRpc(app: FastifyInstance, options: { appRepo?: AppRepo } = {}) {
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
      const secret = appRepo
        ? await resolveSecretForApp(appId, {
            appRepo,
            envSecretMap: secretMap,
            envFallbackSecret: getFallbackSecret(),
            onResolve: ({ source }) => {
              if (source !== "db") {
                req.log.info({ appId, source }, "RPC secret resolved by fallback source");
              }
            },
          })
        : secretMap?.[appId] ?? getFallbackSecret();

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

      // TODO: replace env map with per-app DB lookup
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
