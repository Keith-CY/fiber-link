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
        destination: {
          kind: "PAYMENT_REQUEST",
          paymentRequest: "fiber:invoice:create-pending",
        },
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
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:insufficient",
          },
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
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:policy-max",
          },
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
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:cooldown",
          },
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
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "AMOUNT_BELOW_MIN_CAPACITY",
    });
  });

  it("rejects when asset is not allowed by policy", async () => {
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
      allowedAssets: ["CKB"],
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
          amount: "5",
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:asset-not-allowed",
          },
        },
        { repo, ledgerRepo: ledger, policyRepo },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "ASSET_NOT_ALLOWED",
    });
  });

  it("rejects when per-user daily limit is exceeded", async () => {
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
      maxPerRequest: "50",
      perUserDailyMax: "50",
      perAppDailyMax: "500",
      cooldownSeconds: 0,
      updatedBy: "admin-1",
    });

    policyRepo.__setUsageForTests?.(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        now: new Date("2026-02-27T12:00:00.000Z"),
      },
      {
        appDailyTotal: "10",
        userDailyTotal: "49",
        lastRequestedAt: null,
      },
    );

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "2",
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:user-daily-limit",
          },
        },
        { repo, ledgerRepo: ledger, policyRepo, now: new Date("2026-02-27T12:00:00.000Z") },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "PER_USER_DAILY_LIMIT_EXCEEDED",
    });
  });

  it("rejects when per-app daily limit is exceeded", async () => {
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
      maxPerRequest: "90",
      perUserDailyMax: "90",
      perAppDailyMax: "50",
      cooldownSeconds: 0,
      updatedBy: "admin-1",
    });

    policyRepo.__setUsageForTests?.(
      {
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        now: new Date("2026-02-27T12:00:00.000Z"),
      },
      {
        appDailyTotal: "49",
        userDailyTotal: "0",
        lastRequestedAt: null,
      },
    );

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "2",
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:app-daily-limit",
          },
        },
        { repo, ledgerRepo: ledger, policyRepo, now: new Date("2026-02-27T12:00:00.000Z") },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "PER_APP_DAILY_LIMIT_EXCEEDED",
    });
  });

  it("rejects CKB address destination for non-CKB asset", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "1",
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "INVALID_DESTINATION_ADDRESS",
    });
  });

  it("rejects malformed CKB address destination", async () => {
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
          amount: "20",
          destination: {
            kind: "CKB_ADDRESS",
            address: "not-a-ckb-address",
          },
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "INVALID_DESTINATION_ADDRESS",
    });
  });

  it("stores CKB address destination with CKB_ADDRESS kind when valid", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    const res = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "70",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger },
    );

    const saved = await repo.findByIdOrThrow(res.id);
    expect(saved.destinationKind).toBe("CKB_ADDRESS");
    expect(saved.toAddress).toBe("ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw");
  });

  it("falls back to defaults when env allowed-assets has no valid values", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    const prevAllowed = process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS;
    process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS = "foo,bar";
    try {
      const res = await requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "USDI",
          amount: "1",
          destination: {
            kind: "PAYMENT_REQUEST",
            paymentRequest: "fiber:invoice:env-fallback",
          },
        },
        { repo, ledgerRepo: ledger, policyRepo: null },
      );
      expect(res.state).toBe("PENDING");
    } finally {
      process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS = prevAllowed;
    }
  });

  it("throws when cooldown env is invalid", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    const prevCooldown = process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS;
    process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS = "-1";
    try {
      await expect(
        requestWithdrawal(
          {
            appId: "app1",
            userId: "u1",
            asset: "USDI",
            amount: "1",
            destination: {
              kind: "PAYMENT_REQUEST",
              paymentRequest: "fiber:invoice:bad-cooldown",
            },
          },
          { repo, ledgerRepo: ledger, policyRepo: null },
        ),
      ).rejects.toThrow("FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS must be an integer >= 0");
    } finally {
      process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS = prevCooldown;
    }
  });

  it("throws when amount env is not a positive decimal", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    const prevMax = process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST;
    process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST = "0";
    try {
      await expect(
        requestWithdrawal(
          {
            appId: "app1",
            userId: "u1",
            asset: "USDI",
            amount: "1",
            destination: {
              kind: "PAYMENT_REQUEST",
              paymentRequest: "fiber:invoice:bad-max",
            },
          },
          { repo, ledgerRepo: ledger, policyRepo: null },
        ),
      ).rejects.toThrow("FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST must be a positive decimal");
    } finally {
      process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST = prevMax;
    }
  });
});
