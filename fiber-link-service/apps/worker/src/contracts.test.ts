import { describe, expect, it } from "vitest";
import { createLiquidityRebalanceEvent, createSettlementUpdateEvent } from "./contracts";

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
});
