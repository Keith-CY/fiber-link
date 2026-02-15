export type SettlementState = "UNPAID" | "SETTLED" | "FAILED";

export type SettlementUpdateOutcome =
  | "NO_CHANGE"
  | "SETTLED_CREDIT_APPLIED"
  | "SETTLED_DUPLICATE"
  | "FAILED_UPSTREAM_REPORTED"
  | "RETRY_SCHEDULED_TRANSIENT"
  | "FAILED_PENDING_TIMEOUT"
  | "FAILED_CONTRACT_MISMATCH"
  | "FAILED_RETRY_EXHAUSTED"
  | "FAILED_TERMINAL_ERROR";

export type SettlementUpdateEvent = {
  type: "settlement.update";
  invoice: string;
  previousState: SettlementState;
  observedState: SettlementState;
  nextState: SettlementState;
  outcome: SettlementUpdateOutcome;
  ledgerCreditApplied: boolean;
  failureClass?: "TRANSIENT" | "TERMINAL";
  retryCount?: number;
  nextRetryAt?: string | null;
  error?: string;
};

export function createSettlementUpdateEvent(input: {
  invoice: string;
  previousState: SettlementState;
  observedState: SettlementState;
  nextState: SettlementState;
  outcome: SettlementUpdateOutcome;
  ledgerCreditApplied: boolean;
  failureClass?: "TRANSIENT" | "TERMINAL";
  retryCount?: number;
  nextRetryAt?: string | null;
  error?: string;
}): SettlementUpdateEvent {
  const event: SettlementUpdateEvent = {
    type: "settlement.update",
    invoice: input.invoice,
    previousState: input.previousState,
    observedState: input.observedState,
    nextState: input.nextState,
    outcome: input.outcome,
    ledgerCreditApplied: input.ledgerCreditApplied,
  };

  if (input.failureClass !== undefined) {
    event.failureClass = input.failureClass;
  }
  if (input.retryCount !== undefined) {
    event.retryCount = input.retryCount;
  }
  if (input.nextRetryAt !== undefined) {
    event.nextRetryAt = input.nextRetryAt;
  }
  if (input.error !== undefined) {
    event.error = input.error;
  }

  return event;
}
