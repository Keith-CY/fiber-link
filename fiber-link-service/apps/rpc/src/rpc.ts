import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyHmac } from "./auth/hmac";
import { handleTipCreate } from "./methods/tip";
import { createNonceStore } from "./nonce-store";
import { loadSecretMap } from "./secret-map";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

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

function getSecretForApp(appId: string) {
  if (secretMap) return secretMap[appId] ?? "";
  return process.env.FIBER_LINK_HMAC_SECRET ?? "";
}

function isTimestampFresh(ts: string) {
  const numeric = Number(ts);
  if (!Number.isFinite(numeric)) return false;
  const delta = Math.abs(Date.now() - numeric * 1000);
  return delta <= NONCE_TTL_MS;
}

export function registerRpc(app: FastifyInstance) {
  app.post("/rpc", async (req, reply) => {
    const body = req.body as RpcRequest;
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

    const secret = getSecretForApp(appId);

    if (!appId || !ts || !nonce || !signature || !secret) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: 401, message: "Unauthorized" },
      });
    }

    const isReplay = await nonceStore.isReplay(appId, nonce, NONCE_TTL_MS);
    if (!isTimestampFresh(ts) || isReplay) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: 401, message: "Unauthorized" },
      });
    }

    // TODO: replace env map with per-app DB lookup
    if (!verifyHmac.check({ secret, payload, ts, nonce, signature })) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: 401, message: "Unauthorized" },
      });
    }

    if (body.method === "health.ping") {
      return reply.send({ jsonrpc: "2.0", id: body.id, result: { status: "ok" } });
    }
    if (body.method === "tip.create") {
      const parsed = TipCreateSchema.safeParse(body.params);
      if (!parsed.success) {
        return reply.status(400).send({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32602, message: "Invalid params", data: parsed.error.issues },
        });
      }
      try {
        const result = await handleTipCreate({ ...parsed.data, appId });
        return reply.send({ jsonrpc: "2.0", id: body.id, result });
      } catch (error) {
        req.log.error(error);
        return reply.status(500).send({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32603, message: "Internal error" },
        });
      }
    }

    return reply.status(404).send({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  });
}
