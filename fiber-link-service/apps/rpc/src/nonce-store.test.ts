import { describe, it, expect, afterEach } from "vitest";
import Redis from "ioredis-mock";
import { InMemoryNonceStore, RedisNonceStore } from "./nonce-store";

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
});
