import { createInMemoryLiquidityRequestRepo } from "@fiber-link/db";
import { describe, expect, it, vi } from "vitest";
import { decideWithdrawalRequestLiquidity } from "./liquidity";

describe("decideWithdrawalRequestLiquidity", () => {
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
      requiredAmount: "61",
    });
  });
});
