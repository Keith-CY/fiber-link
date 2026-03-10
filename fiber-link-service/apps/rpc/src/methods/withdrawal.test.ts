import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InsufficientFundsError,
  createInMemoryLedgerRepo,
  createInMemoryLiquidityRequestRepo,
  createInMemoryWithdrawalPolicyRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { WithdrawalPolicyViolationError, requestWithdrawal } from "./withdrawal";

describe("quoteWithdrawal", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  afterEach(() => {
    delete process.env.FIBER_WITHDRAWAL_CKB_FEE_RATE_SHANNONS_PER_KB;
  });

  it("returns available, locked, fee, receive, and destination validation", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "124",
      refId: "credit-1",
      idempotencyKey: "credit-1",
    });
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm",
    });

    const { quoteWithdrawal } = await import("./withdrawal");
    const quote = await quoteWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "62",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      },
    }, { repo, ledgerRepo: ledger });

    expect(quote.availableBalance).toBe("124");
    expect(quote.lockedBalance).toBe("61");
    expect(quote.destinationValid).toBe(true);
    expect(quote.validationMessage).toBeNull();
    expect(Number(quote.networkFee)).toBeGreaterThan(0);
    expect(Number(quote.receiveAmount)).toBeLessThan(62);
  });

  it("returns invalid destination feedback without creating side effects", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "124",
      refId: "credit-1",
      idempotencyKey: "credit-1",
    });

    const { quoteWithdrawal } = await import("./withdrawal");
    const quote = await quoteWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      destination: {
        kind: "CKB_ADDRESS",
        address: "bad-address",
      },
    }, { repo, ledgerRepo: ledger });

    expect(quote.destinationValid).toBe(false);
    expect(quote.validationMessage).toContain("CKB address");
  });
});

