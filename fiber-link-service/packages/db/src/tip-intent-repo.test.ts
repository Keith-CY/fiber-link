import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { InvoiceStateTransitionError, createDbTipIntentRepo, createInMemoryTipIntentRepo } from "./tip-intent-repo";

function createDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tip-1",
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
    invoice: "inv-1",
    invoiceState: "UNPAID",
    settlementRetryCount: 0,
    settlementNextRetryAt: null,
    settlementLastError: null,
    settlementFailureReason: null,
    settlementLastCheckedAt: new Date("2026-02-15T00:00:00.000Z"),
    createdAt: new Date("2026-02-15T00:00:00.000Z"),
    settledAt: null,
    ...overrides,
  };
}

function hasParamValue(node: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (seen.has(node)) {
    return false;
  }
  seen.add(node);

  if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
    return (node as { value?: unknown }).value === needle;
  }

  if (Array.isArray(node)) {
    return node.some((item) => hasParamValue(item, needle, seen));
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (hasParamValue(value, needle, seen)) {
      return true;
    }
  }
  return false;
}

describe("tipIntentRepo (db transition guards)", () => {
  it("rejects FAILED -> UNPAID transition instead of reopening terminal state", async () => {
    let lastWhereArg: unknown;
    const updateReturning = vi.fn(async () => {
      // If FAILED leaks into the WHERE clause, the simulated DB update succeeds and hides the transition bug.
      if (hasParamValue(lastWhereArg, "FAILED")) {
        return [createDbRow({ invoice: "inv-db-failed", invoiceState: "UNPAID" })];
      }
      return [];
    });
    const updateWhere = vi.fn((whereArg: unknown) => {
      lastWhereArg = whereArg;
      return { returning: updateReturning };
    });
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const selectLimit = vi.fn(async () => [createDbRow({ invoice: "inv-db-failed", invoiceState: "FAILED" })]);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { update, select } as unknown as DbClient;
    const repo = createDbTipIntentRepo(db);

    await expect(repo.updateInvoiceState("inv-db-failed", "UNPAID")).rejects.toBeInstanceOf(
      InvoiceStateTransitionError,
    );
  });
});

