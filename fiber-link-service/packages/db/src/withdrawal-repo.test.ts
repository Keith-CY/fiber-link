import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { createInMemoryLedgerRepo } from "./ledger-repo";
import {
  InsufficientFundsError,
  WithdrawalNotFoundError,
  WithdrawalTransitionConflictError,
  createDbWithdrawalRepo,
  createInMemoryWithdrawalRepo,
} from "./withdrawal-repo";

type DbMock = {
  db: DbClient;
  updateSet: ReturnType<typeof vi.fn>;
  updateReturning: ReturnType<typeof vi.fn>;
  selectLimit: ReturnType<typeof vi.fn>;
};

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    appId: "app1",
    userId: "u1",
    asset: "USDI",
    amount: "10",
    toAddress: "ckt1q...",
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: new Date("2026-02-07T00:00:00.000Z"),
    updatedAt: new Date("2026-02-07T00:00:00.000Z"),
    completedAt: null,
    txHash: null,
    ...overrides,
  };
}

function createDbMock(): DbMock {
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
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

  return { db, updateSet, updateReturning, selectLimit };
}

describe("createDbWithdrawalRepo", () => {
  it("throws transition conflict when markProcessing update affects no rows but record exists", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.updateReturning.mockResolvedValueOnce([]);
    mock.selectLimit.mockResolvedValueOnce([mockRow({ state: "PROCESSING" })]);

    await expect(repo.markProcessing("w1", new Date())).rejects.toBeInstanceOf(WithdrawalTransitionConflictError);
  });

  it("throws not found when markProcessing update affects no rows and record is missing", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.updateReturning.mockResolvedValueOnce([]);
    mock.selectLimit.mockResolvedValueOnce([]);

    await expect(repo.markProcessing("w1", new Date())).rejects.toBeInstanceOf(WithdrawalNotFoundError);
  });

  it("uses SQL expression to atomically increment retryCount in markRetryPending", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.updateReturning.mockResolvedValueOnce([mockRow({ state: "RETRY_PENDING", retryCount: 2 })]);
    await repo.markRetryPending("w1", {
      now: new Date("2026-02-07T00:00:00.000Z"),
      nextRetryAt: new Date("2026-02-07T00:01:00.000Z"),
      error: "node busy",
    });

    const setArg = mock.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.retryCount).not.toBe(2);
    expect(setArg.state).toBe("RETRY_PENDING");
  });

  it("persists txHash when marking withdrawal completed", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);
    const now = new Date("2026-02-07T00:02:00.000Z");

    mock.updateReturning.mockResolvedValueOnce([
      mockRow({ state: "COMPLETED", completedAt: now, updatedAt: now, txHash: "0xabc123" }),
    ]);

    const saved = await repo.markCompleted("w1", {
      now,
      txHash: "0xabc123",
    });

    expect(saved.txHash).toBe("0xabc123");
    const setArg = mock.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.txHash).toBe("0xabc123");
  });
});

describe("createInMemoryWithdrawalRepo balance gating", () => {
  it("rejects when pending withdrawals exceed available balance", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();

    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "8",
      toAddress: "addr",
    });

    await expect(
      repo.createWithBalanceCheck(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "5",
          toAddress: "addr2",
        },
        { ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("accepts when available balance covers request", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();

    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "8",
      toAddress: "addr",
    });

    const created = await repo.createWithBalanceCheck(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "2",
        toAddress: "addr2",
      },
      { ledgerRepo: ledger },
    );

    expect(created.state).toBe("PENDING");
  });
});
