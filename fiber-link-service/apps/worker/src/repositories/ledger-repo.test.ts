import { beforeEach, describe, expect, it } from "vitest";
import { ledgerRepo } from "./ledger-repo";

describe("ledgerRepo", () => {
  beforeEach(() => {
    ledgerRepo.__resetForTests();
  });

  it("writes one credit for new idempotency key", async () => {
    const first = await ledgerRepo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(first.applied).toBe(true);
    expect(ledgerRepo.__listForTests()).toHaveLength(1);
  });

  it("skips duplicate idempotency key", async () => {
    await ledgerRepo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });
    const second = await ledgerRepo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(second.applied).toBe(false);
    expect(ledgerRepo.__listForTests()).toHaveLength(1);
  });
});