describe("tipIntentRepo (in-memory)", () => {
  const repo = createInMemoryTipIntentRepo();
  const waitTick = () => new Promise((resolve) => setTimeout(resolve, 5));

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("creates UNPAID tip intent", async () => {
    const created = await repo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-1",
    });

    expect(created.invoiceState).toBe("UNPAID");
    expect(created.settledAt).toBeNull();
    expect(created.settlementRetryCount).toBe(0);
    expect(created.settlementNextRetryAt).toBeNull();
    expect(created.settlementLastError).toBeNull();
    expect(created.settlementFailureReason).toBeNull();
    expect(created.settlementLastCheckedAt).not.toBeNull();

    const found = await repo.findByInvoiceOrThrow("inv-1");
    expect(found.id).toBe(created.id);
    expect(found.invoice).toBe("inv-1");
  });

  it("rejects duplicate invoice inserts to preserve 1:1 invoice mapping", async () => {
    await repo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-dup",
    });

    await expect(
      repo.create({
        appId: "app1",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-dup",
      }),
    ).rejects.toThrow("duplicate invoice");
  });

  it("updates invoice state idempotently", async () => {
    await repo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-2",
    });

    const first = await repo.updateInvoiceState("inv-2", "SETTLED");
    expect(first.invoiceState).toBe("SETTLED");
    expect(first.settledAt).not.toBeNull();
    expect(first.settlementRetryCount).toBe(0);
    expect(first.settlementFailureReason).toBeNull();

    const settledAt1 = first.settledAt?.getTime();
    const second = await repo.updateInvoiceState("inv-2", "SETTLED");
    expect(second.invoiceState).toBe("SETTLED");
    expect(second.settledAt?.getTime()).toBe(settledAt1);
  });

  it("preserves terminal state when replayed", async () => {
    await repo.create({
      appId: "app1",
      postId: "p2",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-2b",
    });

    await repo.updateInvoiceState("inv-2b", "SETTLED");

    const settledAgain = await repo.updateInvoiceState("inv-2b", "SETTLED");
    expect(settledAgain.invoiceState).toBe("SETTLED");
    expect(settledAgain.settledAt).not.toBeNull();
  });

  it("rejects invalid terminal transition from SETTLED to FAILED", async () => {
    await repo.create({
      appId: "app1",
      postId: "p3",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-3",
    });

    await repo.updateInvoiceState("inv-3", "SETTLED");

    await expect(repo.updateInvoiceState("inv-3", "FAILED")).rejects.toBeInstanceOf(InvoiceStateTransitionError);
  });

  it("rejects invalid terminal transition from FAILED to SETTLED", async () => {
    await repo.create({
      appId: "app1",
      postId: "p4",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-4",
    });

    await repo.updateInvoiceState("inv-4", "FAILED");
    await expect(repo.updateInvoiceState("inv-4", "SETTLED")).rejects.toBeInstanceOf(InvoiceStateTransitionError);
  });

  it("tracks transient settlement retries and can clear retry evidence", async () => {
    await repo.create({
      appId: "app1",
      postId: "p-retry",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-retry-1",
    });

    const retryPending = await repo.markSettlementRetryPending("inv-retry-1", {
      now: new Date("2026-02-11T10:00:00.000Z"),
      nextRetryAt: new Date("2026-02-11T10:01:00.000Z"),
      error: "fiber timeout",
    });
    expect(retryPending.invoiceState).toBe("UNPAID");
    expect(retryPending.settlementRetryCount).toBe(1);
    expect(retryPending.settlementFailureReason).toBe("RETRY_TRANSIENT_ERROR");
    expect(retryPending.settlementLastError).toContain("timeout");
    expect(retryPending.settlementNextRetryAt?.toISOString()).toBe("2026-02-11T10:01:00.000Z");

    const cleared = await repo.clearSettlementFailure("inv-retry-1", {
      now: new Date("2026-02-11T10:02:00.000Z"),
    });
    expect(cleared.invoiceState).toBe("UNPAID");
    expect(cleared.settlementRetryCount).toBe(0);
    expect(cleared.settlementNextRetryAt).toBeNull();
    expect(cleared.settlementLastError).toBeNull();
    expect(cleared.settlementFailureReason).toBeNull();
  });

  it("marks terminal settlement failures to FAILED with evidence", async () => {
    await repo.create({
      appId: "app1",
      postId: "p-terminal",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-terminal-1",
    });

    const failed = await repo.markSettlementTerminalFailure("inv-terminal-1", {
      now: new Date("2026-02-11T11:00:00.000Z"),
      reason: "FAILED_PENDING_TIMEOUT",
      error: "invoice remained unpaid beyond timeout",
    });

    expect(failed.invoiceState).toBe("FAILED");
    expect(failed.settledAt).toBeNull();
    expect(failed.settlementFailureReason).toBe("FAILED_PENDING_TIMEOUT");
    expect(failed.settlementLastError).toContain("timeout");
    expect(failed.settlementNextRetryAt).toBeNull();
  });

  it("lists UNPAID intents with app/time filters and limit", async () => {
    const first = await repo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-list-1",
    });
    const second = await repo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u1",
      toUserId: "u3",
      asset: "USDI",
      amount: "20",
      invoice: "inv-list-2",
    });
    await repo.create({
      appId: "app-b",
      postId: "p3",
      fromUserId: "u4",
      toUserId: "u5",
      asset: "USDI",
      amount: "30",
      invoice: "inv-list-3",
    });

    await repo.updateInvoiceState("inv-list-2", "SETTLED");

    const from = new Date(first.createdAt.getTime() - 1);
    const to = new Date(second.createdAt.getTime() + 1);
    const listed = await repo.listByInvoiceState("UNPAID", {
      appId: "app-a",
      createdAtFrom: from,
      createdAtTo: to,
      limit: 1,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.appId).toBe("app-a");
    expect(listed[0]?.invoiceState).toBe("UNPAID");
  });

  it("returns UNPAID intents ordered by createdAt asc before limit", async () => {
    await repo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-order-early",
    });
    await waitTick();
    await repo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-order-late",
    });

    const listed = await repo.listByInvoiceState("UNPAID", { appId: "app-a", limit: 1 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.invoice).toBe("inv-order-early");
  });

  it("supports cursor-style pagination with createdAt+id watermark", async () => {
    const first = await repo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-page-1",
    });
    await waitTick();
    const second = await repo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-page-2",
    });
    await waitTick();
    await repo.create({
      appId: "app-a",
      postId: "p3",
      fromUserId: "u5",
      toUserId: "u6",
      asset: "USDI",
      amount: "30",
      invoice: "inv-page-3",
    });

    const page1 = await repo.listByInvoiceState("UNPAID", {
      appId: "app-a",
      limit: 2,
    });
    expect(page1.map((item) => item.invoice)).toEqual(["inv-page-1", "inv-page-2"]);

    const page2 = await repo.listByInvoiceState("UNPAID", {
      appId: "app-a",
      limit: 2,
      after: {
        createdAt: second.createdAt,
        id: second.id,
      },
    });
    expect(page2.map((item) => item.invoice)).toEqual(["inv-page-3"]);

    const page3 = await repo.listByInvoiceState("UNPAID", {
      appId: "app-a",
      limit: 2,
      after: {
        createdAt: first.createdAt,
        id: first.id,
      },
    });
    expect(page3.map((item) => item.invoice)).toEqual(["inv-page-2", "inv-page-3"]);
  });

  it("counts invoice-state backlog with app/time filters", async () => {
    await repo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-count-1",
    });
    await waitTick();
    await repo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-count-2",
    });
    const fromThirdOnly = new Date();
    await waitTick();
    await repo.create({
      appId: "app-b",
      postId: "p3",
      fromUserId: "u5",
      toUserId: "u6",
      asset: "USDI",
      amount: "30",
      invoice: "inv-count-3",
    });
    await repo.updateInvoiceState("inv-count-2", "SETTLED");

    const totalUnpaid = await repo.countByInvoiceState("UNPAID");
    expect(totalUnpaid).toBe(2);

    const appAUnpaid = await repo.countByInvoiceState("UNPAID", { appId: "app-a" });
    expect(appAUnpaid).toBe(1);

    const windowUnpaid = await repo.countByInvoiceState("UNPAID", { createdAtFrom: fromThirdOnly });
    expect(windowUnpaid).toBe(1);
  });

  describe("issue #61 transition persistence smoke", () => {
    it("maps created -> paid/settled wording to bounded UNPAID -> SETTLED contract and persists it", async () => {
      // Issue #61 mentions a broader lifecycle (created -> paid/settled -> settling -> recorded).
      // The current bounded persistence contract records that as UNPAID -> SETTLED/FAILED only.
      await repo.create({
        appId: "app-smoke",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-smoke-settled",
      });

      const settled = await repo.updateInvoiceState("inv-smoke-settled", "SETTLED");
      expect(settled.invoiceState).toBe("SETTLED");
      expect(settled.settledAt).not.toBeNull();

      const persisted = await repo.findByInvoiceOrThrow("inv-smoke-settled");
      expect(persisted.invoiceState).toBe("SETTLED");
      expect(persisted.settledAt?.getTime()).toBe(settled.settledAt?.getTime());
    });

    it("rejects invalid terminal transitions and keeps persisted terminal state unchanged", async () => {
      await repo.create({
        appId: "app-smoke",
        postId: "p2",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-smoke-invalid-a",
      });
      await repo.updateInvoiceState("inv-smoke-invalid-a", "SETTLED");

      await expect(repo.updateInvoiceState("inv-smoke-invalid-a", "FAILED")).rejects.toBeInstanceOf(
        InvoiceStateTransitionError,
      );

      const settledStill = await repo.findByInvoiceOrThrow("inv-smoke-invalid-a");
      expect(settledStill.invoiceState).toBe("SETTLED");
      expect(settledStill.settledAt).not.toBeNull();

      await repo.create({
        appId: "app-smoke",
        postId: "p3",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-smoke-invalid-b",
      });
      await repo.updateInvoiceState("inv-smoke-invalid-b", "FAILED");

      await expect(repo.updateInvoiceState("inv-smoke-invalid-b", "SETTLED")).rejects.toBeInstanceOf(
        InvoiceStateTransitionError,
      );

      const failedStill = await repo.findByInvoiceOrThrow("inv-smoke-invalid-b");
      expect(failedStill.invoiceState).toBe("FAILED");
      expect(failedStill.settledAt).toBeNull();
    });

    it("keeps idempotent retry updates stable for terminal states", async () => {
      await repo.create({
        appId: "app-smoke",
        postId: "p4",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-smoke-retry-settled",
      });

      const firstSettled = await repo.updateInvoiceState("inv-smoke-retry-settled", "SETTLED");
      const retrySettled = await repo.updateInvoiceState("inv-smoke-retry-settled", "SETTLED");
      expect(retrySettled.invoiceState).toBe("SETTLED");
      expect(retrySettled.settledAt?.getTime()).toBe(firstSettled.settledAt?.getTime());

      await repo.create({
        appId: "app-smoke",
        postId: "p5",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-smoke-retry-failed",
      });

      const firstFailed = await repo.updateInvoiceState("inv-smoke-retry-failed", "FAILED");
      const retryFailed = await repo.updateInvoiceState("inv-smoke-retry-failed", "FAILED");
      expect(retryFailed.invoiceState).toBe("FAILED");
      expect(retryFailed.settledAt).toBeNull();

      const persistedFailed = await repo.findByInvoiceOrThrow("inv-smoke-retry-failed");
      expect(persistedFailed.invoiceState).toBe(firstFailed.invoiceState);
      expect(persistedFailed.settledAt).toBeNull();
    });
  });
});

