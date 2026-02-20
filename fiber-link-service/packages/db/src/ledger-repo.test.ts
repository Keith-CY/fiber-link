import { beforeEach, describe, expect, it } from "vitest";
import { InvalidAmountError } from "./amount";
import { createInMemoryLedgerRepo } from "./ledger-repo";

describe("ledgerRepo (in-memory)", () => {
  const repo = createInMemoryLedgerRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("writes one credit for new idempotency key and skips duplicates", async () => {
    const first = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(first.applied).toBe(true);
    expect(repo.__listForTests?.()).toHaveLength(1);

    const second = await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });

    expect(second.applied).toBe(false);
    expect(repo.__listForTests?.()).toHaveLength(1);
  });

  it("computes balance as credits minus debits", async () => {
    await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10",
      refId: "tip-1",
      idempotencyKey: "settlement:tip_intent:tip-1",
    });
    await repo.debitOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "3",
      refId: "wd-1",
      idempotencyKey: "withdrawal:debit:wd-1",
    });

    const balance = await repo.getBalance({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
    });
    expect(balance).toBe("7");
  });

  it("computes balance with decimal amounts precisely", async () => {
    await repo.creditOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "10.50",
      refId: "tip-2",
      idempotencyKey: "settlement:tip_intent:tip-2",
    });
    await repo.debitOnce({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "3.25",
      refId: "wd-2",
      idempotencyKey: "withdrawal:debit:wd-2",
    });

    const balance = await repo.getBalance({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
    });
    expect(balance).toBe("7.25");
  });

  it("rejects non-positive ledger writes", async () => {
    await expect(
      repo.creditOnce({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
        amount: "0",
        refId: "tip-zero",
        idempotencyKey: "settlement:tip_intent:tip-zero",
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);

    await expect(
      repo.debitOnce({
        appId: "app1",
        userId: "u2",
        asset: "USDI",
        amount: "-1",
        refId: "wd-neg",
        idempotencyKey: "withdrawal:debit:wd-neg",
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });
});
