import { beforeEach, describe, expect, it } from "vitest";
import {
  InsufficientFundsError,
  createInMemoryLedgerRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { requestWithdrawal } from "./withdrawal";

describe("requestWithdrawal", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests();
  });

  it("creates PENDING withdrawal request", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const res = await requestWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    }, { repo, ledgerRepo: ledger });

    expect(res.state).toBe("PENDING");
    const saved = await repo.findByIdOrThrow(res.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });

  it("rejects request when available balance is insufficient", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "8",
      toAddress: "ckt1q-existing",
    });

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "5",
          toAddress: "ckt1q-new",
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });
});
