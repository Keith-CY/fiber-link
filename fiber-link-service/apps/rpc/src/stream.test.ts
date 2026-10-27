import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHmac } from "./auth/hmac";
import { type StreamAuth, type StreamInvoiceRecord, registerStreamRoute, streamSignaturePayload } from "./stream";

const APP_ID = "app1";
const SECRETS: Record<string, string> = {
  [APP_ID]: "app1-secret",
  "busy-app": "busy-secret",
  "other-app": "other-secret",
};

let nonceCounter = 0;
function signStream(invoice: string, appId = APP_ID, overrides: { ts?: string; secret?: string } = {}) {
  const ts = overrides.ts ?? String(Math.floor(Date.now() / 1000));
  const nonce = `nonce-${++nonceCounter}`;
  const signature = verifyHmac.sign({
    secret: overrides.secret ?? SECRETS[appId] ?? "",
    payload: streamSignaturePayload(invoice),
    ts,
    nonce,
  });
  return { appId, ts, nonce, signature };
}

// Signed x-app-id/x-ts/x-nonce/x-signature headers, as server-side proxies send.
function authHeaders(invoice: string, appId = APP_ID) {
  const { ts, nonce, signature } = signStream(invoice, appId);
  return { "x-app-id": appId, "x-ts": ts, "x-nonce": nonce, "x-signature": signature };
}

// Signed query string, as browser EventSource clients send.
function authQuery(invoice: string, appId = APP_ID, overrides: { ts?: string; secret?: string } = {}) {
  const creds = signStream(invoice, appId, overrides);
  return `appId=${creds.appId}&ts=${creds.ts}&nonce=${creds.nonce}&signature=${creds.signature}`;
}

function testAuth(): StreamAuth {
  const seenNonces = new Set<string>();
  return {
    resolveSecret: async (appId) => SECRETS[appId] ?? "",
    isTimestampFresh: (ts) => Math.abs(Date.now() - Number(ts) * 1000) <= 5 * 60 * 1000,
    isReplay: async (appId, nonce) => {
      const key = `${appId}:${nonce}`;
      if (seenNonces.has(key)) return true;
      seenNonces.add(key);
      return false;
    },
  };
}

function ownedInvoice(invoiceState: string, appId = APP_ID): StreamInvoiceRecord {
  return { invoiceState, appId };
}

