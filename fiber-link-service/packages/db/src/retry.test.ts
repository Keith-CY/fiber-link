import { describe, expect, it } from "vitest";
import { computeRetryDelay } from "./retry";

describe("computeRetryDelay", () => {
  it("computes exponential backoff from base delay", () => {
    expect(computeRetryDelay(1000, 0)).toBe(1000);
    expect(computeRetryDelay(1000, 1)).toBe(2000);
    expect(computeRetryDelay(1000, 2)).toBe(4000);
    expect(computeRetryDelay(1000, 3)).toBe(8000);
  });

  it("clamps to maxDelayMs", () => {
    expect(computeRetryDelay(1000, 10, { maxDelayMs: 30000 })).toBe(30000);
    expect(computeRetryDelay(1000, 2, { maxDelayMs: 30000 })).toBe(4000);
  });

  it("applies jitter within expected range", () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(computeRetryDelay(1000, 0, { jitter: true }));
    }
    for (const result of results) {
      expect(result).toBeGreaterThanOrEqual(500);
      expect(result).toBeLessThanOrEqual(1000);
    }
    // jitter should produce some variation
    expect(results.size).toBeGreaterThan(1);
  });
});
