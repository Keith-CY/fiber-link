export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtEpochMs: number;
};

export type RateLimitStore = {
  consume(input: { key: string; limit: number; windowMs: number }): Promise<RateLimitDecision>;
  close(): Promise<void>;
};

type Bucket = {
  count: number;
  resetAtEpochMs: number;
  timer: NodeJS.Timeout;
};

export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  async consume(input: { key: string; limit: number; windowMs: number }): Promise<RateLimitDecision> {
    const now = Date.now();
    const existing = this.buckets.get(input.key);

    if (!existing || now >= existing.resetAtEpochMs) {
      if (existing) {
        clearTimeout(existing.timer);
      }
      const resetAtEpochMs = now + input.windowMs;
      const timer = setTimeout(() => {
        const current = this.buckets.get(input.key);
        if (current && current.resetAtEpochMs <= Date.now()) {
          this.buckets.delete(input.key);
        }
      }, input.windowMs);
      this.buckets.set(input.key, { count: 1, resetAtEpochMs, timer });
      return {
        allowed: true,
        limit: input.limit,
        remaining: Math.max(0, input.limit - 1),
        resetAtEpochMs,
      };
    }

    existing.count += 1;
    const allowed = existing.count <= input.limit;
    return {
      allowed,
      limit: input.limit,
      remaining: Math.max(0, input.limit - existing.count),
      resetAtEpochMs: existing.resetAtEpochMs,
    };
  }

  async close(): Promise<void> {
    for (const bucket of this.buckets.values()) {
      clearTimeout(bucket.timer);
    }
    this.buckets.clear();
  }
}

export type RpcRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
};

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function parseRpcRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RpcRateLimitConfig {
  return {
    enabled: parseBoolean(env.RPC_RATE_LIMIT_ENABLED, true),
    windowMs: parsePositiveInteger(env.RPC_RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: parsePositiveInteger(env.RPC_RATE_LIMIT_MAX_REQUESTS, 300),
  };
}

export function rateLimitKey(appId: string, method: string): string {
  return `${appId}:${method}`;
}
