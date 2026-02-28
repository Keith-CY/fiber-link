import { beforeEach, describe, expect, it, vi } from "vitest";

type MockSelectQueue = unknown[][];

function createMockDb(selectQueue: MockSelectQueue) {
  return {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(async () => {
          const next = selectQueue.shift();
          if (!next) {
            throw new Error("mock select queue underflow on limit()");
          }
          return next;
        }),
        groupBy: vi.fn(async () => {
          const next = selectQueue.shift();
          if (!next) {
            throw new Error("mock select queue underflow on groupBy()");
          }
          return next;
        }),
      };
      return chain;
    }),
  };
}

describe("handleDashboardSummary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns user + admin dashboard views and reuses default db client", async () => {
    const selectQueue: MockSelectQueue = [];
    const mockDb = createMockDb(selectQueue);
    const getBalance = vi.fn();

    const dbModule = await import("@fiber-link/db");
    vi.spyOn(dbModule, "createDbClient").mockReturnValue(mockDb as never);
    vi.spyOn(dbModule, "createDbLedgerRepo").mockReturnValue({ getBalance } as never);

    const { handleDashboardSummary } = await import("./dashboard");

    const firstTipCreatedAt = new Date("2026-02-27T10:00:00.000Z");
    selectQueue.push([
      {
        id: "tip-in",
        invoice: "inv-in",
        postId: "post-1",
        amount: "12.5",
        asset: "CKB",
        invoiceState: "SETTLED",
        fromUserId: "u-alice",
        toUserId: "u-bob",
        createdAt: firstTipCreatedAt,
      },
      {
        id: "tip-out",
        invoice: "inv-out",
        postId: "post-2",
        amount: "3",
        asset: "USDI",
        invoiceState: "UNPAID",
        fromUserId: "u-bob",
        toUserId: "u-charlie",
        createdAt: new Date("2026-02-27T09:00:00.000Z"),
      },
    ]);
    getBalance.mockResolvedValueOnce(88n);

    const userOnly = await handleDashboardSummary({
      appId: "app-1",
      userId: "u-bob",
      limit: 2,
    });

    expect(userOnly.balance).toBe("88");
    expect(userOnly.tips).toEqual([
      {
        id: "tip-in",
        invoice: "inv-in",
        postId: "post-1",
        amount: "12.5",
        asset: "CKB",
        state: "SETTLED",
        direction: "IN",
        counterpartyUserId: "u-alice",
        createdAt: firstTipCreatedAt.toISOString(),
      },
      {
        id: "tip-out",
        invoice: "inv-out",
        postId: "post-2",
        amount: "3",
        asset: "USDI",
        state: "UNPAID",
        direction: "OUT",
        counterpartyUserId: "u-charlie",
        createdAt: new Date("2026-02-27T09:00:00.000Z").toISOString(),
      },
    ]);
    expect(userOnly.admin).toBeUndefined();
    expect(typeof userOnly.generatedAt).toBe("string");

    const adminTipCreatedAt = new Date("2026-02-27T11:00:00.000Z");
    selectQueue.push(
      [
        {
          id: "tip-admin",
          invoice: "inv-admin",
          postId: "post-3",
          amount: "9",
          asset: "USDI",
          invoiceState: "FAILED",
          fromUserId: "u-bob",
          toUserId: "u-dave",
          createdAt: adminTipCreatedAt,
        },
      ],
      [{ appId: "app-1", createdAt: new Date("2026-01-01T00:00:00.000Z") }],
      [
        {
          id: "wd-1",
          userId: "u-bob",
          asset: "CKB",
          amount: "5",
          state: "PENDING",
          retryCount: 2,
          createdAt: new Date("2026-02-27T08:00:00.000Z"),
          updatedAt: new Date("2026-02-27T08:10:00.000Z"),
          txHash: null,
          nextRetryAt: null,
          lastError: "temporary",
        },
      ],
      [
        {
          id: "st-1",
          invoice: "invoice/with space",
          fromUserId: "u-1",
          toUserId: "u-2",
          state: "SETTLED",
          retryCount: 1,
          createdAt: new Date("2026-02-27T07:00:00.000Z"),
          settledAt: new Date("2026-02-27T07:01:00.000Z"),
          nextRetryAt: null,
          lastCheckedAt: new Date("2026-02-27T07:02:00.000Z"),
          lastError: null,
          failureReason: null,
        },
      ],
      [
        { state: "UNPAID", count: 2 },
        { state: "SETTLED", count: 4 },
        { state: "FAILED", count: 1 },
        { state: "IGNORED", count: 999 },
      ],
      [
        {
          invoice: "invoice/with space",
          state: "SETTLED",
          amount: "9.75",
          asset: "USDI",
          fromUserId: "u-1",
          toUserId: "u-2",
          createdAt: new Date("2026-02-27T06:00:00.000Z"),
        },
      ],
    );
    getBalance.mockResolvedValueOnce("91.2");

    const withAdmin = await handleDashboardSummary({
      appId: "app-1",
      userId: "u-bob",
      includeAdmin: true,
      filters: {
        withdrawalState: "PENDING",
        settlementState: "FAILED",
      },
    });

    expect(withAdmin.balance).toBe("91.2");
    expect(withAdmin.tips).toHaveLength(1);
    expect(withAdmin.admin?.filtersApplied).toEqual({
      withdrawalState: "PENDING",
      settlementState: "FAILED",
    });
    expect(withAdmin.admin?.pipelineBoard?.stageCounts).toEqual([
      { stage: "UNPAID", count: 2 },
      { stage: "SETTLED", count: 4 },
      { stage: "FAILED", count: 1 },
    ]);
    expect(withAdmin.admin?.pipelineBoard?.invoiceRows[0]?.timelineHref).toBe(
      "/fiber-link/timeline/invoice%2Fwith%20space",
    );

    expect(dbModule.createDbClient).toHaveBeenCalledTimes(1);
  });
});
