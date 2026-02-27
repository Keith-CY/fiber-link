import { beforeEach, describe, expect, it } from "vitest";
import {
  InsufficientFundsError,
  createInMemoryLedgerRepo,
  createInMemoryWithdrawalPolicyRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { WithdrawalPolicyViolationError, requestWithdrawal } from "./withdrawal";

describe("requestWithdrawal", () => {
  const repo = createInMemoryWithdrawalRepo();
  const policyRepo = createInMemoryWithdrawalPolicyRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
    policyRepo.__resetForTests?.();
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
    const res = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "10",
        toAddress: "ckt1q...",
      },
      { repo, ledgerRepo: ledger },
    );

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

  it("rejects when policy max-per-request is exceeded", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    await policyRepo.upsert({
      appId: "app1",
      allowedAssets: ["USDI"],
      maxPerRequest: "20",
      perUserDailyMax: "200",
      perAppDailyMax: "2000",
      cooldownSeconds: 0,
      updatedBy: "admin-1",
    });

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "21",
          toAddress: "user-withdrawal-address",
        },
        { repo, ledgerRepo: ledger, policyRepo },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "MAX_PER_REQUEST_EXCEEDED",
    });
  });

  it("rejects during cooldown window", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    await policyRepo.upsert({
      appId: "app1",
      allowedAssets: ["USDI"],
      maxPerRequest: "20",
      perUserDailyMax: "200",
      perAppDailyMax: "2000",
      cooldownSeconds: 300,
      updatedBy: "admin-1",
    });

    const now = new Date("2026-02-27T12:00:00.000Z");
    policyRepo.__setUsageForTests?.(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        now,
      },
      {
        appDailyTotal: "10",
        userDailyTotal: "10",
        lastRequestedAt: new Date("2026-02-27T11:58:00.000Z"),
      },
    );

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "5",
          toAddress: "user-withdrawal-address",
        },
        { repo, ledgerRepo: ledger, policyRepo, now },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "COOLDOWN_ACTIVE",
    });
  });

  it("enforces dynamic minimum CKB amount from destination address", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "CKB",
          amount: "10",
          toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "AMOUNT_BELOW_MIN_CAPACITY",
    });
  });
});
