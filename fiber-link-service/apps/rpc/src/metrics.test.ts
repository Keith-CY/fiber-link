import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerRpc } from "./rpc";
import { normalizeMethodLabel } from "./metrics";

describe("normalizeMethodLabel", () => {
  it("passes through known methods", () => {
    expect(normalizeMethodLabel("tip.create")).toBe("tip.create");
    expect(normalizeMethodLabel("withdrawal.request")).toBe("withdrawal.request");
  });

  it("buckets unknown or non-string methods as 'unknown'", () => {
    expect(normalizeMethodLabel("evil.method")).toBe("unknown");
    expect(normalizeMethodLabel(undefined)).toBe("unknown");
    expect(normalizeMethodLabel(42)).toBe("unknown");
  });
});

describe("GET /metrics", () => {
  it("exposes a Prometheus exposition with default and custom metrics", async () => {
    const app = Fastify({ logger: false });
    registerRpc(app);

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    // custom collectors are registered
    expect(res.body).toContain("fiber_link_rpc_requests_total");
    expect(res.body).toContain("fiber_link_rpc_hmac_secret_source_total");
    // default process collector is present
    expect(res.body).toContain("process_cpu_user_seconds_total");
  });
});
