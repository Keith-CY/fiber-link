/**
 * Typed errors shared by every AdminServices implementation so routers can map
 * them to tRPC codes with `instanceof` instead of sniffing message strings.
 */
export class PolicyScopeError extends Error {
  constructor(message = "COMMUNITY_ADMIN can only update policies for managed apps") {
    super(message);
    this.name = "PolicyScopeError";
  }
}

export class UnknownAppError extends Error {
  constructor(public readonly appId: string) {
    super(`unknown app: ${appId}`);
    this.name = "UnknownAppError";
  }
}

/**
 * Unknown invoice, or an invoice outside the caller's app scope. Both cases
 * intentionally collapse into "not found" so a scoped admin cannot probe for
 * the existence of other communities' invoices.
 */
export class SettlementNotFoundError extends Error {
  constructor(public readonly invoice: string) {
    super(`unknown settlement invoice: ${invoice}`);
    this.name = "SettlementNotFoundError";
  }
}

/** Retry requested for an invoice that is not in a retryable (UNPAID) state. */
export class SettlementRetryStateError extends Error {
  constructor(public readonly invoiceState: string) {
    super(`settlement retry is only available while the invoice is UNPAID (current state: ${invoiceState})`);
    this.name = "SettlementRetryStateError";
  }
}
