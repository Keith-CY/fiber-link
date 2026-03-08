import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { InvalidAmountError } from "./amount";
import { withdrawalDebitIdempotencyKey } from "./idempotency";
import { createInMemoryLedgerRepo } from "./ledger-repo";
import { withdrawals } from "./schema";
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
  selectWhere: ReturnType<typeof vi.fn>;
};

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    appId: "app1",
    userId: "u1",
    asset: "USDI",
    amount: "10",
    destinationKind: "PAYMENT_REQUEST",
    toAddress: "ckt1q...",
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: new Date("2026-02-07T00:00:00.000Z"),
    updatedAt: new Date("2026-02-07T00:00:00.000Z"),
    completedAt: null,
    txHash: null,
    liquidityRequestId: null,
    liquidityPendingReason: null,
    liquidityCheckedAt: null,
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

  return { db, updateSet, updateReturning, selectLimit, selectWhere };
}

function collectSqlTokens(node: unknown): string[] {
  const tokens: string[] = [];

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "string") {
      tokens.push(value);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }

    if ("value" in value) {
      const current = (value as { value: unknown }).value;
      if (Array.isArray(current)) {
        current.forEach(walk);
      } else if (typeof current === "string") {
        tokens.push(current);
      }
    }

    if ("name" in value && typeof (value as { name?: unknown }).name === "string") {
      tokens.push((value as { name: string }).name);
    }

    if ("queryChunks" in value) {
      walk((value as { queryChunks: unknown }).queryChunks);
    }
  }

  walk(node);
  return tokens;
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

  it("uses SQL expression to keep retryCount unchanged when markFailed does not increment", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);
    const now = new Date("2026-02-07T00:03:00.000Z");

    mock.updateReturning.mockResolvedValueOnce([
      mockRow({ state: "FAILED", retryCount: 2, updatedAt: now, lastError: "permanent failure" }),
    ]);

    await repo.markFailed("w1", {
      now,
      error: "permanent failure",
    });

    const setArg = mock.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.retryCount).not.toBe(withdrawals.retryCount);
  });

  it("acquires advisory lock and rejects when balance is insufficient", async () => {
    const selectWhere = vi.fn()
      .mockResolvedValueOnce([{ balance: "1" }])
      .mockResolvedValueOnce([{ total: "0" }]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));
    const tx = {
      execute: vi.fn(),
      select,
    } as unknown as DbClient;
    const db = {
      transaction: vi.fn(async (fn: (client: DbClient) => Promise<unknown>) => fn(tx)),
    } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    await expect(
      repo.createWithBalanceCheck(
        { appId: "app1", userId: "u1", asset: "USDI", amount: "2", toAddress: "ckt1q..." },
        { ledgerRepo: createInMemoryLedgerRepo() },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect((db as { transaction: ReturnType<typeof vi.fn> }).transaction).toHaveBeenCalledTimes(1);
    expect((tx as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1);
  });

  it("infers destination kind from CKB address in create()", async () => {
    const insertReturning = vi.fn().mockResolvedValueOnce([
      mockRow({
        destinationKind: "CKB_ADDRESS",
        toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      }),
    ]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insert = vi.fn(() => ({ values: insertValues }));
    const db = { insert } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
    });

    expect(created.destinationKind).toBe("CKB_ADDRESS");
    const valuesArg = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.destinationKind).toBe("CKB_ADDRESS");
  });

  it("uses explicit destination kind override in create()", async () => {
    const insertReturning = vi.fn().mockResolvedValueOnce([
      mockRow({
        destinationKind: "PAYMENT_REQUEST",
        toAddress: "fiber:invoice:abc",
      }),
    ]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insert = vi.fn(() => ({ values: insertValues }));
    const db = { insert } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:abc",
      destinationKind: "PAYMENT_REQUEST",
    });

    expect(created.destinationKind).toBe("PAYMENT_REQUEST");
    const valuesArg = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.destinationKind).toBe("PAYMENT_REQUEST");
  });

  it("creates LIQUIDITY_PENDING withdrawals with linked liquidity fields", async () => {
    const insertReturning = vi.fn().mockResolvedValueOnce([
      mockRow({
        state: "LIQUIDITY_PENDING",
        asset: "CKB",
        amount: "61",
        destinationKind: "CKB_ADDRESS",
        toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        liquidityRequestId: "liq1",
        liquidityPendingReason: "hot wallet underfunded",
        liquidityCheckedAt: new Date("2026-03-07T00:00:00.000Z"),
      }),
    ]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insert = vi.fn(() => ({ values: insertValues }));
    const db = { insert } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    const created = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });

    expect(created.state).toBe("LIQUIDITY_PENDING");
    expect(created.liquidityRequestId).toBe("liq1");
    expect(created.liquidityPendingReason).toBe("hot wallet underfunded");
    const valuesArg = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.state).toBe("LIQUIDITY_PENDING");
    expect(valuesArg.liquidityRequestId).toBe("liq1");
    expect(valuesArg.liquidityPendingReason).toBe("hot wallet underfunded");
    expect(valuesArg.liquidityCheckedAt).toBeInstanceOf(Date);
  });

  it("creates LIQUIDITY_PENDING with balance check under the advisory lock", async () => {
    const txSelectWhere = vi
      .fn()
      .mockResolvedValueOnce([{ balance: "100" }])
      .mockResolvedValueOnce([{ total: "20" }]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const txInsertReturning = vi.fn().mockResolvedValueOnce([
      mockRow({
        id: "w-liq",
        asset: "CKB",
        amount: "10",
        state: "LIQUIDITY_PENDING",
        destinationKind: "CKB_ADDRESS",
        toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        liquidityRequestId: "liq1",
        liquidityPendingReason: "hot wallet underfunded",
        liquidityCheckedAt: new Date("2026-03-07T00:00:00.000Z"),
      }),
    ]);
    const txInsertValues = vi.fn(() => ({ returning: txInsertReturning }));
    const txInsert = vi.fn(() => ({ values: txInsertValues }));

    const tx = {
      execute: vi.fn(),
      select: txSelect,
      insert: txInsert,
    } as unknown as DbClient;

    const db = {
      transaction: vi.fn(async (fn: (client: DbClient) => Promise<unknown>) => fn(tx)),
    } as unknown as DbClient;

    const repo = createDbWithdrawalRepo(db);
    const created = await repo.createLiquidityPendingWithBalanceCheck(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "10",
        toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        liquidityRequestId: "liq1",
        liquidityPendingReason: "hot wallet underfunded",
      },
      { ledgerRepo: createInMemoryLedgerRepo() },
    );

    expect(created.state).toBe("LIQUIDITY_PENDING");
    expect((tx as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1);
    const valuesArg = txInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.state).toBe("LIQUIDITY_PENDING");
    expect(valuesArg.liquidityRequestId).toBe("liq1");
  });

  it("promotes LIQUIDITY_PENDING withdrawals to PENDING", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);
    const now = new Date("2026-03-07T00:00:00.000Z");

    mock.updateReturning.mockResolvedValueOnce([
      mockRow({
        state: "PENDING",
        updatedAt: now,
        liquidityRequestId: "liq1",
        liquidityPendingReason: "hot wallet underfunded",
        liquidityCheckedAt: now,
      }),
    ]);

    const promoted = await repo.markPendingFromLiquidity("w1", now);

    expect(promoted.state).toBe("PENDING");
    expect(promoted.liquidityCheckedAt).toEqual(now);
    const setArg = mock.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.state).toBe("PENDING");
    expect(setArg.liquidityCheckedAt).toEqual(now);
  });

  it("throws transition conflict when markPendingFromLiquidity update affects no rows but record exists", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.updateReturning.mockResolvedValueOnce([]);
    mock.selectLimit.mockResolvedValueOnce([mockRow({ state: "PROCESSING" })]);

    await expect(repo.markPendingFromLiquidity("w1", new Date())).rejects.toBeInstanceOf(
      WithdrawalTransitionConflictError,
    );
  });

  it("throws not found when markPendingFromLiquidity update affects no rows and record is missing", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.updateReturning.mockResolvedValueOnce([]);
    mock.selectLimit.mockResolvedValueOnce([]);

    await expect(repo.markPendingFromLiquidity("w1", new Date())).rejects.toBeInstanceOf(WithdrawalNotFoundError);
  });

  it("creates with balance check when funds are sufficient", async () => {
    const txSelectWhere = vi
      .fn()
      .mockResolvedValueOnce([{ balance: "100" }])
      .mockResolvedValueOnce([{ total: "20" }]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const txInsertReturning = vi.fn().mockResolvedValueOnce([
      mockRow({
        id: "w2",
        amount: "10",
        state: "PENDING",
        destinationKind: "PAYMENT_REQUEST",
        toAddress: "fiber:invoice:new",
      }),
    ]);
    const txInsertValues = vi.fn(() => ({ returning: txInsertReturning }));
    const txInsert = vi.fn(() => ({ values: txInsertValues }));

    const tx = {
      execute: vi.fn(),
      select: txSelect,
      insert: txInsert,
    } as unknown as DbClient;

    const db = {
      transaction: vi.fn(async (fn: (client: DbClient) => Promise<unknown>) => fn(tx)),
    } as unknown as DbClient;

    const repo = createDbWithdrawalRepo(db);
    const created = await repo.createWithBalanceCheck(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "10",
        toAddress: "fiber:invoice:new",
      },
      { ledgerRepo: createInMemoryLedgerRepo() },
    );

    expect(created.id).toBe("w2");
    expect((tx as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalledTimes(1);
  });

  it("returns pending total and defaults to 0 when query is empty", async () => {
    const selectWhere = vi.fn().mockResolvedValueOnce([{ total: "12.5" }]).mockResolvedValueOnce([]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));
    const db = { select } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    const total = await repo.getPendingTotal({ appId: "app1", userId: "u1", asset: "USDI" });
    expect(total).toBe("12.5");

    const zero = await repo.getPendingTotal({ appId: "app1", userId: "u1", asset: "USDI" });
    expect(zero).toBe("0");
  });

  it("includes LIQUIDITY_PENDING in DB pending-total accounting", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.selectWhere.mockResolvedValueOnce([{ total: "80" }]);

    const total = await repo.getPendingTotal({ appId: "app1", userId: "u1", asset: "CKB" });

    expect(total).toBe("80");
    const whereArg = mock.selectWhere.mock.calls[0]?.[0];
    expect(collectSqlTokens(whereArg)).toContain("LIQUIDITY_PENDING");
  });

  it("counts only active on-chain reservations for a specific network", async () => {
    const mock = createDbMock();
    const repo = createDbWithdrawalRepo(mock.db);

    mock.selectWhere.mockResolvedValueOnce([{ total: "80" }]);

    const total = await repo.getActiveCkbAddressReservationTotal({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
    });

    expect(total).toBe("80");
    const whereArg = mock.selectWhere.mock.calls[0]?.[0];
    const tokens = collectSqlTokens(whereArg);
    expect(tokens).toContain("CKB_ADDRESS");
    expect(tokens).toContain("PENDING");
    expect(tokens).toContain("PROCESSING");
    expect(tokens).toContain("RETRY_PENDING");
    expect(tokens).toContain("ckt1%");
  });

  it("finds rows by id and lists ready withdrawals", async () => {
    const selectLimit = vi.fn().mockResolvedValueOnce([mockRow({ id: "wf" })]);
    const selectWhere = vi
      .fn()
      .mockImplementationOnce(() => ({ limit: selectLimit }))
      .mockResolvedValueOnce([mockRow({ id: "p1", state: "PENDING" })])
      .mockResolvedValueOnce([
        mockRow({ id: "r1", state: "RETRY_PENDING", nextRetryAt: new Date("2026-02-07T00:00:00.000Z") }),
      ]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));
    const db = { select } as unknown as DbClient;
    const repo = createDbWithdrawalRepo(db);

    const found = await repo.findByIdOrThrow("wf");
    expect(found.id).toBe("wf");

    const ready = await repo.listReadyForProcessing(new Date("2026-02-07T00:01:00.000Z"));
    expect(ready.map((item) => item.id)).toEqual(["p1", "r1"]);
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

  it("creates a withdrawal in LIQUIDITY_PENDING with linked liquidity request", async () => {
    const repo = createInMemoryWithdrawalRepo();

    const created = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });

    expect(created.state).toBe("LIQUIDITY_PENDING");
    expect(created.liquidityRequestId).toBe("liq1");
    expect(created.liquidityPendingReason).toBe("hot wallet underfunded");
    expect(created.liquidityCheckedAt).toBeInstanceOf(Date);
  });

  it("promotes liquidity pending withdrawal to PENDING", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const created = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });

    const beforePromotion = await repo.listReadyForProcessing(new Date("2026-03-07T00:00:00.000Z"));
    expect(beforePromotion).toEqual([]);

    const promoted = await repo.markPendingFromLiquidity(created.id, new Date("2026-03-07T00:00:00.000Z"));

    expect(promoted.state).toBe("PENDING");
    expect(promoted.liquidityCheckedAt).toEqual(new Date("2026-03-07T00:00:00.000Z"));

    const afterPromotion = await repo.listReadyForProcessing(new Date("2026-03-07T00:00:00.000Z"));
    expect(afterPromotion.map((item) => item.id)).toEqual([created.id]);
  });

  it("lists only liquidity pending withdrawals", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const pending = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "5",
      toAddress: "ckt1qready",
    });

    const listed = await repo.listLiquidityPending();

    expect(listed.map((item) => item.id)).toEqual([pending.id]);
    expect(listed[0]?.state).toBe("LIQUIDITY_PENDING");
  });

  it("counts LIQUIDITY_PENDING withdrawals as reserved in balance gating", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();

    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "80",
      toAddress: "ckt1qpending",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });

    await expect(
      repo.createWithBalanceCheck(
        {
          appId: "app1",
          userId: "u1",
          asset: "CKB",
          amount: "21",
          toAddress: "ckt1qnext",
        },
        { ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    await expect(repo.getPendingTotal({ appId: "app1", userId: "u1", asset: "CKB" })).resolves.toBe("80");
  });

  it("creates LIQUIDITY_PENDING with balance check and rejects oversubscription", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();

    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.createLiquidityPendingWithBalanceCheck(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "80",
        toAddress: "ckt1qpending",
        liquidityRequestId: "liq1",
        liquidityPendingReason: "hot wallet underfunded",
      },
      { ledgerRepo: ledger },
    );

    await expect(
      repo.createLiquidityPendingWithBalanceCheck(
        {
          appId: "app1",
          userId: "u1",
          asset: "CKB",
          amount: "21",
          toAddress: "ckt1qnext",
          liquidityRequestId: "liq2",
          liquidityPendingReason: "hot wallet underfunded",
        },
        { ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("counts only active CKB address reservations for the requested network", async () => {
    const repo = createInMemoryWithdrawalRepo();

    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "30",
      toAddress: "ckt1qtestnet",
    });
    const mainnet = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "15",
      toAddress: "ckb1qmainnet",
    });
    await repo.markProcessing(mainnet.id, new Date("2026-03-07T00:00:00.000Z"));
    await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "80",
      toAddress: "ckt1qliquidity",
      liquidityRequestId: "liq1",
      liquidityPendingReason: "hot wallet underfunded",
    });

    await expect(
      repo.getActiveCkbAddressReservationTotal({
        appId: "app1",
        asset: "CKB",
        network: "AGGRON4",
      }),
    ).resolves.toBe("30");
    await expect(
      repo.getActiveCkbAddressReservationTotal({
        appId: "app1",
        asset: "CKB",
        network: "LINA",
      }),
    ).resolves.toBe("15");
  });

  it("rejects non-positive withdrawal amounts", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();

    await expect(
      repo.createWithBalanceCheck(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "0",
          toAddress: "addr-zero",
        },
        { ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(InvalidAmountError);

    await expect(
      repo.create({
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "-1",
        toAddress: "addr-neg",
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it("guards duplicate completion retries from producing extra debit entries", async () => {
    const ledger = createInMemoryLedgerRepo();
    const repo = createInMemoryWithdrawalRepo();
    const request = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "4",
      toAddress: "fiber:invoice:wd-idem",
    });

    await repo.markProcessing(request.id, new Date("2026-02-12T00:00:00.000Z"));
    await repo.markCompletedWithDebit(
      request.id,
      { now: new Date("2026-02-12T00:00:05.000Z"), txHash: "0xidem" },
      { ledgerRepo: ledger },
    );

    await expect(
      repo.markCompletedWithDebit(
        request.id,
        { now: new Date("2026-02-12T00:00:06.000Z"), txHash: "0xidem-retry" },
        { ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(WithdrawalTransitionConflictError);

    const entries = ledger.__listForTests?.() ?? [];
    const debitEntries = entries.filter((entry) => entry.idempotencyKey === withdrawalDebitIdempotencyKey(request.id));
    expect(debitEntries).toHaveLength(1);
  });
});
