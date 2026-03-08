import { describe, expect, it, vi } from "vitest";
import type { ChannelRecord } from "@fiber-link/fiber-adapter";
import {
  computeRequiredOpenFundingAmount,
  executeChannelRotation,
  selectLegacyChannel,
} from "./channel-rotation";

describe("channel rotation", () => {
  it("selects the largest eligible ready channel by local balance", () => {
    const selected = selectLegacyChannel({
      minRecoverableAmount: "30",
      channels: [
        {
          channelId: "0xsmall",
          state: "CHANNEL_READY",
          localBalance: "4000000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
        {
          channelId: "0xlegacy",
          state: "CHANNEL_READY",
          localBalance: "15000000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
      ],
    });

    expect(selected?.channelId).toBe("0xlegacy");
  });

  it("ignores channels that are not ready, have pending tlcs, or are below minimum recoverable balance", () => {
    const selected = selectLegacyChannel({
      minRecoverableAmount: "30",
      channels: [
        {
          channelId: "0xpending",
          state: "CHANNEL_READY",
          localBalance: "15000000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 1,
        },
        {
          channelId: "0xclosed",
          state: "CLOSED",
          localBalance: "50000000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
        {
          channelId: "0xtiny",
          state: "CHANNEL_READY",
          localBalance: "2900000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
      ],
    });

    expect(selected).toBeNull();
  });

  it("adds peer accept funding on top of the target local reserve when opening a replacement channel", () => {
    expect(
      computeRequiredOpenFundingAmount({
        targetLocalBalance: "6100000000",
        openChannelAutoAcceptMinFundingAmount: "10000000000",
        acceptChannelFundingAmount: "9900000000",
      }),
    ).toBe("16000000000");

    expect(
      computeRequiredOpenFundingAmount({
        targetLocalBalance: "12300000000",
        openChannelAutoAcceptMinFundingAmount: "10000000000",
        acceptChannelFundingAmount: "9900000000",
      }),
    ).toBe("22200000000");
  });

  it("executes channel rotation with replacement open followed by legacy shutdown", async () => {
    const openChannel = vi.fn(async () => ({ temporaryChannelId: "0xreplacement" }));
    const acceptChannel = vi.fn(async () => ({ newChannelId: "0xreplacement-ready" }));
    const getCkbChannelAcceptancePolicy = vi.fn(async () => ({
      openChannelAutoAcceptMinFundingAmount: "10000000000",
      acceptChannelFundingAmount: "9900000000",
    }));
    const shutdownChannel = vi.fn(async () => ({}));
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
          {
            channelId: "0xreplacement-ready",
            state: "CHANNEL_READY" as const,
            localBalance: "10000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      }));
    const channels: ChannelRecord[] = [
      {
        channelId: "0xlegacy",
        state: "CHANNEL_READY",
        localBalance: "15000000000",
        remoteBalance: "0",
        remotePubkey: "0xpeer",
        pendingTlcCount: 0,
      },
    ];

    const result = await executeChannelRotation({
      liquidityRequestId: "liq-1",
      shortfallAmount: "123",
      bootstrapReserve: "61",
      minRecoverableAmount: "30",
      channels,
      listChannels,
      openChannel,
      acceptChannel,
      getCkbChannelAcceptancePolicy,
      shutdownChannel,
      replacementReadyTimeoutMs: 10,
      replacementReadyPollIntervalMs: 1,
    });

    expect(result.legacyChannelId).toBe("0xlegacy");
    expect(result.replacementChannelId).toBe("0xreplacement-ready");
    expect(result.expectedRecoveredAmount).toBe("249");
    expect(result.replacementFundingAmount).toBe("160");
    expect(result.acceptFundingAmount).toBe("99");
    expect(openChannel).toHaveBeenCalledWith({
      peerId: "0xpeer",
      fundingAmount: "16000000000",
    });
    expect(acceptChannel).toHaveBeenCalledWith({
      temporaryChannelId: "0xreplacement",
      fundingAmount: "9900000000",
    });
    expect(listChannels).toHaveBeenCalledWith({
      includeClosed: false,
      peerId: "0xpeer",
    });
    expect(shutdownChannel).toHaveBeenCalledWith({
      channelId: "0xlegacy",
    });
  });

  it("rejects rotation when bootstrap reserve is below replacement open requirement", async () => {
    await expect(
      executeChannelRotation({
        liquidityRequestId: "liq-1",
        shortfallAmount: "123",
        bootstrapReserve: "0",
        minRecoverableAmount: "30",
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY",
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
        listChannels: async () => ({ channels: [] }),
        openChannel: async () => ({ temporaryChannelId: "0xreplacement" }),
        acceptChannel: async () => ({ newChannelId: "0xreplacement-ready" }),
        getCkbChannelAcceptancePolicy: async () => ({
          openChannelAutoAcceptMinFundingAmount: "10000000000",
          acceptChannelFundingAmount: "9900000000",
        }),
        shutdownChannel: async () => ({}),
      }),
    ).rejects.toThrow("bootstrap reserve");
  });

  it("ignores already-accepted peer errors while waiting for replacement readiness", async () => {
    const result = await executeChannelRotation({
      liquidityRequestId: "liq-1",
      shortfallAmount: "123",
      bootstrapReserve: "61",
      minRecoverableAmount: "30",
      channels: [
        {
          channelId: "0xlegacy",
          state: "CHANNEL_READY",
          localBalance: "15000000000",
          remoteBalance: "0",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
      ],
      listChannels: async () => ({
        channels: [
          {
            channelId: "0xlegacy",
            state: "CHANNEL_READY",
            localBalance: "15000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
          {
            channelId: "0xreplacement-ready",
            state: "CHANNEL_READY",
            localBalance: "10000000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      }),
      openChannel: async () => ({ temporaryChannelId: "0xreplacement" }),
      acceptChannel: async () => {
        throw new Error("already accepted");
      },
      getCkbChannelAcceptancePolicy: async () => ({
        openChannelAutoAcceptMinFundingAmount: "10000000000",
        acceptChannelFundingAmount: "9900000000",
      }),
      shutdownChannel: async () => ({}),
      replacementReadyTimeoutMs: 10,
      replacementReadyPollIntervalMs: 1,
    });

    expect(result.replacementChannelId).toBe("0xreplacement-ready");
    expect(result.replacementFundingAmount).toBe("160");
  });
});
