import type { FastifyInstance } from "fastify";
import { verifyHmac } from "./auth/hmac";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

export function registerRpc(app: FastifyInstance) {
  app.post("/rpc", async (req, reply) => {
    const body = req.body as RpcRequest;
    const payload = JSON.stringify(body);
    const ts = String(req.headers["x-ts"] ?? "");
    const nonce = String(req.headers["x-nonce"] ?? "");
    const signature = String(req.headers["x-signature"] ?? "");

    // TODO: lookup secret by app_id
    const secret = "replace-with-lookup";

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

    return reply.status(404).send({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  });
}
