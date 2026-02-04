import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "./server";
import { verifyHmac } from "./auth/hmac";

beforeEach(() => {
  process.env.FIBER_LINK_HMAC_SECRET = "replace-with-lookup";
});

describe("json-rpc", () => {
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
});
