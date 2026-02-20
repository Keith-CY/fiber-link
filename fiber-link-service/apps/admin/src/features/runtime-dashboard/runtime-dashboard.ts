export type RuntimeSeverity = "info" | "warning" | "critical";
export type RuntimeState = "running" | "degraded" | "down";

export type RuntimeSignal = {
  runtimeState: RuntimeState;
  lastSuccessAt: string | null;
  failureCount24h: number;
  topErrorClass: string | null;
  retryBackoffActive: boolean;
};

export type DashboardSummary = {
  runtimeState: RuntimeState;
  lastSuccessAt: string;
  failureCount24h: number;
  topErrorClass: string;
  retryBackoffActive: boolean;
  severity: RuntimeSeverity;
};

const SECRET_PATTERNS = [/token=[^\s]+/gi, /password=[^\s]+/gi, /secret=[^\s]+/gi];

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, (m) => `${m.split("=")[0]}=[REDACTED]`), input);
}

export function classifySeverity(signal: RuntimeSignal): RuntimeSeverity {
  if (signal.runtimeState === "down" || signal.failureCount24h > 10) return "critical";
  if (signal.runtimeState === "degraded" || signal.retryBackoffActive) return "warning";
  return "info";
}

export function buildDashboardSummary(signal: RuntimeSignal): DashboardSummary {
  return {
    runtimeState: signal.runtimeState,
    lastSuccessAt: signal.lastSuccessAt ?? "never",
    failureCount24h: signal.failureCount24h,
    topErrorClass: signal.topErrorClass ?? "none",
    retryBackoffActive: signal.retryBackoffActive,
    severity: classifySeverity(signal),
  };
}
