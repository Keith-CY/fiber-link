import { createInMemoryLedgerRepo, createInMemoryTipIntentRepo } from "@fiber-link/db";
import type { AnyNotificationEvent, NotificationDispatcher } from "@fiber-link/notifications";
import { describe, expect, it, vi } from "vitest";
import { markSettled } from "./settlement";

/**
 * Multi-asset regression (#444): a USDI tip settles into a USDI ledger
 * credit and the TIP_SETTLED notification carries the asset, with no CKB
 * fallback anywhere in the path.
 */
describe("markSettled multi-asset", () => {
  it("credits the ledger and dispatches TIP_SETTLED with asset USDI", async () => {
    const tipIntentRepo = createInMemoryTipIntentRepo();
    const ledgerRepo = createInMemoryLedgerRepo();

    await tipIntentRepo.create({
      appId: "app-1",
      postId: "post-1",
      fromUserId: "tipper",
      toUserId: "creator",
      asset: "USDI",
      amount: "12.5",
      invoice: "inv-usdi-1",
    });

    const dispatchTipSettledEvent = vi.fn(async (_event: AnyNotificationEvent) => ({ delivered: 0, failed: 0 }));
    const dispatcher = {
      dispatchTipSettledEvent,
      dispatchWithdrawalEvent: vi.fn(async (_event: AnyNotificationEvent) => ({ delivered: 0, failed: 0 })),
    } as unknown as NotificationDispatcher;

    const result = await markSettled({ invoice: "inv-usdi-1" }, { tipIntentRepo, ledgerRepo, dispatcher });

    expect(result.credited).toBe(true);
    const entries = ledgerRepo.__listForTests?.() ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ asset: "USDI", amount: "12.5", userId: "creator" });

    expect(dispatchTipSettledEvent).toHaveBeenCalledOnce();
    expect(dispatchTipSettledEvent.mock.calls[0][0]).toMatchObject({
      type: "TIP_SETTLED",
      asset: "USDI",
      amount: "12.5",
      invoice: "inv-usdi-1",
    });

    const balance = await ledgerRepo.getBalance({ appId: "app-1", userId: "creator", asset: "USDI" });
    expect(balance).toBe("12.5");
    // No cross-asset bleed: the CKB balance stays zero.
    const ckb = await ledgerRepo.getBalance({ appId: "app-1", userId: "creator", asset: "CKB" });
    expect(ckb).toBe("0");
  });
});
