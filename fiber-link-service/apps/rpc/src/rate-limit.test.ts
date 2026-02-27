import { describe, expect, it } from "vitest";
import { InMemoryRateLimitStore, parseRpcRateLimitConfig, rateLimitKey } from "./rate-limit";

describe("rpc rate limit", () => {
  it("allows requests until limit is reached and blocks after", async () => {
    const store = new InMemoryRateLimitStore();

    const first = await store.consume({ key: "app1:tip.create", limit: 2, windowMs: 60_000 });
    const second = await store.consume({ key: "app1:tip.create", limit: 2, windowMs: 60_000 });
    const third = await store.consume({ key: "app1:tip.create", limit: 2, windowMs: 60_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);

    await store.close();
  });

  it("uses independent buckets for different methods", async () => {
    const store = new InMemoryRateLimitStore();

    const a = await store.consume({ key: rateLimitKey("app1", "tip.create"), limit: 1, windowMs: 60_000 });
    const b = await store.consume({ key: rateLimitKey("app1", "tip.status"), limit: 1, windowMs: 60_000 });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);

    await store.close();
  });

  it("parses env config with defaults", () => {
    const parsed = parseRpcRateLimitConfig({});

    expect(parsed).toEqual({
      enabled: true,
      windowMs: 60_000,
      maxRequests: 300,
    });
  });

  it("parses explicit env overrides", () => {
    const parsed = parseRpcRateLimitConfig({
      RPC_RATE_LIMIT_ENABLED: "false",
      RPC_RATE_LIMIT_WINDOW_MS: "120000",
      RPC_RATE_LIMIT_MAX_REQUESTS: "50",
    });

    expect(parsed).toEqual({
      enabled: false,
      windowMs: 120_000,
      maxRequests: 50,
    });
  });
});