describe("requestWithdrawal", () => {
  const repo = createInMemoryWithdrawalRepo();
  const policyRepo = createInMemoryWithdrawalPolicyRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
    policyRepo.__resetForTests?.();
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  });

  afterEach(() => {
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER;
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE;
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER;
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

  it("rejects CKB address withdrawals when the withdrawal signer is not configured", async () => {
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;

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
          amount: "61",
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        { repo, ledgerRepo: ledger },
      ),
    ).rejects.toMatchObject<Partial<WithdrawalPolicyViolationError>>({
      name: "WithdrawalPolicyViolationError",
      reason: "WITHDRAWAL_SIGNER_UNAVAILABLE",
      message: expect.stringContaining("withdrawal signer"),
    });
  });

  it("returns PENDING when hot wallet liquidity covers withdrawal plus change reserve", async () => {
    const ledger = createInMemoryLedgerRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "122",
    }));

    const result = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger, hotWalletInventoryProvider },
    );

    expect(result.state).toBe("PENDING");
    const saved = await repo.findByIdOrThrow(result.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.liquidityRequestId).toBeNull();
    expect(hotWalletInventoryProvider).toHaveBeenCalledWith({ asset: "CKB", network: "AGGRON4" });
  });

  it("returns LIQUIDITY_PENDING and creates liquidity request when hot wallet is underfunded", async () => {
    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "60",
    }));

    const result = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger, liquidityRequestRepo, hotWalletInventoryProvider },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    const saved = await repo.findByIdOrThrow(result.id);
    expect(saved.state).toBe("LIQUIDITY_PENDING");
    expect(saved.liquidityRequestId).toBeTruthy();
    const requests = liquidityRequestRepo.__listForTests?.() ?? [];
    expect(requests).toHaveLength(1);
    expect(saved.liquidityRequestId).toBe(requests[0]?.id);
  });

  it("uses the configured CKB liquidity buffers to raise the hot wallet target", async () => {
    process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER = "1";
    process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER = "61";

    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "200",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "61.5",
    }));

    const result = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger, liquidityRequestRepo, hotWalletInventoryProvider },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    const saved = await repo.findByIdOrThrow(result.id);
    const request = await liquidityRequestRepo.findByIdOrThrow(saved.liquidityRequestId ?? "");
    expect(request.requiredAmount).toBe("122.5");
    expect(request.metadata).toMatchObject({
      targetAvailableAmount: "184",
      requestedRebalanceAmount: "122.5",
      changeReserveAmount: "61",
      effectivePostTxReserveAmount: "61",
      feeBufferAmount: "1",
      postTxReserveAmount: "0",
      warmBufferAmount: "61",
      hotWalletAvailableAmount: "61.5",
    });
  });

  it("rejects before liquidity routing when creator balance is insufficient", async () => {
    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "60",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "0",
    }));

    await expect(
      requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "CKB",
          amount: "61",
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        { repo, ledgerRepo: ledger, liquidityRequestRepo, hotWalletInventoryProvider },
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(liquidityRequestRepo.__listForTests?.()).toHaveLength(0);
  });

  it("attaches an existing open liquidity request when hot wallet is underfunded", async () => {
    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const existing = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "90",
    });
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "60",
    }));

    const result = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger, liquidityRequestRepo, hotWalletInventoryProvider },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    const saved = await repo.findByIdOrThrow(result.id);
    expect(saved.liquidityRequestId).toBe(existing.id);
    expect(liquidityRequestRepo.__listForTests?.()).toHaveLength(1);
  });

  it("routes to LIQUIDITY_PENDING when active chain reservations consume the remaining hot wallet inventory", async () => {
    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    await ledger.creditOnce({
      appId: "app1",
      userId: "u-existing",
      asset: "CKB",
      amount: "200",
      refId: "t-existing",
      idempotencyKey: "credit:t-existing",
    });
    await ledger.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "200",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });
    await repo.createWithBalanceCheck(
      {
        appId: "app1",
        userId: "u-existing",
        asset: "CKB",
        amount: "40",
        toAddress: "ckt1qreserved",
      },
      { ledgerRepo: ledger },
    );
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "100",
    }));

    const result = await requestWithdrawal(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, ledgerRepo: ledger, liquidityRequestRepo, hotWalletInventoryProvider },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
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

  it("serializes CKB-address liquidity decisions across concurrent creators", async () => {
    const concurrentRepo = createInMemoryWithdrawalRepo();
    const ledger = createInMemoryLedgerRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const previousAllowedAssets = process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS;
    const previousMaxPerRequest = process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST;
    const previousPerUserDailyMax = process.env.FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX;
    const previousPerAppDailyMax = process.env.FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX;
    const previousCooldown = process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS;
    process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS = "";
    process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST = "";
    process.env.FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX = "";
    process.env.FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX = "";
    process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS = "";

    try {
      await ledger.creditOnce({
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        amount: "100",
        refId: "t1",
        idempotencyKey: "credit:t1",
      });
      await ledger.creditOnce({
        appId: "app1",
        userId: "u2",
        asset: "CKB",
        amount: "100",
        refId: "t2",
        idempotencyKey: "credit:t2",
      });

      let releaseFirstInventoryCall: (() => void) | null = null;
      const firstInventoryCallStarted = new Promise<void>((resolve) => {
        releaseFirstInventoryCall = resolve;
      });
      let inventoryCallCount = 0;
      const hotWalletInventoryProvider = vi.fn(async () => {
        inventoryCallCount += 1;
        if (inventoryCallCount === 1) {
          await firstInventoryCallStarted;
        }
        return {
          asset: "CKB" as const,
          network: "AGGRON4" as const,
          availableAmount: "100",
        };
      });

      const firstRequest = requestWithdrawal(
        {
          appId: "app1",
          userId: "u1",
          asset: "CKB",
          amount: "61",
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        {
          repo: concurrentRepo,
          ledgerRepo: ledger,
          liquidityRequestRepo,
          hotWalletInventoryProvider,
          policyRepo: null,
        },
      );

      await Promise.resolve();
      const secondRequest = requestWithdrawal(
        {
          appId: "app1",
          userId: "u2",
          asset: "CKB",
          amount: "61",
          destination: {
            kind: "CKB_ADDRESS",
            address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
          },
        },
        {
          repo: concurrentRepo,
          ledgerRepo: ledger,
          liquidityRequestRepo,
          hotWalletInventoryProvider,
          policyRepo: null,
        },
      );

      await vi.waitFor(() => {
        expect(hotWalletInventoryProvider).toHaveBeenCalledTimes(1);
      });
      releaseFirstInventoryCall?.();

      const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);
      expect([firstResult.state, secondResult.state].sort()).toEqual([
        "LIQUIDITY_PENDING",
        "LIQUIDITY_PENDING",
      ]);
      expect(liquidityRequestRepo.__listForTests?.()).toHaveLength(1);
    } finally {
      if (previousAllowedAssets === undefined) delete process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS;
      else process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS = previousAllowedAssets;
      if (previousMaxPerRequest === undefined) delete process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST;
      else process.env.FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST = previousMaxPerRequest;
      if (previousPerUserDailyMax === undefined) delete process.env.FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX;
      else process.env.FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX = previousPerUserDailyMax;
      if (previousPerAppDailyMax === undefined) delete process.env.FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX;
      else process.env.FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX = previousPerAppDailyMax;
      if (previousCooldown === undefined) delete process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS;
      else process.env.FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS = previousCooldown;
    }
  });
});
