const SETTLEMENT_CREDIT_PREFIX = "settlement:tip_intent";
const WITHDRAWAL_DEBIT_PREFIX = "withdrawal:debit";
const WITHDRAWAL_REVERSAL_PREFIX = "withdrawal:reversal";

export function settlementCreditIdempotencyKey(tipIntentId: string): string {
  return `${SETTLEMENT_CREDIT_PREFIX}:${tipIntentId}`;
}

export function withdrawalDebitIdempotencyKey(withdrawalId: string): string {
  return `${WITHDRAWAL_DEBIT_PREFIX}:${withdrawalId}`;
}

/**
 * Compensating credit for a broadcast debit whose transaction the chain
 * rejected: the funds never left the hot wallet, so the debit is refunded.
 */
export function withdrawalReversalIdempotencyKey(withdrawalId: string): string {
  return `${WITHDRAWAL_REVERSAL_PREFIX}:${withdrawalId}`;
}
