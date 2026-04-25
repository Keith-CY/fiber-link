import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryLiquidityRequestRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { runLiquidityBatch } from "./liquidity-batch";

const originalWithdrawalPrivateKey = process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;

afterEach(() => {
  if (originalWithdrawalPrivateKey === undefined) {
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
  } else {
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = originalWithdrawalPrivateKey;
  }
});

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
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4" as const,
    }));
    const getRebalanceStatus = vi.fn(async () => ({
      state: "IDLE" as const,
    }));
    const getLiquidityCapabilities = vi.fn(async () => ({
      directRebalance: true,
      channelLifecycle: true,
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
        getLiquidityCapabilities,
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xunused" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "0",
          acceptChannelFundingAmount: "0",
        }),
        shutdownChannel: async () => ({}),
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
      metadata: {
        hotWalletAvailableAmount: "37",
      },
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
    const getLiquidityCapabilities = vi.fn(async () => ({
      directRebalance: true,
      channelLifecycle: true,
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
        getLiquidityCapabilities,
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xunused" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "0",
          acceptChannelFundingAmount: "0",
        }),
        shutdownChannel: async () => ({}),
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    expect(result.promoted).toBe(2);
    expect(result.rebalanceStarted).toBe(0);
    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "FUNDED",
      metadata: expect.objectContaining({
        hotWalletAvailableAmount: "37",
        actualRecoveredAmount: "63",
      }),
    });
    await expect(repo.findByIdOrThrow(first.id)).resolves.toMatchObject({
      state: "PENDING",
    });
    await expect(repo.findByIdOrThrow(second.id)).resolves.toMatchObject({
      state: "PENDING",
    });
  });

  it("uses targetAvailableAmount metadata when deciding whether a rebalance is funded", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const liquidityRequest = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "63",
      metadata: {
        targetAvailableAmount: "123",
      },
    });
    await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qneedstarget",
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
    const getLiquidityCapabilities = vi.fn(async () => ({
      directRebalance: true,
      channelLifecycle: true,
    }));
    const inventoryProvider = vi
      .fn(async () => ({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "61.5",
      }))
      .mockResolvedValueOnce({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "61.5",
      })
      .mockResolvedValueOnce({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "61.5",
      });

    const result = await runLiquidityBatch({
      now: new Date("2026-03-07T00:10:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        getLiquidityCapabilities,
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xunused" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "0",
          acceptChannelFundingAmount: "0",
        }),
        shutdownChannel: async () => ({}),
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    expect(result.funded).toBe(0);
    expect(result.promoted).toBe(0);
    expect(ensureChainLiquidity).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: liquidityRequest.id,
        requiredAmount: "61.5",
      }),
    );
    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "REBALANCING",
    });
  });

  it("persists local sweep tracking metadata and does not resubmit while rebalancing", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const liquidityRequest = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });
    await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qrebalancepersisted",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });

    const getLiquidityCapabilities = vi.fn(async () => ({
      directRebalance: true,
      channelLifecycle: true,
    }));
    const inventoryProvider = vi.fn(async () => ({
      asset: "CKB" as const,
      network: "AGGRON4" as const,
      availableAmount: "0",
    }));
    const ensureChainLiquidity = vi.fn(async () => ({
      state: "PENDING" as const,
      started: true,
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4" as const,
    }));
    const getRebalanceStatus = vi.fn(async () => ({
      state: "IDLE" as const,
    }));

    await runLiquidityBatch({
      now: new Date("2026-03-07T00:00:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        getLiquidityCapabilities,
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xunused" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "0",
          acceptChannelFundingAmount: "0",
        }),
        shutdownChannel: async () => ({}),
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "REBALANCING",
      metadata: expect.objectContaining({
        recoveryStrategy: "LOCAL_CKB_SWEEP",
        localLiquidityTxHash: "0xsweep",
        localLiquidityNetwork: "AGGRON4",
      }),
    });

    ensureChainLiquidity.mockClear();
    getRebalanceStatus.mockReset();
    getRebalanceStatus.mockImplementation(async () => ({ state: "PENDING" as const }));

    await runLiquidityBatch({
      now: new Date("2026-03-07T00:05:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        getLiquidityCapabilities,
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xunused" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "0",
          acceptChannelFundingAmount: "0",
        }),
        shutdownChannel: async () => ({}),
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      inventoryProvider,
    });

    expect(getRebalanceStatus).toHaveBeenCalledWith({
      requestId: liquidityRequest.id,
      txHash: "0xsweep",
      network: "AGGRON4",
    });
    expect(ensureChainLiquidity).not.toHaveBeenCalled();
  });

  it("uses channel rotation when direct rebalance is unsupported and fallback mode is enabled", async () => {
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
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
      toAddress: "ckt1qrotation",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });
    const ensureChainLiquidity = vi.fn(async () => ({
      state: "FAILED" as const,
      started: false,
      error: "unsupported",
    }));
    const getRebalanceStatus = vi.fn(async () => {
      throw new Error("getRebalanceStatus should not be called when direct rebalance is unsupported");
    });
    const getLiquidityCapabilities = vi.fn(async () => ({
      directRebalance: false,
      channelLifecycle: true,
    }));
    const listChannels = vi
      .fn(async () => ({
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY" as const,
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      }))
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY" as const,
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY" as const,
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
          {
            channelId: "0xreplacement-ready",
            state: "CHANNEL_READY" as const,
            localBalance: "10000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      });
    const openChannel = vi.fn(async () => ({ temporaryChannelId: "0xreplacement" }));
    const acceptChannel = vi.fn(async () => ({ newChannelId: "0xreplacement-ready" }));
    const getCkbChannelAcceptancePolicy = vi.fn(async () => ({
      openChannelAutoAcceptMinFundingAmount: "10000000000",
      acceptChannelFundingAmount: "9900000000",
    }));
    const shutdownChannel = vi.fn(async () => ({}));
    const inventoryProvider = vi
      .fn(async () => ({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "0",
      }))
      .mockResolvedValueOnce({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "0",
      })
      .mockResolvedValueOnce({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "0",
      });

    const result = await runLiquidityBatch({
      now: new Date("2026-03-07T00:12:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        getLiquidityCapabilities,
        listChannels,
        openChannel,
        acceptChannel,
        getCkbChannelAcceptancePolicy,
        shutdownChannel,
        ensureChainLiquidity,
        getRebalanceStatus,
      },
      fallbackMode: "channel_rotation",
      channelRotationBootstrapReserve: "61",
      channelRotationMinRecoverableAmount: "30",
      inventoryProvider,
    });

    expect(result.rebalanceStarted).toBe(0);
    expect(result.channelRotationStarted).toBe(1);
    expect(result.channelRotationCompleted).toBe(1);
    expect(result.channelRotationFailed).toBe(0);
    expect(ensureChainLiquidity).not.toHaveBeenCalled();
    expect(getRebalanceStatus).not.toHaveBeenCalled();
    expect(openChannel).toHaveBeenCalledWith({
      peerId: "0xpeer",
      fundingAmount: "16000000000",
    });
    expect(acceptChannel).toHaveBeenCalledWith({
      temporaryChannelId: "0xreplacement",
      fundingAmount: "9900000000",
    });
    expect(shutdownChannel).toHaveBeenCalledWith({
      channelId: "0xlegacy",
      closeScript: expect.any(Object),
    });
    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "REBALANCING",
      metadata: expect.objectContaining({
        recoveryStrategy: "CHANNEL_ROTATION",
        legacyChannelId: "0xlegacy",
        replacementChannelId: "0xreplacement-ready",
        expectedRecoveredAmount: "249",
        legacyChannelLocalBalance: "150",
        replacementFundingAmount: "160",
        acceptFundingAmount: "99",
      }),
    });
    await expect(repo.findByIdOrThrow(withdrawal.id)).resolves.toMatchObject({
      state: "LIQUIDITY_PENDING",
    });
  });

  it.each([
    {
      name: "fallback mode is none",
      input: {
        fallbackMode: "none" as const,
        channelRotationBootstrapReserve: "61",
        channelRotationMinRecoverableAmount: "30",
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY" as const,
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      },
      expectedError: null,
    },
    {
      name: "no eligible channels",
      input: {
        fallbackMode: "channel_rotation" as const,
        channelRotationBootstrapReserve: "61",
        channelRotationMinRecoverableAmount: "30",
        channels: [],
      },
      expectedError: "no eligible legacy channel found",
    },
    {
      name: "bootstrap reserve is insufficient",
      input: {
        fallbackMode: "channel_rotation" as const,
        channelRotationBootstrapReserve: "0",
        channelRotationMinRecoverableAmount: "30",
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY" as const,
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      },
      expectedError: "bootstrap reserve",
    },
  ])("skips channel rotation when $name", async ({ input, expectedError }) => {
    const repo = createInMemoryWithdrawalRepo();
    const liquidityRequestRepo = createInMemoryLiquidityRequestRepo();
    const liquidityRequest = await liquidityRequestRepo.create({
      appId: "app1",
      asset: "CKB",
      network: "AGGRON4",
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: "100",
    });
    await repo.createLiquidityPending({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      toAddress: "ckt1qrotation",
      liquidityRequestId: liquidityRequest.id,
      liquidityPendingReason: "hot wallet underfunded",
    });

    const result = await runLiquidityBatch({
      now: new Date("2026-03-07T00:15:00.000Z"),
      repo,
      liquidityRequestRepo,
      liquidityProvider: {
        getLiquidityCapabilities: async () => ({
          directRebalance: false,
          channelLifecycle: true,
        }),
        listChannels: async () => ({ channels: input.channels }),
        openChannel: async () => ({ temporaryChannelId: "0xreplacement" }),
        acceptChannel: async () => ({}),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "10000000000",
          acceptChannelFundingAmount: "9900000000",
        }),
        shutdownChannel: async () => ({}),
        ensureChainLiquidity: async () => ({ state: "FAILED" as const, started: false, error: "unsupported" }),
        getRebalanceStatus: async () => ({ state: "FAILED" as const, error: "unsupported" }),
      },
      fallbackMode: input.fallbackMode,
      channelRotationBootstrapReserve: input.channelRotationBootstrapReserve,
      channelRotationMinRecoverableAmount: input.channelRotationMinRecoverableAmount,
      inventoryProvider: async () => ({
        asset: "CKB" as const,
        network: "AGGRON4" as const,
        availableAmount: "0",
      }),
    });

    expect(result.channelRotationStarted).toBe(0);
    expect(result.channelRotationCompleted).toBe(0);
    expect(result.channelRotationFailed).toBe(0);
    await expect(liquidityRequestRepo.findByIdOrThrow(liquidityRequest.id)).resolves.toMatchObject({
      state: "REQUESTED",
      metadata:
        expectedError === null
          ? null
          : expect.objectContaining({
              recoveryStrategy: "CHANNEL_ROTATION",
              lastRotationError: expect.stringContaining(expectedError),
            }),
    });
  });
});
