import { beforeEach, describe, expect, it } from "vitest";
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
});

