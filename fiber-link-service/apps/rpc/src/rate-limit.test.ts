import { describe, expect, it } from "vitest";
import Redis from "ioredis-mock";
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitStore,
  parseRpcRateLimitConfig,
  rateLimitKey,
} from "./rate-limit";

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

  it("RedisRateLimitStore shares counters across store instances", async () => {
    const client = new Redis();
    const storeA = new RedisRateLimitStore(client);
    const storeB = new RedisRateLimitStore(client);

    const first = await storeA.consume({ key: rateLimitKey("app1", "tip.create"), limit: 1, windowMs: 60_000 });
    const second = await storeB.consume({ key: rateLimitKey("app1", "tip.create"), limit: 1, windowMs: 60_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
    expect(second.resetAtEpochMs).toBeGreaterThan(Date.now());

    await storeA.close();
    await storeB.close();
    await client.quit();
  });

  it("RedisRateLimitStore does not reset the TTL window on concurrent requests", async () => {
    // If two requests arrive concurrently both get count=1 from separate INCR calls
    // before either sets the TTL, the second PEXPIRE call would silently reset the
    // window. The Lua script fixes this by only calling PEXPIRE when count===1 inside
    // a single atomic operation, so the TTL is stable across concurrent calls.
    const client = new Redis();
    const store = new RedisRateLimitStore(client);

    const [first, second] = await Promise.all([
      store.consume({ key: rateLimitKey("concurrent", "tip.create"), limit: 10, windowMs: 60_000 }),
      store.consume({ key: rateLimitKey("concurrent", "tip.create"), limit: 10, windowMs: 60_000 }),
    ]);

    // Both should be counted; no window reset means resetAtEpochMs is consistent.
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const delta = Math.abs(first.resetAtEpochMs - second.resetAtEpochMs);
    // Both reset times should be within the same window, not independently extended.
    expect(delta).toBeLessThan(1_000);

    await store.close();
    await client.quit();
  });

  it("RedisRateLimitStore recovers a key that has no TTL set", async () => {
    // A key can lose its TTL via manual PERSIST, Redis restore, or a prior partial
    // failure before PEXPIRE ran. Without the pttl<0 branch the key would increment
    // forever and permanently rate-limit the caller. The Lua script detects PTTL==-1
    // and resets the expiry on the next request.
    const client = new Redis();
    const store = new RedisRateLimitStore(client);

    // Seed a key with no TTL directly via the mock client.
    const rawKey = `rate:${rateLimitKey("recover", "tip.create")}`;
    await (client as unknown as Redis).set(rawKey, "5");

    const result = await store.consume({ key: rateLimitKey("recover", "tip.create"), limit: 100, windowMs: 60_000 });

    // After the consume the key must have a TTL so it will eventually expire.
    const pttl = await (client as unknown as Redis).pttl(rawKey);
    expect(pttl).toBeGreaterThan(0);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(94); // 100 - 6

    await store.close();
    await client.quit();
  });

  it("createRateLimitStore uses Redis when a Redis URL is configured", async () => {
    const store = createRateLimitStore(
      {
        FIBER_LINK_RATE_LIMIT_REDIS_URL: "redis://example.test:6379/5",
      },
      () => new Redis(),
    );

    expect(store).toBeInstanceOf(RedisRateLimitStore);
    await store.close();
  });

  it("createRateLimitStore falls back to the nonce Redis URL when rate-limit Redis URL is unset", async () => {
    const store = createRateLimitStore(
      {
        FIBER_LINK_NONCE_REDIS_URL: "redis://example.test:6379/6",
      },
      () => new Redis(),
    );

    expect(store).toBeInstanceOf(RedisRateLimitStore);
    await store.close();
  });

  it("createRateLimitStore falls back to InMemoryRateLimitStore when Redis is not configured", async () => {
    const store = createRateLimitStore({});

    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
    await store.close();
  });

  it("does not use generic REDIS_URL for rate limiting", async () => {
    const store = createRateLimitStore({
      REDIS_URL: "redis://example.test:6379/7",
    });

    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
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
