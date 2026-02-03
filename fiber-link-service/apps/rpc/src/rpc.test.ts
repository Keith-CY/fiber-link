import { describe, it, expect } from "vitest";
import { buildServer } from "./server";
import { verifyHmac } from "./auth/hmac";

describe("json-rpc", () => {
  it("health.ping returns ok", async () => {
    const app = buildServer();
    const payload = { jsonrpc: "2.0", id: 1, method: "health.ping", params: {} };
    const ts = "1700000000";
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
        "x-ts": ts,
        "x-nonce": nonce,
        "x-signature": signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok" } });
  });
});
