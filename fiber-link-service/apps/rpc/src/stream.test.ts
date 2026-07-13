import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerStreamRoute, type StreamInvoiceRecord } from "./stream";

const APP_ID = "app1";
const APP_HEADERS = { "x-app-id": APP_ID };

function ownedInvoice(invoiceState: string, appId = APP_ID): StreamInvoiceRecord {
  return { invoiceState, appId };
}

function buildTestApp(options: Parameters<typeof registerStreamRoute>[1]) {
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

  it("app.close() ends active SSE connections instead of waiting out the window", async () => {
    let subscribed = false;
    const subscriber = makeMockSubscriber(() => {
      subscribed = true;
    });

    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 5_000,
    });

    const pending = app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-shutdown",
      headers: APP_HEADERS,
    });
    await vi.waitFor(() => {
      expect(subscribed).toBe(true);
    });

    const closeStartedAt = Date.now();
    await app.close();
    const res = await pending;

    // The stream was ended by the shutdown hook, not the 5s timeout window.
    expect(Date.now() - closeStartedAt).toBeLessThan(4_000);
    expect(res.body).toContain('"status":"LISTENING"');
    expect(res.body).not.toContain('"status":"TIMEOUT"');
  });

  it("closing one fastify instance does not tear down another instance's stream route", async () => {
    const first = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const second = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    await first.ready();
    await second.ready();

    await first.close();

    const res = await second.inject({
      method: "GET",
      url: `/rpc/stream?invoice=inv-multi&appId=${APP_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"SETTLED"');
    await second.close();
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

  it("returns 429 when the per-app concurrent stream cap is reached and frees the slot on settle", async () => {
    const subscriber = makeMockSubscriber();
    const app = buildTestApp({
      getInvoice: async (invoice) => ownedInvoice(invoice === "inv-fast" ? "SETTLED" : "UNPAID"),
      createSubscriber: () => subscriber as never,
      maxConnectionsPerApp: 1,
    });

    const first = app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-held", headers: APP_HEADERS });
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());

    const second = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-blocked", headers: APP_HEADERS });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "Too many concurrent streams" });

    subscriber.emit("message", "fiber-link:settlement:inv-held", JSON.stringify({ invoice: "inv-held", status: "SETTLED" }));
    const firstRes = await first;
    expect(firstRes.statusCode).toBe(200);

    const third = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-fast", headers: APP_HEADERS });
    expect(third.statusCode).toBe(200);
  });

  it("returns 429 when the global concurrent stream cap is reached across apps", async () => {
    const subscriber = makeMockSubscriber();
    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("UNPAID", "busy-app"),
      createSubscriber: () => subscriber as never,
      maxConnections: 1,
    });

    const first = app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-1", headers: { "x-app-id": "busy-app" } });
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());

    const second = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-2", headers: { "x-app-id": "other-app" } });
    expect(second.statusCode).toBe(429);

    subscriber.emit("message", "fiber-link:settlement:inv-1", JSON.stringify({ invoice: "inv-1", status: "SETTLED" }));
    await first;
  });

  it("uses the configured CORS origin instead of the wildcard default", async () => {
    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("SETTLED"),
      corsOrigin: "https://forum.example.com",
    });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-cors", headers: APP_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://forum.example.com");
  });

  it("emits heartbeat comment lines while the stream is open", async () => {
    const subscriber = makeMockSubscriber();
    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 80,
      heartbeatIntervalMs: 10,
    });

    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-hb", headers: APP_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(": heartbeat");
    expect(res.body).toContain('"status":"TIMEOUT"');
  });

  it("omits heartbeats when the interval is disabled (0)", async () => {
    const subscriber = makeMockSubscriber();
    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 40,
      heartbeatIntervalMs: 0,
    });

    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-nohb", headers: APP_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(": heartbeat");
  });
});
