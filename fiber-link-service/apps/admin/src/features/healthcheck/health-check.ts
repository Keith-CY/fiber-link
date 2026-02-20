export type Severity = "green" | "yellow" | "red";
export type HealthDomain = "dependencies" | "config" | "permissions" | "connectivity";

export type HealthFinding = {
  domain: HealthDomain;
  code: string;
  ok: boolean;
  severity: Severity;
  message: string;
  remediation: string;
};

export type HealthCheckResult = {
  correlationId: string;
  status: Severity;
  findings: HealthFinding[];
};

export type HealthCheckInput = {
  correlationId: string;
  dependenciesReady: boolean;
  configValid: boolean;
  permissionsOk: boolean;
  endpointReachable: boolean;
};

const CODES = {
  dependencies: "HC_DEPENDENCIES",
  config: "HC_CONFIG",
  permissions: "HC_PERMISSIONS",
  connectivity: "HC_CONNECTIVITY",
} as const;

function finding(domain: HealthDomain, ok: boolean, message: string, remediation: string): HealthFinding {
  return {
    domain,
    code: CODES[domain],
    ok,
    severity: ok ? "green" : "red",
    message,
    remediation,
  };
}

export function runHealthCheck(input: HealthCheckInput): HealthCheckResult {
  const findings: HealthFinding[] = [
    finding("dependencies", input.dependenciesReady, "Runtime dependencies", "Install required runtime packages"),
    finding("config", input.configValid, "Configuration validity", "Review and fix invalid config values"),
    finding("permissions", input.permissionsOk, "Path and permission access", "Adjust file and runtime permissions"),
    finding("connectivity", input.endpointReachable, "Critical endpoint connectivity", "Verify network and endpoint URL"),
  ];

  const hasFailure = findings.some((f) => !f.ok);
  return { correlationId: input.correlationId, status: hasFailure ? "red" : "green", findings };
}

export function formatHealthCheck(result: HealthCheckResult, mode: "json" | "text"): string {
  if (mode === "json") return JSON.stringify(result);
  const header = `status=${result.status} correlation_id=${result.correlationId}`;
  const lines = result.findings.map(
    (f) => `[${f.severity.toUpperCase()}] ${f.code} ${f.domain}: ${f.message}. Next: ${f.remediation}`,
  );
  return [header, ...lines].join("\n");
}
