import { describe, expect, it } from "vitest";
import { createSimulationAdapter } from "./simulation-adapter";

describe("channel lifecycle support", () => {
  it("simulation adapter exposes ready legacy channels and liquidity capabilities", async () => {
    const adapter = createSimulationAdapter({
      liquidityCapabilities: {
        directRebalance: false,
        channelLifecycle: true,
        localCkbSweep: false,
      },
      channels: [
        {
          channelId: "0xlegacy",
          state: "CHANNEL_READY",
          localBalance: "123",
          remoteBalance: "77",
          remotePubkey: "0xpeer",
          pendingTlcCount: 0,
        },
      ],
    });

    await expect(adapter.getLiquidityCapabilities()).resolves.toEqual({
      directRebalance: false,
      channelLifecycle: true,
      localCkbSweep: false,
    });
    await expect(adapter.listChannels({ includeClosed: false })).resolves.toMatchObject({
      channels: [
        {
          channelId: "0xlegacy",
          state: "CHANNEL_READY",
          localBalance: "123",
          remotePubkey: "0xpeer",
        },
      ],
    });
  });
});
