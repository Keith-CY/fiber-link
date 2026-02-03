import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("json-rpc", () => {
  it("health.ping returns ok", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      payload: { jsonrpc: "2.0", id: 1, method: "health.ping", params: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok" } });
  });
});
