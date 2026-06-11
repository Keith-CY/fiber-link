import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerStreamRoute, type StreamInvoiceRecord } from "./stream";

const APP_ID = "app1";
const APP_HEADERS = { "x-app-id": APP_ID };

function ownedInvoice(invoiceState: string, appId = APP_ID): StreamInvoiceRecord {
  return { invoiceState, appId };
}

function buildTestApp(options: {
  getInvoice?: (invoice: string) => Promise<StreamInvoiceRecord | null>;
  createSubscriber?: Parameters<typeof registerStreamRoute>[1]["createSubscriber"];
}) {
  const app = Fastify({ logger: false });
  registerStreamRoute(app, options);
  return app;
}

function makeMockSubscriber(onSubscribe?: (channel: string) => void) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const subscriber = {
    subscribe: vi.fn((channel: string, cb: (err: Error | null) => void) => {
      onSubscribe?.(channel);
      cb(null);
    }),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of listeners[event] ?? []) {
        handler(...args);
      }
    },
  };
  return subscriber;
}

describe("GET /rpc/stream", () => {
  it("returns 400 when invoice query param is missing", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("UNPAID") });
    const res = await app.inject({ method: "GET", url: "/rpc/stream", headers: APP_HEADERS });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when no app id is provided", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("UNPAID") });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-1" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when the invoice belongs to a different app", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("UNPAID", "other-app") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-foreign",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Invoice does not belong to this app" });
  });

  it("accepts the app id via the appId query param for EventSource clients", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: `/rpc/stream?invoice=inv-qs&appId=${APP_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"SETTLED"');
  });

  it("takes the first value instead of crashing when query params are duplicated", async () => {
    const seenInvoices: string[] = [];
    const app = buildTestApp({
      getInvoice: async (invoice) => {
        seenInvoices.push(invoice);
        return ownedInvoice("SETTLED");
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/rpc/stream?invoice=inv-dup&invoice=inv-other&appId=${APP_ID}&appId=other-app`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"SETTLED"');
    expect(seenInvoices).toEqual(["inv-dup"]);
  });

  it("returns 404 when invoice is not found", async () => {
    const app = buildTestApp({ getInvoice: async () => null });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=missing",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns SETTLED immediately when invoice is already settled", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-settled",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.body).toContain('"status":"SETTLED"');
  });

  it("streams LISTENING then SETTLED events via Redis pub/sub", async () => {
    let subscriberRef: ReturnType<typeof makeMockSubscriber> | null = null;

    const subscriber = makeMockSubscriber((channel) => {
      // Simulate Redis delivering the settlement message after subscribe
      setTimeout(() => {
        subscriberRef?.emit("message", channel, JSON.stringify({ invoice: "inv-1", status: "SETTLED" }));
      }, 10);
    });
    subscriberRef = subscriber;

    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
    });

    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-1",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"LISTENING"');
    expect(res.body).toContain('"status":"SETTLED"');
  });

  it("streams TIMEOUT event when no settlement arrives within the configured window", async () => {
    const subscriber = makeMockSubscriber();

    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 50,
    });

    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-timeout",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"TIMEOUT"');
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "fiber-link:settlement:inv-timeout",
      expect.any(Function),
    );
  });

  it("sets SSE headers on successful connection", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-headers",
      headers: APP_HEADERS,
    });
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("resolves via pollInvoiceStateFn when Redis message never arrives", async () => {
    const subscriber = makeMockSubscriber();
    let pollCount = 0;

    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 5000,
      pollIntervalMs: 20,
      pollInvoiceStateFn: async () => {
        pollCount += 1;
        return pollCount >= 2 ? "SETTLED" : "UNPAID";
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-poll",
      headers: APP_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"LISTENING"');
    expect(res.body).toContain('"status":"SETTLED"');
    expect(res.body).not.toContain('"status":"TIMEOUT"');
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });
});
