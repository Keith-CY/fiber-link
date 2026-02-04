import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyHmac } from "./auth/hmac";
import { handleTipCreate } from "./methods/tip";

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

export function registerRpc(app: FastifyInstance) {
  app.post("/rpc", async (req, reply) => {
    const body = req.body as RpcRequest;
    const payload = JSON.stringify(body);
    const appId = String(req.headers["x-app-id"] ?? "");
    const ts = String(req.headers["x-ts"] ?? "");
    const nonce = String(req.headers["x-nonce"] ?? "");
    const signature = String(req.headers["x-signature"] ?? "");

    const secret = process.env.FIBER_LINK_HMAC_SECRET ?? "";

    if (!appId || !ts || !nonce || !signature || !secret) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: 401, message: "Unauthorized" },
      });
    }

    // TODO: lookup secret by app_id for multi-tenant setups
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
      const params = TipCreateSchema.parse(body.params);
      const result = await handleTipCreate({ ...params, appId });
      return reply.send({ jsonrpc: "2.0", id: body.id, result });
    }

    return reply.status(404).send({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  });
}
