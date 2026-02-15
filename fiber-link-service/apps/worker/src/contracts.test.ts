import { describe, expect, it } from "vitest";
import { createSettlementUpdateEvent } from "./contracts";

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
});
