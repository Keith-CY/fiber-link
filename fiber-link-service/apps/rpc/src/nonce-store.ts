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

export type FaultTolerantNonceStoreOptions = {
  /** Called when Redis is unavailable and the fallback is used. */
  onFallback?: (error: unknown) => void;
};

/**
 * Wraps a primary Redis nonce store with an in-memory fallback.
 *
 * When Redis is temporarily unavailable (network hiccup, restart) requests
 * are not rejected outright — the in-memory store handles the nonce check for
 * that request and the error is surfaced via `onFallback` so operators can
 * alert on it. Replay protection remains intact within the single process;
 * cross-instance replay protection is degraded only for the duration of the
 * outage.
 *
 * For stricter deployments where replay protection must never be degraded,
 * use `RedisNonceStore` directly — errors will propagate and callers can
 * decide how to handle them.
 */
export class FaultTolerantRedisNonceStore implements NonceStore {
  private readonly fallback = new InMemoryNonceStore();

  constructor(
    private readonly primary: RedisNonceStore,
    private readonly options: FaultTolerantNonceStoreOptions = {},
  ) {}

  async isReplay(appId: string, nonce: string, ttlMs: number): Promise<boolean> {
    try {
      return await this.primary.isReplay(appId, nonce, ttlMs);
    } catch (error) {
      try {
        this.options.onFallback?.(error);
      } catch {
        // Observer errors must not prevent fallback replay protection.
      }
      return this.fallback.isReplay(appId, nonce, ttlMs);
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.primary.close(), this.fallback.close()]);
  }
}

export type CreateNonceStoreOptions = {
  /**
   * When `true`, Redis errors fall back to an in-memory store rather than
   * propagating. Defaults to `false` (fail-closed / strict replay protection).
   */
  faultTolerant?: boolean;
  onFallback?: (error: unknown) => void;
};

export function createNonceStore(options: CreateNonceStoreOptions = {}): NonceStore {
  const redisUrl = process.env.FIBER_LINK_NONCE_REDIS_URL ?? process.env.REDIS_URL;
  if (redisUrl) {
    const client = new Redis(redisUrl);
    const primary = new RedisNonceStore(client, true);
    if (options.faultTolerant) {
      return new FaultTolerantRedisNonceStore(primary, { onFallback: options.onFallback });
    }
    return primary;
  }
  return new InMemoryNonceStore();
}
