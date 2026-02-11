import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryLedgerRepo, createInMemoryTipIntentRepo } from "@fiber-link/db";
import { runSettlementDiscovery } from "./settlement-discovery";

describe("runSettlementDiscovery", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
  });

  it("processes UNPAID intents and applies state transitions from invoice status", async () => {
    const settled = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-scan-settled",
    });
    const failed = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-scan-failed",
    });
    await tipIntentRepo.create({
      appId: "app-a",
      postId: "p3",
      fromUserId: "u5",
      toUserId: "u6",
      asset: "USDI",
      amount: "30",
      invoice: "inv-scan-unpaid",
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus({ invoice }: { invoice: string }) {
          if (invoice === settled.invoice) return { state: "SETTLED" as const };
          if (invoice === failed.invoice) return { state: "FAILED" as const };
          return { state: "UNPAID" as const };
        },
      },
    });

    expect(summary.scanned).toBe(3);
    expect(summary.settledCredits).toBe(1);
    expect(summary.settledDuplicates).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.stillUnpaid).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("is idempotent for replays and marks settled when credit already exists", async () => {
    const intent = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-replay",
    });

    await ledgerRepo.creditOnce({
      appId: intent.appId,
      userId: intent.toUserId,
      asset: intent.asset,
      amount: intent.amount,
      refId: intent.id,
      idempotencyKey: `settlement:tip_intent:${intent.id}`,
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus() {
          return { state: "SETTLED" as const };
        },
      },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.settledCredits).toBe(0);
    expect(summary.settledDuplicates).toBe(1);
    expect(summary.errors).toBe(0);

    const saved = await tipIntentRepo.findByInvoiceOrThrow(intent.invoice);
    expect(saved.invoiceState).toBe("SETTLED");
  });

  it("supports app and time-window filters for backfill", async () => {
    const inWindow = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-window-1",
    });
    await tipIntentRepo.create({
      appId: "app-b",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-window-2",
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      appId: "app-a",
      createdAtFrom: new Date(inWindow.createdAt.getTime() - 1),
      createdAtTo: new Date(inWindow.createdAt.getTime() + 1),
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus() {
          return { state: "UNPAID" as const };
        },
      },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.stillUnpaid).toBe(1);
  });
});
