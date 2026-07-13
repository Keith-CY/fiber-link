import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopSettlementPublisher, RedisSettlementPublisher, createSettlementPublisher } from "./settlement-publisher";

describe("RedisSettlementPublisher", () => {
  it("publishes the SETTLED payload to the per-invoice channel", async () => {
    const redisPublish = vi.fn().mockResolvedValue(1);
    const publisher = new RedisSettlementPublisher(redisPublish);
    const settledAt = new Date("2026-06-11T12:00:00.000Z");

    await publisher.publish("inv-42", { settledAt });

    expect(redisPublish).toHaveBeenCalledOnce();
    expect(redisPublish).toHaveBeenCalledWith(
      "fiber-link:settlement:inv-42",
      JSON.stringify({
        invoice: "inv-42",
        status: "SETTLED",
        settledAt: "2026-06-11T12:00:00.000Z",
      }),
    );
  });

  it("defaults settledAt to the publish time when not provided", async () => {
    const redisPublish = vi.fn().mockResolvedValue(1);
    const publisher = new RedisSettlementPublisher(redisPublish);

    const before = Date.now();
    await publisher.publish("inv-now");
    const after = Date.now();

    const payload = JSON.parse(redisPublish.mock.calls[0][1]);
    expect(payload.invoice).toBe("inv-now");
    expect(payload.status).toBe("SETTLED");
    const settledAtMs = Date.parse(payload.settledAt);
    expect(settledAtMs).toBeGreaterThanOrEqual(before);
    expect(settledAtMs).toBeLessThanOrEqual(after);
  });

  it("propagates publish failures so callers can log and swallow them", async () => {
    const redisPublish = vi.fn().mockRejectedValue(new Error("Redis unavailable"));
    const publisher = new RedisSettlementPublisher(redisPublish);

    await expect(publisher.publish("inv-err")).rejects.toThrow("Redis unavailable");
  });

  it("closes the underlying client on close", async () => {
    const closeClient = vi.fn().mockResolvedValue(undefined);
    const publisher = new RedisSettlementPublisher(vi.fn().mockResolvedValue(1), closeClient);

    await publisher.close();

    expect(closeClient).toHaveBeenCalledOnce();
  });
});

describe("createSettlementPublisher", () => {
  const originalNonceUrl = process.env.FIBER_LINK_NONCE_REDIS_URL;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalNonceUrl === undefined) {
      delete process.env.FIBER_LINK_NONCE_REDIS_URL;
    } else {
      process.env.FIBER_LINK_NONCE_REDIS_URL = originalNonceUrl;
    }
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it("returns a noop publisher when no Redis URL is configured", () => {
    delete process.env.FIBER_LINK_NONCE_REDIS_URL;
    delete process.env.REDIS_URL;

    const publisher = createSettlementPublisher();

    expect(publisher).toBeInstanceOf(NoopSettlementPublisher);
  });
});
