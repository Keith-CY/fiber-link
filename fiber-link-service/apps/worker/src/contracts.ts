export type SettlementState = "UNPAID" | "SETTLED" | "FAILED";

export type SettlementUpdateOutcome =
  | "NO_CHANGE"
  | "SETTLED_CREDIT_APPLIED"
  | "SETTLED_DUPLICATE"
  | "FAILED_MARKED";

export type SettlementUpdateEvent = {
  type: "settlement.update";
  invoice: string;
  previousState: SettlementState;
  observedState: SettlementState;
  nextState: SettlementState;
  outcome: SettlementUpdateOutcome;
  ledgerCreditApplied: boolean;
};

export function createSettlementUpdateEvent(input: {
  invoice: string;
  previousState: SettlementState;
  observedState: SettlementState;
  nextState: SettlementState;
  outcome: SettlementUpdateOutcome;
  ledgerCreditApplied: boolean;
}): SettlementUpdateEvent {
  return {
    type: "settlement.update",
    invoice: input.invoice,
    previousState: input.previousState,
    observedState: input.observedState,
    nextState: input.nextState,
    outcome: input.outcome,
    ledgerCreditApplied: input.ledgerCreditApplied,
  };
}