function buildTestApp(options: Omit<Parameters<typeof registerStreamRoute>[1], "auth"> & { auth?: StreamAuth }) {
  const app = Fastify({ logger: false });
  registerStreamRoute(app, { auth: testAuth(), ...options });
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
    const res = await app.inject({ method: "GET", url: "/rpc/stream", headers: authHeaders("") });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when no credentials are provided", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("UNPAID") });
    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-1" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when only an unsigned app id is provided", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const viaHeader = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-unsigned",
      headers: { "x-app-id": APP_ID },
    });
    expect(viaHeader.statusCode).toBe(401);
    const viaQuery = await app.inject({ method: "GET", url: `/rpc/stream?invoice=inv-unsigned&appId=${APP_ID}` });
    expect(viaQuery.statusCode).toBe(401);
  });

  it("returns 401 for a wrong secret, a signature for another invoice, or a stale timestamp", async () => {
    const getInvoice = vi.fn(async () => ownedInvoice("SETTLED"));
    const app = buildTestApp({ getInvoice });
    const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const otherInvoiceCreds = authQuery("inv-other");
    for (const url of [
      `/rpc/stream?invoice=inv-bad&${authQuery("inv-bad", APP_ID, { secret: "wrong-secret" })}`,
      `/rpc/stream?invoice=inv-bad&${otherInvoiceCreds}`,
      `/rpc/stream?invoice=inv-bad&${authQuery("inv-bad", APP_ID, { ts: staleTs })}`,
      `/rpc/stream?invoice=inv-bad&${authQuery("inv-bad", "unknown-app")}`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(getInvoice).not.toHaveBeenCalled();
  });

  it("returns 401 when a signed request is replayed", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const headers = authHeaders("inv-replay");
    const first = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-replay", headers });
    expect(first.statusCode).toBe(200);
    const replayed = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-replay", headers });
    expect(replayed.statusCode).toBe(401);
  });

  it("does not let unauthenticated requests occupy the app's stream slots", async () => {
    const subscriber = makeMockSubscriber();
    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as never,
      maxConnectionsPerApp: 1,
    });

    const unsigned = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-dos",
      headers: { "x-app-id": APP_ID },
    });
    expect(unsigned.statusCode).toBe(401);
    expect(subscriber.subscribe).not.toHaveBeenCalled();

    const legit = app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-dos", headers: authHeaders("inv-dos") });
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());
    subscriber.emit(
      "message",
      "fiber-link:settlement:inv-dos",
      JSON.stringify({ invoice: "inv-dos", status: "SETTLED" }),
    );
    expect((await legit).statusCode).toBe(200);
  });

  it("returns 403 when the invoice belongs to a different app", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("UNPAID", "other-app") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-foreign",
      headers: authHeaders("inv-foreign"),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Invoice does not belong to this app" });
  });

  it("accepts signed query-param credentials for EventSource clients", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: `/rpc/stream?invoice=inv-qs&${authQuery("inv-qs")}`,
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
      url: `/rpc/stream?invoice=inv-dup&invoice=inv-other&${authQuery("inv-dup")}&appId=other-app`,
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
      headers: authHeaders("missing"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns SETTLED immediately when invoice is already settled", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-settled",
      headers: authHeaders("inv-settled"),
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
      headers: authHeaders("inv-1"),
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
      headers: authHeaders("inv-shutdown"),
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
      url: `/rpc/stream?invoice=inv-multi&${authQuery("inv-multi")}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"SETTLED"');
    await second.close();
  });

  it("streams TIMEOUT event when no settlement arrives within the configured window", async () => {
    const subscriber = makeMockSubscriber();

    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      auth: testAuth(),
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 50,
    });

    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-timeout",
      headers: authHeaders("inv-timeout"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"TIMEOUT"');
    expect(subscriber.subscribe).toHaveBeenCalledWith("fiber-link:settlement:inv-timeout", expect.any(Function));
  });

  it("sets SSE headers on successful connection", async () => {
    const app = buildTestApp({ getInvoice: async () => ownedInvoice("SETTLED") });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-headers",
      headers: authHeaders("inv-headers"),
    });
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("resolves via pollInvoiceStateFn when Redis message never arrives", async () => {
    const subscriber = makeMockSubscriber();
    let pollCount = 0;

    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      auth: testAuth(),
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
      headers: authHeaders("inv-poll"),
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

    const first = app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-held", headers: authHeaders("inv-held") });
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());

    const second = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-blocked",
      headers: authHeaders("inv-blocked"),
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "Too many concurrent streams" });

    subscriber.emit(
      "message",
      "fiber-link:settlement:inv-held",
      JSON.stringify({ invoice: "inv-held", status: "SETTLED" }),
    );
    const firstRes = await first;
    expect(firstRes.statusCode).toBe(200);

    const third = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-fast",
      headers: authHeaders("inv-fast"),
    });
    expect(third.statusCode).toBe(200);
  });

  it("returns 429 when the global concurrent stream cap is reached across apps", async () => {
    const subscriber = makeMockSubscriber();
    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("UNPAID", "busy-app"),
      createSubscriber: () => subscriber as never,
      maxConnections: 1,
    });

    const first = app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-1",
      headers: authHeaders("inv-1", "busy-app"),
    });
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());

    const second = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-2",
      headers: authHeaders("inv-2", "other-app"),
    });
    expect(second.statusCode).toBe(429);

    subscriber.emit("message", "fiber-link:settlement:inv-1", JSON.stringify({ invoice: "inv-1", status: "SETTLED" }));
    await first;
  });

  it("uses the configured CORS origin instead of the wildcard default", async () => {
    const app = buildTestApp({
      getInvoice: async () => ownedInvoice("SETTLED"),
      corsOrigin: "https://forum.example.com",
    });
    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-cors",
      headers: authHeaders("inv-cors"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://forum.example.com");
  });

  it("emits heartbeat comment lines while the stream is open", async () => {
    const subscriber = makeMockSubscriber();
    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      auth: testAuth(),
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 80,
      heartbeatIntervalMs: 10,
    });

    const res = await app.inject({ method: "GET", url: "/rpc/stream?invoice=inv-hb", headers: authHeaders("inv-hb") });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(": heartbeat");
    expect(res.body).toContain('"status":"TIMEOUT"');
  });

  it("omits heartbeats when the interval is disabled (0)", async () => {
    const subscriber = makeMockSubscriber();
    const app = Fastify({ logger: false });
    registerStreamRoute(app, {
      auth: testAuth(),
      getInvoice: async () => ownedInvoice("UNPAID"),
      createSubscriber: () => subscriber as unknown as InstanceType<typeof import("ioredis").default>,
      timeoutMs: 40,
      heartbeatIntervalMs: 0,
    });

    const res = await app.inject({
      method: "GET",
      url: "/rpc/stream?invoice=inv-nohb",
      headers: authHeaders("inv-nohb"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(": heartbeat");
  });
});
