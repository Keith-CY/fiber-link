import { createInMemoryLiquidityRequestRepo, createInMemoryWithdrawalRepo } from "@fiber-link/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWithdrawalRequestLiquidity } from "./liquidity";

describe("decideWithdrawalRequestLiquidity", () => {
  afterEach(() => {
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER;
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE;
    delete process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER;
  });

  it("returns PENDING for payment request destinations without querying hot wallet inventory", async () => {
    const hotWalletInventoryProvider = vi.fn();

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "USDI",
        amount: "10",
        destination: {
          kind: "PAYMENT_REQUEST",
          paymentRequest: "fiber:invoice:payment-request",
        },
      },
      { hotWalletInventoryProvider },
    );

    expect(result).toEqual({
      state: "PENDING",
      liquidityRequestId: null,
      liquidityPendingReason: null,
    });
    expect(hotWalletInventoryProvider).not.toHaveBeenCalled();
  });

  it("returns LIQUIDITY_PENDING and creates a liquidity request when the hot wallet is underfunded", async () => {
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "60",
    }));

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { hotWalletInventoryProvider, liquidityRequestRepo },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    expect(result.liquidityPendingReason).toBe("hot wallet underfunded");
    expect(hotWalletInventoryProvider).toHaveBeenCalledWith({ asset: "CKB", network: "AGGRON4" });

    const requests = liquidityRequestRepo.__listForTests?.() ?? [];
    expect(requests).toHaveLength(1);
    expect(result.liquidityRequestId).toBe(requests[0]?.id);
    expect(requests[0]).toMatchObject({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "62",
    });
  });

  it("targets a higher CKB hot wallet balance when fee, reserve, and warm buffers are configured", async () => {
    process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER = "1";
    process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE = "0";
    process.env.FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER = "61";

    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "60",
    }));

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { hotWalletInventoryProvider, liquidityRequestRepo },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    const requests = liquidityRequestRepo.__listForTests?.() ?? [];
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requiredAmount: "124",
      metadata: expect.objectContaining({
        changeReserveAmount: "61",
        effectivePostTxReserveAmount: "61",
        requiredAvailableAmount: "61",
        targetAvailableAmount: "184",
        requestedRebalanceAmount: "124",
        feeBufferAmount: "1",
        postTxReserveAmount: "0",
        warmBufferAmount: "61",
        hotWalletAvailableAmount: "60",
      }),
    });
  });

  it("attaches an existing open liquidity request for the same app asset network and source kind", async () => {
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const existing = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "60",
    }));

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { hotWalletInventoryProvider, liquidityRequestRepo },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    expect(result.liquidityRequestId).toBe(existing.id);
    expect(liquidityRequestRepo.__listForTests?.()).toHaveLength(1);
  });

  it("raises the attached liquidity request requiredAmount when the new shortfall is larger", async () => {
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const existing = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "10",
    });
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "10",
    }));

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { hotWalletInventoryProvider, liquidityRequestRepo },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
    expect(result.liquidityRequestId).toBe(existing.id);
    await expect(liquidityRequestRepo.findByIdOrThrow(existing.id)).resolves.toMatchObject({
      requiredAmount: "112",
    });
  });

  it("uses active chain reservations before deciding whether liquidity is sufficient", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const hotWalletInventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "100",
    }));
    await repo.create({
      appId: "app1",
      userId: "u-existing",
      asset: "CKB",
      amount: "40",
      toAddress: "ckt1qreserved",
    });

    const result = await decideWithdrawalRequestLiquidity(
      {
        appId: "app1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      },
      { repo, hotWalletInventoryProvider, liquidityRequestRepo },
    );

    expect(result.state).toBe("LIQUIDITY_PENDING");
  });
});
