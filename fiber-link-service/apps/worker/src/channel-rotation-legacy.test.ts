import { describe, expect, it, vi } from "vitest";
import {
  isIgnorableAcceptChannelError,
  selectSeededLegacyChannel,
  waitForSeededLegacyChannelReady,
} from "./channel-rotation-legacy";

describe("channel rotation legacy seed", () => {
  it("selects the largest eligible ready channel by local balance", () => {
    const selected = selectSeededLegacyChannel(
      [
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
      "12300000000",
    );

    expect(selected?.channelId).toBe("0xlegacy");
  });

  it("retries acceptChannel while a seeded channel is stalled before becoming ready", async () => {
    const listChannels = vi
      .fn()
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xnew",
            state: "NEGOTIATING_FUNDING",
            localBalance: "12300000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xnew",
            state: "AWAITING_TX_SIGNATURES",
            localBalance: "12300000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xnew",
            state: "AWAITING_TX_SIGNATURES",
            localBalance: "12300000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        channels: [
          {
            channelId: "0xnew",
            state: "CHANNEL_READY",
            localBalance: "12300000000",
            remoteBalance: "0",
            remotePubkey: "0xpeer",
            pendingTlcCount: 0,
          },
        ],
      });

    const acceptChannel = vi.fn(async () => {
      throw new Error("No channel with temp id found");
    });
    const onAcceptRetry = vi.fn();

    const readyChannel = await waitForSeededLegacyChannelReady({
      peerId: "0xpeer",
      existingChannelIds: new Set<string>(),
      listChannels,
      acceptChannel,
      temporaryChannelId: "0xtmp",
      acceptFundingAmount: "9900000000",
      timeoutMs: 50,
      pollIntervalMs: 0,
      acceptRetryInterval: 2,
      onAcceptRetry,
      delayFn: async () => {},
    });

    expect(readyChannel.channelId).toBe("0xnew");
    expect(acceptChannel).toHaveBeenCalledWith({
      temporaryChannelId: "0xtmp",
      fundingAmount: "9900000000",
    });
    expect(onAcceptRetry).toHaveBeenCalledWith({
      attempt: 2,
      observedState: "AWAITING_TX_SIGNATURES",
      temporaryChannelId: "0xtmp",
      outcome: "ignored_error",
    });
  });

  it("treats repeated accept-channel not-found errors as ignorable", () => {
    expect(isIgnorableAcceptChannelError(new Error("No channel with temp id found"))).toBe(true);
    expect(isIgnorableAcceptChannelError(new Error("already accepted"))).toBe(true);
    expect(isIgnorableAcceptChannelError(new Error("permission denied"))).toBe(false);
  });
});
