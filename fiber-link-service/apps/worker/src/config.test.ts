import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config";

describe("parseWorkerConfig", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    FIBER_RPC_URL: "http://127.0.0.1:8227",
  };

  it("loads defaults and derives dependent retries", () => {
    const config = parseWorkerConfig(baseEnv);

    expect(config.withdrawalIntervalMs).toBe(30_000);
    expect(config.settlementIntervalMs).toBe(30_000);
    expect(config.settlementBatchSize).toBe(200);
    expect(config.maxRetries).toBe(3);
    expect(config.settlementMaxRetries).toBe(3);
    expect(config.retryDelayMs).toBe(60_000);
    expect(config.settlementRetryDelayMs).toBe(60_000);
    expect(config.settlementStrategy).toBe("polling");
    expect(config.subscriptionConcurrency).toBe(1);
    expect(config.subscriptionMaxPendingEvents).toBe(1000);
    expect(config.subscriptionRecentInvoiceDedupeSize).toBe(256);
  });

  it("normalizes settlement strategy and cursor file", () => {
    const config = parseWorkerConfig({
      ...baseEnv,
      WORKER_SETTLEMENT_STRATEGY: " Subscription ",
      WORKER_SETTLEMENT_CURSOR_FILE: "  /tmp/worker-cursor.json  ",
    });

    expect(config.settlementStrategy).toBe("subscription");
    expect(config.settlementCursorFile).toBe("/tmp/worker-cursor.json");
  });

  it.each([
    {
      name: "invalid positive integer field",
      env: { ...baseEnv, WORKER_SETTLEMENT_BATCH_SIZE: "0" },
      expectedMessage: "Invalid WORKER_SETTLEMENT_BATCH_SIZE: expected integer >= 1",
    },
    {
      name: "invalid non-negative integer field",
      env: { ...baseEnv, WORKER_MAX_RETRIES: "-1" },
      expectedMessage: "Invalid WORKER_MAX_RETRIES: expected integer >= 0",
    },
    {
      name: "invalid settlement strategy enum",
      env: { ...baseEnv, WORKER_SETTLEMENT_STRATEGY: "stream" },
      expectedMessage:
        "Invalid WORKER_SETTLEMENT_STRATEGY: expected one of polling, subscription, received \"stream\"",
    },
    {
      name: "missing rpc endpoint",
      env: { ...baseEnv, FIBER_RPC_URL: "   " },
      expectedMessage: "FIBER_RPC_URL is required",
    },
    {
      name: "empty cursor file",
      env: { ...baseEnv, WORKER_SETTLEMENT_CURSOR_FILE: "   " },
      expectedMessage: "WORKER_SETTLEMENT_CURSOR_FILE must not be empty",
    },
    {
      name: "invalid subscription concurrency",
      env: { ...baseEnv, WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: "0" },
      expectedMessage: "Invalid WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: expected integer >= 1",
    },
    {
      name: "invalid subscription pending queue size",
      env: { ...baseEnv, WORKER_SETTLEMENT_SUBSCRIPTION_MAX_PENDING_EVENTS: "-1" },
      expectedMessage: "Invalid WORKER_SETTLEMENT_SUBSCRIPTION_MAX_PENDING_EVENTS: expected integer >= 0",
    },
    {
      name: "invalid dedupe window size",
      env: { ...baseEnv, WORKER_SETTLEMENT_SUBSCRIPTION_RECENT_INVOICE_DEDUPE_SIZE: "-1" },
      expectedMessage:
        "Invalid WORKER_SETTLEMENT_SUBSCRIPTION_RECENT_INVOICE_DEDUPE_SIZE: expected integer >= 0",
    },
  ])("$name", ({ env, expectedMessage }) => {
    expect(() => parseWorkerConfig(env)).toThrow(expectedMessage);
  });
});
