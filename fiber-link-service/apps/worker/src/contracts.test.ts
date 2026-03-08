import { describe, expect, it } from "vitest";
import {
  createLiquidityChannelRotationEvent,
  createLiquidityRebalanceEvent,
  createSettlementUpdateEvent,
} from "./contracts";

describe("worker settlement contracts", () => {
  it("builds canonical settlement update event payload", () => {
    const event = createSettlementUpdateEvent({
      invoice: "inv-1",
      previousState: "UNPAID",
      observedState: "SETTLED",
      nextState: "SETTLED",
      outcome: "SETTLED_CREDIT_APPLIED",
      ledgerCreditApplied: true,
    });

    expect(event).toEqual({
      type: "settlement.update",
      invoice: "inv-1",
      previousState: "UNPAID",
      observedState: "SETTLED",
      nextState: "SETTLED",
      outcome: "SETTLED_CREDIT_APPLIED",
      ledgerCreditApplied: true,
    });
  });

  it("builds canonical liquidity rebalance event payload", () => {
    const event = createLiquidityRebalanceEvent({
      liquidityRequestId: "liq-1",
      previousState: "REQUESTED",
      nextState: "REBALANCING",
      outcome: "REBALANCE_STARTED",
      promotedCount: 0,
    });

    expect(event).toEqual({
      type: "liquidity.rebalance",
      liquidityRequestId: "liq-1",
      previousState: "REQUESTED",
      nextState: "REBALANCING",
      outcome: "REBALANCE_STARTED",
      promotedCount: 0,
    });
  });

  it("builds canonical liquidity channel rotation event payload", () => {
    const event = createLiquidityChannelRotationEvent({
      liquidityRequestId: "liq-1",
      legacyChannelId: "0xlegacy",
      replacementChannelId: "0xreplacement",
      expectedRecoveredAmount: "150",
    });

    expect(event).toEqual({
      type: "liquidity.channel_rotation",
      liquidityRequestId: "liq-1",
      legacyChannelId: "0xlegacy",
      replacementChannelId: "0xreplacement",
      expectedRecoveredAmount: "150",
    });
  });
});
