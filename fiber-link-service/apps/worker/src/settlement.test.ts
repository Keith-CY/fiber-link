import { beforeEach, describe, expect, it } from "vitest";
import { tipIntentRepo } from "../../rpc/src/repositories/tip-intent-repo";
import { ledgerRepo } from "./repositories/ledger-repo";
import { markSettled } from "./settlement";

describe("settlement worker", () => {
  beforeEach(() => {
    tipIntentRepo.__resetForTests();
    ledgerRepo.__resetForTests();
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

    const res = await markSettled({ invoice: "inv-1" });
    expect(res.credited).toBe(true);

    const ledgerEntries = ledgerRepo.__listForTests();
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].idempotencyKey).toBe(`settlement:tip_intent:${intent.id}`);
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

    const first = await markSettled({ invoice: "inv-2" });
    const second = await markSettled({ invoice: "inv-2" });
    expect(first.credited).toBe(true);
    expect(second.credited).toBe(false);
    expect(ledgerRepo.__listForTests()).toHaveLength(1);
  });

  it("fails settlement when invoice does not resolve to exactly one tip_intent", async () => {
    await expect(markSettled({ invoice: "missing-invoice" })).rejects.toThrow(
      "invoice does not resolve to exactly one tip intent",
    );
  });
});
