export type SecurityDefaults = {
  leastPrivilegeMode: boolean;
  maskSensitiveOutput: boolean;
  requireHighRiskConfirmation: boolean;
  failClosedOnPolicyUncertainty: boolean;
};

export const SECURE_DEFAULTS: SecurityDefaults = {
  leastPrivilegeMode: true,
  maskSensitiveOutput: true,
  requireHighRiskConfirmation: true,
  failClosedOnPolicyUncertainty: true,
};

export function maskSensitive(value: string): string {
  return value.replace(/([A-Za-z0-9]{2})[A-Za-z0-9]+([A-Za-z0-9]{2})/g, "$1***$2");
}

export function canRunHighRiskAction(confirmed: boolean): boolean {
  return SECURE_DEFAULTS.requireHighRiskConfirmation ? confirmed : true;
}

export function evaluatePolicyDecision(input: { policyKnown: boolean }): "allow" | "deny" {
  if (!input.policyKnown && SECURE_DEFAULTS.failClosedOnPolicyUncertainty) {
    return "deny";
  }
  return "allow";
}
