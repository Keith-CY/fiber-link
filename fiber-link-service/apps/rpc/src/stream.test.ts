import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerStreamRoute } from "./stream";

function buildTestApp(options: {
  getInvoiceState?: (invoice: string) => Promise<string | null>;
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
    const app = buildTestApp({ getInvoiceState: async () => "UNPAID" });
    const res = await app.inject({ method: "GET", url: "/rpc/stream" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when invoice is not found", async () => {
    const app = buildTestApp({ getInvoiceState: async () => null });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=missing" });
    expect(res.statusCode).toBe(404);
  });

  it("returns SETTLED immediately when invoice is already settled", async () => {
    const app = buildTestApp({ getInvoiceState: async () => "SETTLED" });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-settled" });
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
      getInvoiceState: async () => "UNPAID",
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
    });

    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"LISTENING"');
    expect(res.body).toContain('"status":"SETTLED"');
  });

  it("streams TIMEOUT event when no settlement arrives within the configured window", async () => {
    const subscriber = makeMockSubscriber();

    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      getInvoiceState: async () => "UNPAID",
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 50,
    });

    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-timeout" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"TIMEOUT"');
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "fiber-link:settlement:inv-timeout",
      expect.any(Function),
    );
  });

  it("sets SSE headers on successful connection", async () => {
    const app = buildTestApp({ getInvoiceState: async () => "SETTLED" });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-headers" });
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
