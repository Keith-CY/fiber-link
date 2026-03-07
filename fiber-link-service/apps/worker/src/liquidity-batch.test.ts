import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryLiquidityRequestRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { runLiquidityBatch } from "./liquidity-batch";

describe("runLiquidityBatch", () => {
  it("creates or advances a FIBER_TO_CKB_CHAIN rebalance and keeps withdrawals in LIQUIDITY_PENDING until funded", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const liquidityRequest = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });
    const withdrawal = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });
    const ensureChainLiquidity = vi.fn(async () => ({
      state: "PENDING" as const,
      started: true,
    }));
    const getRebalanceStatus = vi.fn(async () => ({
      state: "IDLE" as const,
    }));
    const inventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "0",
    }));

    const result = await runLiquidityBatch({
      now: new Date("2026-03-07T00:00:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    expect(result.rebalanceStarted).toBe(1);
    expect(result.promoted).toBe(0);
    expect(ensureChainLiquidity).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: liquidityRequest.id,
        requiredAmount: "100",
        asset: "CKB",
        network: "AGGRON4",
      }),
    );
    await expect(repo.findByIdOrThrow(withdrawal.id)).resolves.toMatchObject({
      state: "LIQUIDITY_PENDING",
    });
  });

  it("promotes covered withdrawals to PENDING after funding is observed", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const liquidityRequest = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "90",
    });
    const first = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "40",
      toAddress: "ckt1qfirstpending",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });
    const second = await repo.createLiquidityPending({
      appId: "app1",
      userId: "u2",
      asset: "CKB",
      amount: "30",
      toAddress: "ckt1qsecondpending",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });
    const ensureChainLiquidity = vi.fn(async () => ({
      state: "FUNDED" as const,
      started: false,
    }));
    const getRebalanceStatus = vi.fn(async () => ({
      state: "FUNDED" as const,
    }));
    const inventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "100",
    }));

    const result = await runLiquidityBatch({
      now: new Date("2026-03-07T00:05:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    expect(result.promoted).toBe(2);
    expect(result.rebalanceStarted).toBe(0);
    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "FUNDED",
    });
    await expect(repo.findByIdOrThrow(first.id)).resolves.toMatchObject({
      state: "PENDING",
    });
    await expect(repo.findByIdOrThrow(second.id)).resolves.toMatchObject({
      state: "PENDING",
    });
  });
});