describe("tipIntentRepo (db error branches)", () => {
  it("throws TipIntentNotFoundError when clearSettlementFailure targets missing invoice", async () => {
    const updateReturning = vi.fn(async () => []);
    const updateSet = vi.fn(() => ({ returning: updateReturning }));
    const updateWhere = vi.fn(() => ({ set: updateSet }));
    const update = vi.fn(() => ({ where: updateWhere }));

    const selectLimit = vi.fn(async () => []);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { update, select } as unknown as any;
    const repo = createDbTipIntentRepo(db);

    await expect(
      repo.clearSettlementFailure("missing-invoice", {
        now: new Date("2026-02-12T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("marks settlement retry pending only when record remains UNPAID", async () => {
    const updateReturning = vi.fn(async () => []);
    const updateSet = vi.fn(() => ({ returning: updateReturning }));
    const updateWhere = vi.fn(() => ({ set: updateSet }));
    const update = vi.fn(() => ({ where: updateWhere }));

    const row = { ...createDbRow({ invoice: "inv-settled", invoiceState: "SETTLED" }), settledAt: null };
    const selectLimit = vi.fn(async () => [row]);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { update, select } as unknown as any;
    const repo = createDbTipIntentRepo(db);

    const rowAfterUpdate = await repo.markSettlementRetryPending("inv-settled", {
      now: new Date("2026-02-12T00:00:00.000Z"),
      nextRetryAt: new Date("2026-02-12T00:05:00.000Z"),
      error: "temp net issue",
    });

    expect(rowAfterUpdate.invoiceState).toBe("SETTLED");
    expect(rowAfterUpdate.settlementFailureReason).toBeNull();
    expect(updateSet).toHaveBeenCalled();
  });

  it("maps terminal failure on unresolved invoice to last known DB state", async () => {
    const updateReturning = vi.fn(async () => []);
    const updateSet = vi.fn(() => ({ returning: updateReturning }));
    const updateWhere = vi.fn(() => ({ set: updateSet }));
    const update = vi.fn(() => ({ where: updateWhere }));

    const row = { ...createDbRow({ invoice: "inv-failed", invoiceState: "FAILED" }), settledAt: null };
    const selectLimit = vi.fn(async () => [row]);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { update, select } as unknown as any;
    const repo = createDbTipIntentRepo(db);

    const saved = await repo.markSettlementTerminalFailure("inv-failed", {
      now: new Date("2026-02-12T01:00:00.000Z"),
      reason: "FAILED_RETRY_EXHAUSTED",
      error: "retry budget used",
    });

    expect(saved.invoiceState).toBe("FAILED");
    expect(saved.settlementFailureReason).toBe("FAILED_RETRY_EXHAUSTED");
  });
});

