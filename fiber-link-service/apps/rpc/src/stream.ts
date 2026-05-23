import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { createDbClient, createDbTipIntentRepo, TipIntentNotFoundError } from "@fiber-link/db";

const STREAM_TIMEOUT_MS = 60_000;

function getRedisUrl(): string | null {
  return process.env.FIBER_LINK_NONCE_REDIS_URL ?? process.env.REDIS_URL ?? null;
}

export function registerStreamRoute(
  app: FastifyInstance,
  options: {
    getInvoiceState?: (invoice: string) => Promise<string | null>;
    createSubscriber?: (redisUrl: string) => Redis;
    timeoutMs?: number;
  } = {},
) {
  const getInvoiceState =
    options.getInvoiceState ??
    (async (invoice: string) => {
      try {
        const db = createDbClient();
        const repo = createDbTipIntentRepo(db);
        const intent = await repo.findByInvoiceOrThrow(invoice);
        return intent.invoiceState;
      } catch (e) {
        if (e instanceof TipIntentNotFoundError) return null;
        throw e;
      }
    });

  const createSubscriber =
    options.createSubscriber ?? ((url: string) => new Redis(url, { lazyConnect: false }));

  app.get("/rpc/stream", async (req, reply) => {
    const invoice = ((req.query as Record<string, string>)?.invoice ?? "").trim();
    if (!invoice) {
      return reply.status(400).send({ error: "Missing invoice" });
    }

    // Validate the invoice exists — invoice strings are opaque bearer tokens.
    let currentState: string | null;
    try {
      currentState = await getInvoiceState(invoice);
    } catch {
      return reply.status(503).send({ error: "Stream temporarily unavailable" });
    }

    if (currentState === null) {
      return reply.status(404).send({ error: "Invoice not found" });
    }

    // If already settled, respond immediately without opening a Redis subscription.
    if (currentState === "SETTLED") {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
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
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");

    const channel = `fiber-link:settlement:${invoice}`;
    const subscriber = createSubscriber(redisUrl ?? "");
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.disconnect();
      if (!reply.raw.writableEnded) reply.raw.end();
    }

    const timeout = setTimeout(() => {
      if (!finished) {
        reply.raw.write(`data: ${JSON.stringify({ invoice, status: "TIMEOUT" })}\n\n`);
        finish();
      }
    }, options.timeoutMs ?? STREAM_TIMEOUT_MS);

    req.raw.on("close", () => {
      clearTimeout(timeout);
      finish();
    });

    subscriber.on("error", () => {
      clearTimeout(timeout);
      finish();
    });

    subscriber.subscribe(channel, (err) => {
      if (err) {
        clearTimeout(timeout);
        finish();
        return;
      }
      reply.raw.write(`data: ${JSON.stringify({ invoice, status: "LISTENING" })}\n\n`);
    });

    subscriber.on("message", (_ch: string, raw: string) => {
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
    });

    // Prevent Fastify from auto-closing the reply before we finish.
    await new Promise<void>((resolve) => {
      reply.raw.on("finish", resolve);
      reply.raw.on("error", resolve);
    });
  });
}
