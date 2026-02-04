import Redis from "ioredis";

export type NonceStore = {
  isReplay(appId: string, nonce: string, ttlMs: number): Promise<boolean>;
  close(): Promise<void>;
};

export class InMemoryNonceStore implements NonceStore {
  private cache = new Map<string, NodeJS.Timeout>();

  async isReplay(appId: string, nonce: string, ttlMs: number) {
    const key = `${appId}:${nonce}`;
    if (this.cache.has(key)) return true;
    const timer = setTimeout(() => this.cache.delete(key), ttlMs);
    this.cache.set(key, timer);
    return false;
  }

  async close() {
    for (const timer of this.cache.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
  }
}

export class RedisNonceStore implements NonceStore {
  constructor(private client: Redis, private owned = false) {}

  async isReplay(appId: string, nonce: string, ttlMs: number) {
    const key = `nonce:${appId}:${nonce}`;
    const result = await this.client.set(key, "1", "PX", ttlMs, "NX");
    return result !== "OK";
  }

  async close() {
    if (this.owned) {
      await this.client.quit();
    }
  }
}

export function createNonceStore() {
  const redisUrl = process.env.FIBER_LINK_NONCE_REDIS_URL ?? process.env.REDIS_URL;
  if (redisUrl) {
    const client = new Redis(redisUrl);
    return new RedisNonceStore(client, true);
  }
  return new InMemoryNonceStore();
}
