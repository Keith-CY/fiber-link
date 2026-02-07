import { beforeEach, describe, expect, it } from "vitest";
import { tipIntentRepo } from "./tip-intent-repo";

describe("tipIntentRepo", () => {
  beforeEach(() => {
    tipIntentRepo.__resetForTests();
  });

  it("creates tip_intent with UNPAID state and returns stable id", async () => {
    const created = await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-1",
    });

    expect(created.id).toBeTruthy();
    expect(created.invoiceState).toBe("UNPAID");

    const found = await tipIntentRepo.findByInvoiceOrThrow("inv-1");
    expect(found.id).toBe(created.id);
  });

  it("updates invoice state idempotently", async () => {
    await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-1",
    });

    const first = await tipIntentRepo.updateInvoiceState("inv-1", "SETTLED");
    const second = await tipIntentRepo.updateInvoiceState("inv-1", "SETTLED");

    expect(first.invoiceState).toBe("SETTLED");
    expect(second.invoiceState).toBe("SETTLED");
    expect(first.settledAt?.toISOString()).toBe(second.settledAt?.toISOString());
  });

  it("rejects duplicate invoice inserts to preserve 1:1 invoice mapping", async () => {
    await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-dup",
    });

    await expect(
      tipIntentRepo.create({
        appId: "app1",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-dup",
      }),
    ).rejects.toThrow("duplicate invoice");
  });
});
