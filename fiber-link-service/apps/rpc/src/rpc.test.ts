import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { TipIntentNotFoundError } from "@fiber-link/db";
import { ServerResponse } from "node:http";
import { buildServer } from "./server";
import { verifyHmac } from "./auth/hmac";
import { createInMemoryAppRepo } from "./repositories/app-repo";
import { registerRpc } from "./rpc";
import * as tipMethods from "./methods/tip";
import * as dashboardMethods from "./methods/dashboard";

function ensureBunInjectHeaderCompat() {
  if (typeof Bun === "undefined") {
    return;
  }

  const proto = ServerResponse.prototype as ServerResponse & {
    _header?: string;
    __fiberLinkHeaderCompat?: string;
  };

  // Bun's ServerResponse may not populate `_header`, while light-my-request expects a string.
  // Provide a minimal fallback for test injection only.
  try {
    if (typeof proto._header === "string") {
      return;
    }
  } catch {
    // no-op: continue to define fallback accessor
  }

  Object.defineProperty(proto, "_header", {
    configurable: true,
    enumerable: false,
    get() {
      return this.__fiberLinkHeaderCompat ?? "";
    },
    set(value: string) {
      this.__fiberLinkHeaderCompat = value;
    },
  });
}

ensureBunInjectHeaderCompat();

beforeEach(() => {
  process.env.FIBER_LINK_HMAC_SECRET = "replace-with-lookup";
});

