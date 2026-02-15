import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { buildServer } from "./server";
import { verifyHmac } from "./auth/hmac";
import { createInMemoryAppRepo } from "./repositories/app-repo";
import { registerRpc } from "./rpc";

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
});
