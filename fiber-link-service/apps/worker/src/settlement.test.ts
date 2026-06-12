import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  settlementCreditIdempotencyKey,
} from "@fiber-link/db";
import { markSettled } from "./settlement";
import { RedisSettlementPublisher, type SettlementPublisher } from "./settlement-publisher";

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

  describe("settlement publisher", () => {
    it("calls publisher.publish with the invoice after successful settlement", async () => {
      await tipIntentRepo.create({
        appId: "app1",
        postId: "p-pub",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "5",
        invoice: "inv-pub-1",
      });

      const publisher: SettlementPublisher = {
        publish: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      await markSettled({ invoice: "inv-pub-1" }, { tipIntentRepo, ledgerRepo, publisher });
      expect(publisher.publish).toHaveBeenCalledOnce();
      expect(publisher.publish).toHaveBeenCalledWith("inv-pub-1", { settledAt: expect.any(Date) });
    });

    it("publishes the settlement payload to the invoice Redis channel after credit", async () => {
      await tipIntentRepo.create({
        appId: "app1",
        postId: "p-pub-redis",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "5",
        invoice: "inv-pub-redis",
      });

      const redisPublish = vi.fn().mockResolvedValue(1);
      const publisher = new RedisSettlementPublisher(redisPublish);

      await markSettled({ invoice: "inv-pub-redis" }, { tipIntentRepo, ledgerRepo, publisher });

      expect(redisPublish).toHaveBeenCalledOnce();
      const [channel, message] = redisPublish.mock.calls[0];
      expect(channel).toBe("fiber-link:settlement:inv-pub-redis");
      const payload = JSON.parse(message);
      expect(payload).toEqual({
        invoice: "inv-pub-redis",
        status: "SETTLED",
        settledAt: expect.any(String),
      });
      const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-pub-redis");
      expect(payload.settledAt).toBe(saved.settledAt?.toISOString());
    });

    it("does not block settlement when publisher.publish throws", async () => {
      await tipIntentRepo.create({
        appId: "app1",
        postId: "p-pub-err",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "5",
        invoice: "inv-pub-err",
      });

      const publisher: SettlementPublisher = {
        publish: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
        close: vi.fn().mockResolvedValue(undefined),
      };

      await expect(
        markSettled({ invoice: "inv-pub-err" }, { tipIntentRepo, ledgerRepo, publisher }),
      ).resolves.not.toThrow();

      const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-pub-err");
      expect(saved.invoiceState).toBe("SETTLED");
    });

    it("skips publisher when none is provided", async () => {
      await tipIntentRepo.create({
        appId: "app1",
        postId: "p-no-pub",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "5",
        invoice: "inv-no-pub",
      });

      await expect(
        markSettled({ invoice: "inv-no-pub" }, { tipIntentRepo, ledgerRepo }),
      ).resolves.not.toThrow();
    });
  });
});
