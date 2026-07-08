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
