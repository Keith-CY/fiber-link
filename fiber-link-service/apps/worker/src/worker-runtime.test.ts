import { describe, expect, it } from "vitest";
import { createWorkerRuntime } from "./worker-runtime";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createWorkerRuntime", () => {
  it("waits for in-flight batch to finish before exiting on shutdown", async () => {
    const ticks: Array<() => void> = [];
    const exitCodes: number[] = [];
    const deferred = createDeferred<void>();
    let calls = 0;

    const runtime = createWorkerRuntime({
      intervalMs: 1000,
      maxRetries: 3,
      retryDelayMs: 60_000,
      shutdownTimeoutMs: 50,
      runWithdrawalBatch: async () => {
        calls += 1;
        if (calls === 2) {
          await deferred.promise;
        }
      },
      setIntervalFn: (tick) => {
        ticks.push(tick);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
      exitFn: (code) => {
        exitCodes.push(code);
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await runtime.start();
    ticks[0]?.();
    const shutdownPromise = runtime.shutdown("SIGTERM");
    expect(exitCodes).toEqual([]);

    deferred.resolve();
    await shutdownPromise;
    expect(exitCodes).toEqual([0]);
  });

  it("times out graceful drain and exits with non-zero when batch is stuck", async () => {
    const ticks: Array<() => void> = [];
    const exitCodes: number[] = [];
    const deferred = createDeferred<void>();
    let calls = 0;

    const runtime = createWorkerRuntime({
      intervalMs: 1000,
      maxRetries: 3,
      retryDelayMs: 60_000,
      shutdownTimeoutMs: 5,
      runWithdrawalBatch: async () => {
        calls += 1;
        if (calls === 2) {
          await deferred.promise;
        }
      },
      setIntervalFn: (tick) => {
        ticks.push(tick);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
      exitFn: (code) => {
        exitCodes.push(code);
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await runtime.start();
    ticks[0]?.();
    await runtime.shutdown("SIGTERM");
    expect(exitCodes).toEqual([1]);
  });

  it("runs settlement polling on its own interval with configured batch size", async () => {
    const ticks: Array<() => void> = [];
    const pollCalls: number[] = [];
    let now = 0;

    const runtime = createWorkerRuntime({
      intervalMs: 1000,
      maxRetries: 3,
      retryDelayMs: 60_000,
      shutdownTimeoutMs: 100,
      settlementIntervalMs: 2000,
      settlementBatchSize: 25,
      nowMsFn: () => now,
      runWithdrawalBatch: async () => {},
      pollSettlements: async ({ limit }) => {
        pollCalls.push(limit);
      },
      setIntervalFn: (tick) => {
        ticks.push(tick);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
      exitFn: () => {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await runtime.start();
    expect(pollCalls).toEqual([25]);

    now += 1000;
    ticks[0]?.();
    await Promise.resolve();
    expect(pollCalls).toEqual([25]);

    now += 1000;
    ticks[0]?.();
    await Promise.resolve();
    expect(pollCalls).toEqual([25, 25]);
  });
});
