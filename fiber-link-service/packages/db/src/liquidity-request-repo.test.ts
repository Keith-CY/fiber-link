import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import {
  LiquidityRequestFundingAmountError,
  LiquidityRequestNotFoundError,
  LiquidityRequestStateTransitionError,
  createDbLiquidityRequestRepo,
  createInMemoryLiquidityRequestRepo,
} from "./liquidity-request-repo";

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "liq1",
    appId: "app1",
    asset: "CKB",
    network: "AGGRON4",
    state: "REQUESTED",
    sourceKind: "FIBER_TO_CKB_CHAIN",
    requiredAmount: "100",
    fundedAmount: "0",
    metadata: null,
    lastError: null,
    createdAt: new Date("2026-03-07T00:00:00.000Z"),
    updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function createDbMock() {
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const selectLimit = vi.fn();
  const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy, limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const db = {
    insert,
    select,
    update,
  } as unknown as DbClient;

  return { db, insertValues, insertReturning, selectLimit, updateSet, updateReturning };
}

describe("createInMemoryLiquidityRequestRepo", () => {
  it("creates a liquidity request in REQUESTED state", async () => {
    const repo = createInMemoryLiquidityRequestRepo();

    const created = await repo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });

    expect(created.state).toBe("REQUESTED");
    expect(created.fundedAmount).toBe("0");
    expect(created.sourceKind).toBe("FIBER_TO_CKB_CHAIN");
  });

  it("lists open liquidity requests ordered by creation time", async () => {
    const repo = createInMemoryLiquidityRequestRepo();

    const older = await repo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
    });
    const newer = await repo.create({
      appId: "app1",
      asset: "USDI",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "50",
      createdAt: new Date("2026-03-07T00:01:00.000Z"),
    });

    const open = await repo.listOpen();

    expect(open.map((row) => row.id)).toEqual([older.id, newer.id]);
    expect(open).toHaveLength(2);
  });

  it("marks a liquidity request funded with completion timestamp", async () => {
    const repo = createInMemoryLiquidityRequestRepo();
    const created = await repo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });
    const now = new Date("2026-03-07T01:00:00.000Z");

    const funded = await repo.markFunded(created.id, {
      fundedAmount: "100",
      now,
      metadata: { txHash: "0xabc" },
    });

    expect(funded.state).toBe("FUNDED");
    expect(funded.fundedAmount).toBe("100");
    expect(funded.completedAt?.toISOString()).toBe(now.toISOString());
  });

  it("rejects markFunded when the liquidity request is already FAILED", async () => {
    const repo = createInMemoryLiquidityRequestRepo([
      mockRow({
        state: "FAILED",
      }),
    ]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "100",
        now: new Date("2026-03-07T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestStateTransitionError);

    await expect(repo.findByIdOrThrow("liq1")).resolves.toMatchObject({
      state: "FAILED",
      fundedAmount: "0",
    });
  });

  it("rejects markFunded when the liquidity request is already FUNDED", async () => {
    const now = new Date("2026-03-07T01:00:00.000Z");
    const repo = createInMemoryLiquidityRequestRepo([
      mockRow({
        state: "FUNDED",
        fundedAmount: "100",
        updatedAt: now,
        completedAt: now,
      }),
    ]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "100",
        now,
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestStateTransitionError);

    await expect(repo.findByIdOrThrow("liq1")).resolves.toMatchObject({
      state: "FUNDED",
      fundedAmount: "100",
      completedAt: now,
    });
  });

  it("rejects markFunded when fundedAmount is below requiredAmount", async () => {
    const repo = createInMemoryLiquidityRequestRepo([
      mockRow({
        state: "REQUESTED",
        requiredAmount: "100",
      }),
    ]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "99.99",
        now: new Date("2026-03-07T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestFundingAmountError);

    await expect(repo.findByIdOrThrow("liq1")).resolves.toMatchObject({
      state: "REQUESTED",
      fundedAmount: "0",
      requiredAmount: "100",
    });
  });
});

describe("createDbLiquidityRequestRepo", () => {
  it("persists sourceKind and requiredAmount on create", async () => {
    const mock = createDbMock();
    const repo = createDbLiquidityRequestRepo(mock.db);
    mock.insertReturning.mockResolvedValueOnce([mockRow()]);

    const created = await repo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });

    expect(created.state).toBe("REQUESTED");
    const insertArg = mock.insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.sourceKind).toBe("FIBER_TO_CKB_CHAIN");
    expect(insertArg.requiredAmount).toBe("100");
  });

  it("throws not found when marking funded for a missing request", async () => {
    const mock = createDbMock();
    const repo = createDbLiquidityRequestRepo(mock.db);
    mock.selectLimit.mockResolvedValueOnce([]);
    mock.updateReturning.mockResolvedValueOnce([]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "100",
        now: new Date("2026-03-07T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestNotFoundError);
  });

  it("rejects markFunded when the persisted request is already FAILED", async () => {
    const mock = createDbMock();
    const repo = createDbLiquidityRequestRepo(mock.db);
    mock.selectLimit.mockResolvedValueOnce([mockRow({ state: "FAILED" })]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "100",
        now: new Date("2026-03-07T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestStateTransitionError);

    expect(mock.updateSet).not.toHaveBeenCalled();
  });

  it("rejects markFunded when the persisted request is already FUNDED", async () => {
    const mock = createDbMock();
    const repo = createDbLiquidityRequestRepo(mock.db);
    const now = new Date("2026-03-07T01:00:00.000Z");
    mock.selectLimit.mockResolvedValueOnce([
      mockRow({
        state: "FUNDED",
        fundedAmount: "100",
        updatedAt: now,
        completedAt: now,
      }),
    ]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "100",
        now,
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestStateTransitionError);

    expect(mock.updateSet).not.toHaveBeenCalled();
  });

  it("rejects markFunded when fundedAmount is below requiredAmount", async () => {
    const mock = createDbMock();
    const repo = createDbLiquidityRequestRepo(mock.db);
    mock.selectLimit.mockResolvedValueOnce([
      mockRow({
        state: "REBALANCING",
        requiredAmount: "100",
      }),
    ]);

    await expect(
      repo.markFunded("liq1", {
        fundedAmount: "99.99",
        now: new Date("2026-03-07T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(LiquidityRequestFundingAmountError);

    expect(mock.updateSet).not.toHaveBeenCalled();
  });
});
