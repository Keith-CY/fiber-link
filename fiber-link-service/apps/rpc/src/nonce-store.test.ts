import type { Redis as RedisClient } from "ioredis";
import Redis from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { FaultTolerantRedisNonceStore, InMemoryNonceStore, RedisNonceStore } from "./nonce-store";

describe("nonce store", () => {
  it("InMemoryNonceStore marks a repeated nonce as replay", async () => {
    const store = new InMemoryNonceStore();
    const first = await store.isReplay("app1", "nonce1", 1_000);
    const second = await store.isReplay("app1", "nonce1", 1_000);

    expect(first).toBe(false);
    expect(second).toBe(true);
    await store.close();
  });

  it("RedisNonceStore shares nonce state across store instances", async () => {
    const client = new Redis();
    const storeA = new RedisNonceStore(client);
    const storeB = new RedisNonceStore(client);

    const first = await storeA.isReplay("app1", "nonce2", 1_000);
    const second = await storeB.isReplay("app1", "nonce2", 1_000);

    expect(first).toBe(false);
    expect(second).toBe(true);

    await storeA.close();
    await storeB.close();
    await client.quit();
  });

  describe("FaultTolerantRedisNonceStore", () => {
    it("delegates to primary Redis store when available", async () => {
      const client = new Redis();
      const primary = new RedisNonceStore(client);
      const store = new FaultTolerantRedisNonceStore(primary);

      const first = await store.isReplay("app1", "nonce-ft-1", 1_000);
      const second = await store.isReplay("app1", "nonce-ft-1", 1_000);

      expect(first).toBe(false);
      expect(second).toBe(true);
      await store.close();
      await client.quit();
    });

    it("falls back to in-memory store when Redis throws and calls onFallback", async () => {
      const errors: unknown[] = [];
      const failingRedis = {
        set: async () => {
          throw new Error("Redis connection refused");
        },
        quit: async () => {},
      } as unknown as RedisClient;

      const primary = new RedisNonceStore(failingRedis);
      const store = new FaultTolerantRedisNonceStore(primary, {
        onFallback: (err) => errors.push(err),
      });

      const first = await store.isReplay("app1", "nonce-fallback", 1_000);
      const second = await store.isReplay("app1", "nonce-fallback", 1_000);

      expect(first).toBe(false);
      expect(second).toBe(true);
      expect(errors).toHaveLength(2);
      expect((errors[0] as Error).message).toMatch(/connection refused/);
      await store.close();
    });

    it("still reaches the in-memory fallback when onFallback observer throws", async () => {
      const failingRedis = {
        set: async () => {
          throw new Error("Redis unavailable");
        },
        quit: async () => {},
      } as unknown as RedisClient;

      const primary = new RedisNonceStore(failingRedis);
      const store = new FaultTolerantRedisNonceStore(primary, {
        onFallback: () => {
          throw new Error("metrics pipeline exploded");
        },
      });

      const first = await store.isReplay("app1", "nonce-obs-throw", 1_000);
      const second = await store.isReplay("app1", "nonce-obs-throw", 1_000);

      expect(first).toBe(false);
      expect(second).toBe(true);
      await store.close();
    });

    it("treats different nonces independently when falling back", async () => {
      const failingRedis = {
        set: async () => {
          throw new Error("Redis unavailable");
        },
        quit: async () => {},
      } as unknown as RedisClient;

      const primary = new RedisNonceStore(failingRedis);
      const store = new FaultTolerantRedisNonceStore(primary);

      const a = await store.isReplay("app1", "nonce-a", 1_000);
      const b = await store.isReplay("app1", "nonce-b", 1_000);

      expect(a).toBe(false);
      expect(b).toBe(false);
      await store.close();
    });
  });
});