function buildServerWithAppRepo() {
  const app = Fastify({ logger: false });
  app.decorateRequest("rawBody", "");

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const rawBody = body as string;
    req.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      (error as Error & { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  const appRepo = createInMemoryAppRepo([{ appId: "app1", hmacSecret: "db-secret" }]);
  registerRpc(app, { appRepo });
  return app;
}

describe("json-rpc", () => {
  it("healthz live returns alive", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/healthz/live",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "alive" });
  });

  it("healthz ready returns ready when readiness probe passes", async () => {
    const app = Fastify({ logger: false });
    registerRpc(app, {
      readinessProbe: async () => ({
        ready: true,
        checks: {
          database: { status: "ok" },
          redis: { status: "ok" },
          coreService: { status: "ok" },
        },
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/healthz/ready",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      checks: {
        database: { status: "ok" },
        redis: { status: "ok" },
        coreService: { status: "ok" },
      },
    });
  });

  it("healthz ready returns 503 when readiness probe fails", async () => {
    const app = Fastify({ logger: false });
    registerRpc(app, {
      readinessProbe: async () => ({
        ready: false,
        checks: {
          database: { status: "ok" },
          redis: { status: "error", message: "redis unavailable" },
          coreService: { status: "ok" },
        },
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/healthz/ready",
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "not_ready",
      checks: {
        database: { status: "ok" },
        redis: { status: "error", message: "redis unavailable" },
        coreService: { status: "ok" },
      },
    });
  });

  it("health.ping returns ok", async () => {
    const app = buildServer();
    const payload = { jsonrpc: "2.0", id: 1, method: "health.ping", params: {} };
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n1";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: JSON.stringify(payload),
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload,
      headers: {
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok" } });
  });

  it("verifies HMAC against raw body payload", async () => {
    const app = buildServer();
    const rawPayload = `{
  "id": 1,
  "jsonrpc": "2.0",
  "method": "health.ping",
  "params": {}
}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n2";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok" } });
  });

  it("does not burn nonce when signature is invalid", async () => {
    const app = buildServer();
    const rawPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "health.ping",
      params: {},
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n-invalid-sig";
    const validSig = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce,
    });
    const invalidTail = validSig.endsWith("0") ? "1" : "0";
    const invalidSig = `${validSig.slice(0, -1)}${invalidTail}`;

    const resInvalid = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": invalidSig,
      },
    });

    const resValid = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": validSig,
      },
    });

    expect(resInvalid.statusCode).toBe(200);
    expect(resInvalid.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "Unauthorized" },
    });
    expect(resValid.statusCode).toBe(200);
  });

  it("returns JSON-RPC error when raw body is missing", async () => {
    const app = buildServer();
    const rawPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "health.ping",
      params: {},
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "text/plain",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal error: could not read raw request body." },
    });
  });

  it("returns JSON-RPC invalid request for non-object payload", async () => {
    const app = buildServer();
    const rawPayload = "null";
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n-unexpected";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("returns JSON-RPC error when handler throws", async () => {
    const app = buildServer();
    delete process.env.FIBER_RPC_URL;
    const rawPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tip.create",
      params: { amount: "1", asset: "CKB", postId: "p1", fromUserId: "u1", toUserId: "u2" },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n3";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
  });

  it("returns tip.status result from handler", async () => {
    const app = buildServer();
    const tipStatusSpy = vi.spyOn(tipMethods, "handleTipStatus").mockResolvedValue({ state: "UNPAID" });
    try {
      const payload = { jsonrpc: "2.0", id: "s1", method: "tip.status", params: { invoice: "inv-1" } };
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = "status-ok";
      const signature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(payload),
        ts,
        nonce,
      });

      const res = await app.inject({
        method: "POST",
        url: "/rpc",
        payload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": ts,
          "x-nonce": nonce,
          "x-signature": signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ jsonrpc: "2.0", id: "s1", result: { state: "UNPAID" } });
      expect(tipStatusSpy).toHaveBeenCalledWith({ invoice: "inv-1" });
    } finally {
      tipStatusSpy.mockRestore();
    }
  });

  it("returns tip.get result from handler", async () => {
    const app = buildServer();
    const tipStatusSpy = vi.spyOn(tipMethods, "handleTipStatus").mockResolvedValue({ state: "UNPAID" });
    try {
      const payload = { jsonrpc: "2.0", id: "g1", method: "tip.get", params: { invoice: "inv-1" } };
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = "get-ok";
      const signature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(payload),
        ts,
        nonce,
      });

      const res = await app.inject({
        method: "POST",
        url: "/rpc",
        payload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": ts,
          "x-nonce": nonce,
          "x-signature": signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ jsonrpc: "2.0", id: "g1", result: { state: "UNPAID" } });
      expect(tipStatusSpy).toHaveBeenCalledWith({ invoice: "inv-1" });
    } finally {
      tipStatusSpy.mockRestore();
    }
  });

  it("returns JSON-RPC error on invalid tip.status params", async () => {
    const app = buildServer();
    const payload = { jsonrpc: "2.0", id: "s2", method: "tip.status", params: {} };
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "status-bad";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: JSON.stringify(payload),
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "s2",
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("returns JSON-RPC error on invalid tip.get params", async () => {
    const app = buildServer();
    const payload = { jsonrpc: "2.0", id: "g2", method: "tip.get", params: {} };
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "get-bad";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: JSON.stringify(payload),
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "g2",
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("returns dashboard.summary result from handler", async () => {
    const app = buildServer();
    const dashboardSpy = vi.spyOn(dashboardMethods, "handleDashboardSummary").mockResolvedValue({
      balance: "12.5",
      tips: [
        {
          id: "tip-1",
          invoice: "inv-1",
          postId: "p1",
          amount: "1",
          asset: "CKB",
          state: "UNPAID",
          direction: "IN",
          counterpartyUserId: "u2",
          createdAt: "2026-02-16T00:00:00.000Z",
        },
      ],
      generatedAt: "2026-02-16T00:00:00.000Z",
    });
    try {
      const payload = {
        jsonrpc: "2.0",
        id: "dash-1",
        method: "dashboard.summary",
        params: { userId: "u1", limit: 10 },
      };
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = "dashboard-ok";
      const signature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(payload),
        ts,
        nonce,
      });

      const res = await app.inject({
        method: "POST",
        url: "/rpc",
        payload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": ts,
          "x-nonce": nonce,
          "x-signature": signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        jsonrpc: "2.0",
        id: "dash-1",
        result: {
          balance: "12.5",
          tips: [
            {
              id: "tip-1",
              invoice: "inv-1",
              postId: "p1",
              amount: "1",
              asset: "CKB",
              state: "UNPAID",
              direction: "IN",
              counterpartyUserId: "u2",
              createdAt: "2026-02-16T00:00:00.000Z",
            },
          ],
          generatedAt: "2026-02-16T00:00:00.000Z",
        },
      });
      expect(dashboardSpy).toHaveBeenCalledWith({
        appId: "app1",
        userId: "u1",
        limit: 10,
      });
    } finally {
      dashboardSpy.mockRestore();
    }
  });

  it("returns JSON-RPC error on invalid dashboard.summary params", async () => {
    const app = buildServer();
    const payload = { jsonrpc: "2.0", id: "dash-2", method: "dashboard.summary", params: {} };
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "dashboard-bad";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: JSON.stringify(payload),
      ts,
      nonce,
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "dash-2",
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("returns standardized tip.status not-found error", async () => {
    const app = buildServer();
    const tipStatusSpy = vi
      .spyOn(tipMethods, "handleTipStatus")
      .mockRejectedValue(new TipIntentNotFoundError("missing-invoice"));
    try {
      const payload = { jsonrpc: "2.0", id: "s3", method: "tip.status", params: { invoice: "missing-invoice" } };
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = "status-not-found";
      const signature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(payload),
        ts,
        nonce,
      });

      const res = await app.inject({
        method: "POST",
        url: "/rpc",
        payload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": ts,
          "x-nonce": nonce,
          "x-signature": signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        jsonrpc: "2.0",
        id: "s3",
        error: { code: -32004, message: "Tip not found" },
      });
    } finally {
      tipStatusSpy.mockRestore();
    }
  });

  it("supports tip.create -> tip.get happy path with deterministic invoice", async () => {
    const app = buildServer();
    const tipCreateSpy = vi.spyOn(tipMethods, "handleTipCreate").mockResolvedValue({ invoice: "inv-happy-1" });
    const tipStatusSpy = vi.spyOn(tipMethods, "handleTipStatus").mockImplementation(async ({ invoice }) => ({
      state: invoice === "inv-happy-1" ? "UNPAID" : "FAILED",
    }));
    try {
      const createPayload = {
        jsonrpc: "2.0",
        id: "create-1",
        method: "tip.create",
        params: { amount: "1", asset: "CKB", postId: "p1", fromUserId: "u1", toUserId: "u2" },
      };
      const createTs = String(Math.floor(Date.now() / 1000));
      const createNonce = "create-ok";
      const createSignature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(createPayload),
        ts: createTs,
        nonce: createNonce,
      });

      const createRes = await app.inject({
        method: "POST",
        url: "/rpc",
        payload: createPayload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": createTs,
          "x-nonce": createNonce,
          "x-signature": createSignature,
        },
      });

      expect(createRes.statusCode).toBe(200);
      expect(createRes.json()).toEqual({
        jsonrpc: "2.0",
        id: "create-1",
        result: { invoice: "inv-happy-1" },
      });
      expect(tipCreateSpy).toHaveBeenCalledWith({
        amount: "1",
        appId: "app1",
        asset: "CKB",
        fromUserId: "u1",
        postId: "p1",
        toUserId: "u2",
      });

      const getPayload = {
        jsonrpc: "2.0",
        id: "get-1",
        method: "tip.get",
        params: { invoice: createRes.json().result.invoice },
      };
      const getTs = String(Math.floor(Date.now() / 1000));
      const getNonce = "get-after-create";
      const getSignature = verifyHmac.sign({
        secret: "replace-with-lookup",
        payload: JSON.stringify(getPayload),
        ts: getTs,
        nonce: getNonce,
      });

      const getRes = await app.inject({
        method: "POST",
        url: "/rpc",
        payload: getPayload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app1",
          "x-ts": getTs,
          "x-nonce": getNonce,
          "x-signature": getSignature,
        },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual({
        jsonrpc: "2.0",
        id: "get-1",
        result: { state: "UNPAID" },
      });
      expect(tipStatusSpy).toHaveBeenCalledWith({ invoice: "inv-happy-1" });
    } finally {
      tipCreateSpy.mockRestore();
      tipStatusSpy.mockRestore();
    }
  });

  it("returns JSON-RPC unauthorized when auth headers are missing", async () => {
    const app = buildServer();
    const rawPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "health.ping",
      params: {},
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32001, message: "Unauthorized" },
    });
  });

  it("prefers db secret over env fallback for HMAC verification", async () => {
    const app = buildServerWithAppRepo();
    const rawPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "health.ping",
      params: {},
    });
    const ts = String(Math.floor(Date.now() / 1000));

    const dbSignature = verifyHmac.sign({
      secret: "db-secret",
      payload: rawPayload,
      ts,
      nonce: "n-db-priority-1",
    });
    const envFallbackSignature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce: "n-db-priority-2",
    });

    const resDb = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": "n-db-priority-1",
        "x-signature": dbSignature,
      },
    });

    const resEnvFallback = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: rawPayload,
      headers: {
        "content-type": "application/json",
        "x-app-id": "app1",
        "x-ts": ts,
        "x-nonce": "n-db-priority-2",
        "x-signature": envFallbackSignature,
      },
    });

    expect(resDb.statusCode).toBe(200);
    expect(resDb.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok" } });
    expect(resEnvFallback.statusCode).toBe(200);
    expect(resEnvFallback.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "Unauthorized" },
    });
  });

  it("returns 503 when readinessProbe throws unexpectedly", async () => {
    const app = Fastify({ logger: false });
    registerRpc(app, {
      readinessProbe: async () => {
        throw new Error("readiness backend crashed");
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/healthz/ready",
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "not_ready",
      checks: {
        database: { status: "error", message: "probe failure" },
        redis: { status: "error", message: "probe failure" },
        coreService: { status: "error", message: "probe failure" },
      },
    });
  });

  it("returns unauthorized when no app secret source is configured", async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest("rawBody", "");

    app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      const rawBody = body as string;
      req.rawBody = rawBody;
      try {
        done(null, JSON.parse(rawBody));
      } catch (error) {
        (error as Error & { statusCode?: number }).statusCode = 400;
        done(error as Error, undefined);
      }
    });

    registerRpc(app, {
      appRepo: createInMemoryAppRepo(),
    });

    const originalSecret = process.env.FIBER_LINK_HMAC_SECRET;
    const rawPayload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "health.ping", params: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "missing-secret";
    const signature = verifyHmac.sign({
      secret: "replace-with-lookup",
      payload: rawPayload,
      ts,
      nonce,
    });
    process.env.FIBER_LINK_HMAC_SECRET = "";

    try {
      const res = await app.inject({
        method: "POST",
        url: "/rpc",
        payload: rawPayload,
        headers: {
          "content-type": "application/json",
          "x-app-id": "app-without-secret",
          "x-ts": ts,
          "x-nonce": nonce,
          "x-signature": signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32001, message: "Unauthorized" },
      });
    } finally {
      if (originalSecret === undefined) {
        delete process.env.FIBER_LINK_HMAC_SECRET;
      } else {
        process.env.FIBER_LINK_HMAC_SECRET = originalSecret;
      }
    }
  });

});
