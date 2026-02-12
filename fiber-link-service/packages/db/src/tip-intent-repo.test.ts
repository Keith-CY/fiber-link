import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryTipIntentRepo } from "./tip-intent-repo";

describe("tipIntentRepo (in-memory)", () => {
  const repo = createInMemoryTipIntentRepo();

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

    const settledAt1 = first.settledAt?.getTime();
    const second = await repo.updateInvoiceState("inv-2", "SETTLED");
    expect(second.invoiceState).toBe("SETTLED");
    expect(second.settledAt?.getTime()).toBe(settledAt1);

    const third = await repo.updateInvoiceState("inv-2", "FAILED");
    expect(third.invoiceState).toBe("FAILED");
    expect(third.settledAt).toBeNull();
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
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T10:00:10.000Z"));
      await repo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-order-late",
      });

      vi.setSystemTime(new Date("2026-02-11T10:00:00.000Z"));
      await repo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-order-early",
      });

      const listed = await repo.listByInvoiceState("UNPAID", { appId: "app-a", limit: 1 });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.invoice).toBe("inv-order-early");
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports cursor-style pagination with createdAt+id watermark", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T11:00:00.000Z"));
      const first = await repo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-page-1",
      });
      vi.setSystemTime(new Date("2026-02-11T11:00:01.000Z"));
      const second = await repo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-page-2",
      });
      vi.setSystemTime(new Date("2026-02-11T11:00:02.000Z"));
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts invoice-state backlog with app/time filters", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T12:00:00.000Z"));
      await repo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-count-1",
      });
      vi.setSystemTime(new Date("2026-02-11T12:00:01.000Z"));
      await repo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-count-2",
      });
      vi.setSystemTime(new Date("2026-02-11T12:00:02.000Z"));
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
    } finally {
      vi.useRealTimers();
    }

    const totalUnpaid = await repo.countByInvoiceState("UNPAID");
    expect(totalUnpaid).toBe(2);

    const appAUnpaid = await repo.countByInvoiceState("UNPAID", { appId: "app-a" });
    expect(appAUnpaid).toBe(1);

    const windowUnpaid = await repo.countByInvoiceState("UNPAID", {
      createdAtFrom: new Date("2026-02-11T12:00:01.500Z"),
    });
    expect(windowUnpaid).toBe(1);
  });
});
