import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidAmountError } from "./amount";
import type { DbClient } from "./client";
import { createDbLedgerRepo, createInMemoryLedgerRepo } from "./ledger-repo";

describe("ledgerRepo (in-memory)", () => {
  const repo = createInMemoryLedgerRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("writes one credit for new idempotency key and skips duplicates", async () => {
    const first = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(first.applied).toBe(true);
    expect(repo.__listForTests?.()).toHaveLength(1);

    const second = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(second.applied).toBe(false);
    expect(repo.__listForTests?.()).toHaveLength(1);
  });

  it("computes balance as credits minus debits", async () => {
    await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });
    await repo.debitOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "3",
      refId: "wd-1",
      idempotencyKey: "withdrawal:debit:wd-1",
    });

    const balance = await repo.getBalance({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
    });
    expect(balance).toBe("7");
  });

  it("computes balance with decimal amounts precisely", async () => {
    await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10.50",
      refId: "tip-2",
      idempotencyKey: "settlement:tip_intent:tip-2",
    });
    await repo.debitOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "3.25",
      refId: "wd-2",
      idempotencyKey: "withdrawal:debit:wd-2",
    });

    const balance = await repo.getBalance({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
    });
    expect(balance).toBe("7.25");
  });

  it("rejects non-positive ledger writes", async () => {
    await expect(
      repo.creditOnce({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
        amount: "0",
        refId: "tip-zero",
        idempotencyKey: "settlement:tip_intent:tip-zero",
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);

    await expect(
      repo.debitOnce({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
        amount: "-1",
        refId: "wd-neg",
        idempotencyKey: "withdrawal:debit:wd-neg",
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });
});

describe("ledgerRepo (db)", () => {
  function createDbRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "entry-1",
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      type: "credit",
      refId: "ref-1",
      idempotencyKey: "idem-1",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  function createDbMock({
    insertedRows = [],
    existingRows = [],
    balanceRows = [{ balance: "0" }],
    insertError,
  }: {
    insertedRows?: unknown[];
    existingRows?: unknown[];
    balanceRows?: unknown[];
    insertError?: unknown;
  }) {
    const insertReturning = vi.fn(async () => {
      if (insertError) {
        throw insertError;
      }
      return insertedRows;
    });
    const insertOnConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
    const insertValues = vi.fn(() => ({ onConflictDoNothing: insertOnConflictDoNothing }));
    const insert = vi.fn(() => ({ values: insertValues }));

    const selectLimit = vi.fn().mockResolvedValue(existingRows);
    const selectWhere = vi.fn(() => {
      const query = {
        limit: selectLimit,
        then(onFulfilled: (value: unknown[]) => unknown) {
          return Promise.resolve(balanceRows).then(onFulfilled);
        },
      };
      return query;
    });
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { insert, select } as unknown as DbClient;
    return { db, selectLimit };
  }

  it("returns applied=true when insert succeeds", async () => {
    const inserted = createDbRow();
    const { db, selectLimit } = createDbMock({ insertedRows: [inserted] });
    const repo = createDbLedgerRepo(db);

    const result = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(result.applied).toBe(true);
    expect(result.entry).toMatchObject({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      type: "credit",
    });
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("falls back to existing row when insert is deduplicated", async () => {
    const existing = createDbRow({ type: "debit", idempotencyKey: "withdrawal:debit:wd-1" });
    const { db } = createDbMock({
      insertedRows: [],
      existingRows: [existing],
    });
    const repo = createDbLedgerRepo(db);

    const result = await repo.debitOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "3",
      refId: "wd-1",
      idempotencyKey: "withdrawal:debit:wd-1",
    });

    expect(result.applied).toBe(false);
    expect(result.entry?.type).toBe("debit");
    expect(result.entry?.idempotencyKey).toBe("withdrawal:debit:wd-1");
  });

  it("swallows unique violations and returns undefined when select finds nothing", async () => {
    const { db } = createDbMock({
      insertError: { code: "23505" },
      existingRows: [],
    });
    const repo = createDbLedgerRepo(db);

    const result = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(result).toEqual({ applied: false, entry: undefined });
  });

  it("rethrows non-unique insert errors", async () => {
    const { db } = createDbMock({
      insertError: new Error("db unavailable"),
    });
    const repo = createDbLedgerRepo(db);

    await expect(
      repo.creditOnce({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
        amount: "10",
        refId: "tip-1",
        idempotencyKey: "settlement:tip_intent:tip-1",
      }),
    ).rejects.toThrow("db unavailable");
  });

  it("returns computed balance and defaults to 0 when row is absent", async () => {
    const withBalance = createDbMock({
      insertedRows: [],
      existingRows: [],
      balanceRows: [{ balance: "7.25" }],
    });
    const repoWithBalance = createDbLedgerRepo(withBalance.db);
    await repoWithBalance.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "1",
      refId: "tip-1",
      idempotencyKey: "id-1",
    });
    expect(
      await repoWithBalance.getBalance({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
      }),
    ).toBe("7.25");

    const withoutBalance = createDbMock({
      insertedRows: [],
      existingRows: [],
      balanceRows: [],
    });
    const repoWithoutBalance = createDbLedgerRepo(withoutBalance.db);
    await repoWithoutBalance.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "1",
      refId: "tip-1",
      idempotencyKey: "id-2",
    });
    expect(
      await repoWithoutBalance.getBalance({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
      }),
    ).toBe("0");
  });
});
