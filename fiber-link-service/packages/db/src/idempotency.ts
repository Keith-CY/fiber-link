const SETTLEMENT_CREDIT_PREFIX = "settlement:tip_intent";
const WITHDRAWAL_DEBIT_PREFIX = "withdrawal:debit";

export function settlementCreditIdempotencyKey(tipIntentId: string): string {
  return `${SETTLEMENT_CREDIT_PREFIX}:${tipIntentId}`;
}

export function withdrawalDebitIdempotencyKey(withdrawalId: string): string {
  return `${WITHDRAWAL_DEBIT_PREFIX}:${withdrawalId}`;
}
