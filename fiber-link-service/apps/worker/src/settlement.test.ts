import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  settlementCreditIdempotencyKey,
} from "@fiber-link/db";
import { markSettled } from "./settlement";

describe("settlement worker", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
  });

  it("credits recipient once using tip_intent idempotency source", async () => {
    const intent = await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-1",
    });

    const res = await markSettled({ invoice: "inv-1" }, { tipIntentRepo, ledgerRepo });
    expect(res.credited).toBe(true);

    const ledgerEntries = ledgerRepo.__listForTests();
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].idempotencyKey).toBe(settlementCreditIdempotencyKey(intent.id));
  });

  it("keeps one credit when concurrent workers process the same invoice", async () => {
    const intent = await tipIntentRepo.create({
      appId: "app1",
      postId: "p-concurrent",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-concurrent-1",
    });

    const [first, second] = await Promise.all([
      markSettled({ invoice: intent.invoice }, { tipIntentRepo, ledgerRepo }),
      markSettled({ invoice: intent.invoice }, { tipIntentRepo, ledgerRepo }),
    ]);

    expect([first.credited, second.credited].filter(Boolean)).toHaveLength(1);
    const entries = ledgerRepo.__listForTests?.() ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].idempotencyKey).toBe(settlementCreditIdempotencyKey(intent.id));
  });

  it("ignores duplicate settlement events for same tip_intent", async () => {
    await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-2",
    });

    const first = await markSettled({ invoice: "inv-2" }, { tipIntentRepo, ledgerRepo });
    const second = await markSettled({ invoice: "inv-2" }, { tipIntentRepo, ledgerRepo });
    expect(first.credited).toBe(true);
    expect(second.credited).toBe(false);
    expect(ledgerRepo.__listForTests()).toHaveLength(1);
  });

  it("marks invoice SETTLED even when credit already exists from previous attempt", async () => {
    const intent = await tipIntentRepo.create({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-recover-1",
    });

    await ledgerRepo.creditOnce({
      appId: intent.appId,
      userId: intent.toUserId,
      asset: intent.asset,
      amount: intent.amount,
      refId: intent.id,
      idempotencyKey: settlementCreditIdempotencyKey(intent.id),
    });

    const result = await markSettled({ invoice: intent.invoice }, { tipIntentRepo, ledgerRepo });
    expect(result.credited).toBe(false);

    const saved = await tipIntentRepo.findByInvoiceOrThrow(intent.invoice);
    expect(saved.invoiceState).toBe("SETTLED");
    expect(saved.settledAt).not.toBeNull();
  });

  it("fails settlement when invoice does not resolve to exactly one tip_intent", async () => {
    await expect(markSettled({ invoice: "missing-invoice" }, { tipIntentRepo, ledgerRepo })).rejects.toThrow(
      "tip intent not found",
    );
  });
});
