import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockSelectQueue = unknown[][];

function createMockDb(selectQueue: MockSelectQueue) {
  const resolveNext = (label: string) => {
    const next = selectQueue.shift();
    if (!next) {
      throw new Error(`mock select queue underflow on ${label}`);
    }
    return next;
  };

  type QueryChain = {
    from: (...args: unknown[]) => QueryChain;
    where: (...args: unknown[]) => QueryChain;
    orderBy: (...args: unknown[]) => QueryChain;
    limit: (...args: unknown[]) => Promise<unknown>;
    groupBy: (...args: unknown[]) => Promise<unknown>;
    then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
  };
  return {
    select: vi.fn(() => {
      const chain: QueryChain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(async () => resolveNext("limit()")),
        groupBy: vi.fn(async () => resolveNext("groupBy()")),
        then: (resolve) => Promise.resolve(resolveNext("await query")).then(resolve),
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
    const getPendingTotal = vi.fn();

    const dbModule = await import("@fiber-link/db");
    vi.spyOn(dbModule, "createDbClient").mockReturnValue(mockDb as never);
    vi.spyOn(dbModule, "createDbLedgerRepo").mockReturnValue({ getBalance } as never);
    vi.spyOn(dbModule, "createDbWithdrawalRepo").mockReturnValue({ getPendingTotal } as never);

    const { handleDashboardSummary } = await import("./dashboard");

    const firstTipCreatedAt = new Date("2026-02-27T10:00:00.000Z");
    selectQueue.push(
      [
        {
          id: "tip-in",
          invoice: "inv-in",
          postId: "post-1",
          amount: "12.5",
          asset: "CKB",
          invoiceState: "SETTLED",
          fromUserId: "u-alice",
          toUserId: "u-bob",
          message: "Great post",
          createdAt: firstTipCreatedAt,
          settledAt: new Date("2026-02-27T10:01:00.000Z"),
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
          message: null,
          createdAt: new Date("2026-02-27T09:00:00.000Z"),
          settledAt: null,
        },
      ],
      [
        {
          id: "wd-completed",
          amount: "7",
          asset: "CKB",
          state: "COMPLETED",
          destinationKind: "CKB_ADDRESS",
          toAddress: "ckt1withdrawal",
          txHash: "0xwithdrawal",
          createdAt: new Date("2026-02-27T10:30:00.000Z"),
          updatedAt: new Date("2026-02-27T10:35:00.000Z"),
          completedAt: new Date("2026-02-27T10:36:00.000Z"),
        },
      ],
      [{ pendingAmount: "0", pendingCount: 0, completedCount: 1, failedCount: 0 }],
    );
    getBalance.mockResolvedValueOnce(88n); // CKB
    getPendingTotal.mockResolvedValueOnce("0"); // CKB locked
    getBalance.mockResolvedValueOnce("0"); // USDI
    getPendingTotal.mockResolvedValueOnce("0"); // USDI locked

    const userOnly = await handleDashboardSummary({
      appId: "app-1",
      userId: "u-bob",
      limit: 2,
    });

    expect(userOnly.balance).toBe("88");
    expect(userOnly.balances).toEqual({
      available: "88",
      pending: "0",
      locked: "0",
      asset: "CKB",
    });
    expect(userOnly.assetBalances).toEqual([
      { asset: "CKB", available: "88", pending: "0", locked: "0" },
      { asset: "USDI", available: "0", pending: "0", locked: "0" },
    ]);
    expect(userOnly.stats).toEqual({
      pendingCount: 0,
      completedCount: 1,
      failedCount: 0,
    });
    expect(userOnly.tips).toEqual([
      {
        id: "wd-completed",
        invoice: "withdrawal:wd-completed",
        postId: "withdrawal",
        amount: "7",
        asset: "CKB",
        state: "COMPLETED",
        direction: "WITHDRAWAL",
        counterpartyUserId: "u-bob",
        message: "On-chain withdrawal completed",
        createdAt: new Date("2026-02-27T10:35:00.000Z").toISOString(),
        settledAt: new Date("2026-02-27T10:36:00.000Z").toISOString(),
        activityType: "WITHDRAWAL",
        txHash: "0xwithdrawal",
        explorerUrl: "https://pudge.explorer.nervos.org/transaction/0xwithdrawal",
        destinationKind: "CKB_ADDRESS",
        destination: "ckt1withdrawal",
      },
      {
        id: "tip-in",
        invoice: "inv-in",
        postId: "post-1",
        amount: "12.5",
        asset: "CKB",
        state: "SETTLED",
        direction: "IN",
        counterpartyUserId: "u-alice",
        message: "Great post",
        createdAt: firstTipCreatedAt.toISOString(),
        settledAt: new Date("2026-02-27T10:01:00.000Z").toISOString(),
        activityType: "TIP",
        txHash: null,
        explorerUrl: null,
        destinationKind: null,
        destination: null,
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
          message: "oops",
          createdAt: adminTipCreatedAt,
          settledAt: null,
        },
      ],
      [],
      [{ pendingAmount: "0", pendingCount: 0, completedCount: 0, failedCount: 1 }],
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
    getBalance.mockResolvedValueOnce("91.2"); // CKB
    getPendingTotal.mockResolvedValueOnce("5"); // CKB locked
    getBalance.mockResolvedValueOnce("10"); // USDI
    getPendingTotal.mockResolvedValueOnce("0"); // USDI locked

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
    expect(withAdmin.tips).toHaveLength(0);
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

describe("handleDashboardAnalytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("calls getCreatorAnalytics and returns enriched result with range and generatedAt", async () => {
    const mockDb = {};
    const dbModule = await import("@fiber-link/db");
    vi.spyOn(dbModule, "createDbClient").mockReturnValue(mockDb as never);

    const analyticsResult = {
      timeSeries: [{ date: "2026-05-01", amount: "100" }],
      topPosts: [{ postId: "post-1", totalAmount: "50", tipCount: 3 }],
      topTippers: [{ userId: "u-alice", totalAmount: "75", tipCount: 5 }],
      withdrawalHistory: [],
    };
    vi.spyOn(dbModule, "getCreatorAnalytics").mockResolvedValueOnce(analyticsResult);

    const { handleDashboardAnalytics } = await import("./dashboard");
    const result = await handleDashboardAnalytics({ appId: "app-1", userId: "u-bob", range: "30d" });

    expect(result.timeSeries).toEqual(analyticsResult.timeSeries);
    expect(result.topPosts).toEqual(analyticsResult.topPosts);
    expect(result.topTippers).toEqual(analyticsResult.topTippers);
    expect(result.withdrawalHistory).toEqual([]);
    expect(result.range).toBe("30d");
    expect(typeof result.generatedAt).toBe("string");
    expect(dbModule.getCreatorAnalytics).toHaveBeenCalledWith(mockDb, {
      appId: "app-1",
      userId: "u-bob",
      range: "30d",
    });
  });

  it("passes range=7d and range=all through to getCreatorAnalytics", async () => {
    const mockDb = {};
    const dbModule = await import("@fiber-link/db");
    vi.spyOn(dbModule, "createDbClient").mockReturnValue(mockDb as never);

    const emptyResult = { timeSeries: [], topPosts: [], topTippers: [], withdrawalHistory: [] };
    vi.spyOn(dbModule, "getCreatorAnalytics").mockResolvedValue(emptyResult);

    const { handleDashboardAnalytics } = await import("./dashboard");

    await handleDashboardAnalytics({ appId: "app-1", userId: "u-bob", range: "7d" });
    expect(dbModule.getCreatorAnalytics).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ range: "7d" }));

    await handleDashboardAnalytics({ appId: "app-1", userId: "u-bob", range: "all" });
    expect(dbModule.getCreatorAnalytics).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ range: "all" }));
  });
});
