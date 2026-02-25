import { beforeEach, describe, expect, it, vi } from "vitest";
import { startSettlementSubscriptionRunner } from "./settlement-subscription-runner";
import { markSettled } from "./settlement";

vi.mock("./settlement", () => ({
  markSettled: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("startSettlementSubscriptionRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops overflow events once pending queue is full", async () => {
    const overflowed: string[] = [];
    const first = createDeferred<{ credited: boolean; idempotencyKey: string }>();
    const settleMock = vi.mocked(markSettled);
    settleMock.mockImplementationOnce(async () => first.promise);
    settleMock.mockResolvedValue({
      credited: true,
      idempotencyKey: "settlement:key:next",
    });

    let onSettled: ((invoice: string) => void | Promise<void>) | null = null;
    const runner = await startSettlementSubscriptionRunner({
      adapter: {
        async subscribeSettlements(args) {
          onSettled = args.onSettled;
          return {
            close: () => undefined,
          };
        },
      },
      maxPendingEvents: 1,
      onQueueOverflow(info) {
        overflowed.push(info.invoice);
      },
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    await onSettled?.("inv-1");
    await onSettled?.("inv-2");
    await onSettled?.("inv-3");
    await Promise.resolve();

    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(overflowed).toEqual(["inv-3"]);

    first.resolve({
      credited: true,
      idempotencyKey: "settlement:key:first",
    });
    await runner.close();

    expect(settleMock).toHaveBeenCalledTimes(2);
    expect(settleMock.mock.calls.map((call) => call[0].invoice)).toEqual(["inv-1", "inv-2"]);
  });

  it("dedupes duplicate burst invoices inside active and recent windows", async () => {
    const settleMock = vi.mocked(markSettled);
    settleMock.mockResolvedValue({
      credited: true,
      idempotencyKey: "settlement:key",
    });

    let onSettled: ((invoice: string) => void | Promise<void>) | null = null;
    const runner = await startSettlementSubscriptionRunner({
      adapter: {
        async subscribeSettlements(args) {
          onSettled = args.onSettled;
          return {
            close: () => undefined,
          };
        },
      },
      recentInvoiceDedupeSize: 32,
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    await onSettled?.("inv-dup");
    await onSettled?.("inv-dup");
    await onSettled?.("inv-dup");
    await runner.close();

    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(settleMock).toHaveBeenCalledWith(
      { invoice: "inv-dup" },
      expect.any(Object),
    );
  });

  it("drains queued work before shutdown resolves", async () => {
    const settleMock = vi.mocked(markSettled);
    const deferred = createDeferred<{ credited: boolean; idempotencyKey: string }>();
    settleMock.mockImplementationOnce(async () => deferred.promise);

    let onSettled: ((invoice: string) => void | Promise<void>) | null = null;
    let subscriptionClosed = false;
    const runner = await startSettlementSubscriptionRunner({
      adapter: {
        async subscribeSettlements(args) {
          onSettled = args.onSettled;
          return {
            close: async () => {
              subscriptionClosed = true;
            },
          };
        },
      },
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    await onSettled?.("inv-close");
    await Promise.resolve();

    let closed = false;
    const closePromise = runner.close().then(() => {
      closed = true;
    });
    await Promise.resolve();

    expect(subscriptionClosed).toBe(true);
    expect(closed).toBe(false);

    deferred.resolve({
      credited: true,
      idempotencyKey: "settlement:key:close",
    });
    await closePromise;

    expect(closed).toBe(true);
    expect(settleMock).toHaveBeenCalledTimes(1);
  });
});
