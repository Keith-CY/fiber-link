import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { isMetricsRequestAuthorized, normalizeMethodLabel, parseMetricsToken } from "./metrics";
import { registerRpc } from "./rpc";

describe("normalizeMethodLabel", () => {
  it("passes through known methods", () => {
    expect(normalizeMethodLabel("tip.create")).toBe("tip.create");
    expect(normalizeMethodLabel("withdrawal.request")).toBe("withdrawal.request");
    expect(normalizeMethodLabel("tip.settled_feed")).toBe("tip.settled_feed");
    expect(normalizeMethodLabel("withdrawal.quote")).toBe("withdrawal.quote");
  });

  it("buckets unknown or non-string methods as 'unknown'", () => {
    expect(normalizeMethodLabel("evil.method")).toBe("unknown");
    expect(normalizeMethodLabel(undefined)).toBe("unknown");
    expect(normalizeMethodLabel(42)).toBe("unknown");
  });
});

describe("parseMetricsToken", () => {
  it("returns null when unset or blank", () => {
    expect(parseMetricsToken({})).toBeNull();
    expect(parseMetricsToken({ RPC_METRICS_TOKEN: "   " })).toBeNull();
  });

  it("returns the trimmed token when set", () => {
    expect(parseMetricsToken({ RPC_METRICS_TOKEN: " s3cret " })).toBe("s3cret");
  });
});

describe("isMetricsRequestAuthorized", () => {
  it("allows every request when no token is configured", () => {
    expect(isMetricsRequestAuthorized(undefined, null)).toBe(true);
    expect(isMetricsRequestAuthorized("Bearer anything", null)).toBe(true);
  });

  it("rejects missing, malformed, or mismatching credentials", () => {
    expect(isMetricsRequestAuthorized(undefined, "s3cret")).toBe(false);
    expect(isMetricsRequestAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isMetricsRequestAuthorized("Basic s3cret", "s3cret")).toBe(false);
    expect(isMetricsRequestAuthorized("Bearer wrong", "s3cret")).toBe(false);
  });

  it("rejects oversized authorization headers before matching", () => {
    expect(isMetricsRequestAuthorized(`Bearer ${"a".repeat(600)}`, "s3cret")).toBe(false);
  });

  it("accepts a matching bearer token with a case-insensitive scheme", () => {
    expect(isMetricsRequestAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isMetricsRequestAuthorized("bearer s3cret", "s3cret")).toBe(true);
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

  it("returns 401 without the bearer token when RPC_METRICS_TOKEN is configured", async () => {
    const app = Fastify({ logger: false });
    registerRpc(app, { metricsToken: "scrape-secret" });

    const denied = await app.inject({ method: "GET", url: "/metrics" });
    expect(denied.statusCode).toBe(401);
    expect(denied.body).not.toContain("fiber_link_rpc_requests_total");

    const wrong = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer scrape-secret" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain("fiber_link_rpc_requests_total");
  });
});
