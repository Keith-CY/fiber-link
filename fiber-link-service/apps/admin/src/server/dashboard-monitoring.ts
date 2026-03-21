import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { DashboardMonitoringSummary } from "../dashboard/dashboard-page-model";
import { resolveAdminRepoRoot } from "./dashboard-rate-limit";

const execFileAsync = promisify(execFile);

export type MonitoringCommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultRunner(file: string, args: string[]) {
  return execFileAsync(file, args);
}

export function buildDashboardMonitoringSummary(raw: Record<string, any>, rawJson: string): DashboardMonitoringSummary {
  return {
    status: raw.status === "alert" ? "alert" : "ok",
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "unknown",
    readinessStatus: raw?.checks?.status === "not_ready" ? "not_ready" : "ready",
    unpaidBacklog: Number(raw?.settlement?.backlogUnpaid ?? 0),
    retryPendingCount: Number(raw?.settlement?.retryPendingCount ?? 0),
    withdrawalParityIssueCount: Number(raw?.withdrawalParity?.totals?.issueCount ?? 0),
    alertCount: Array.isArray(raw?.alerts) ? raw.alerts.length : 0,
    rawJson,
  };
}

export async function loadDashboardMonitoringSummary(input: {
  runner?: MonitoringCommandRunner;
  repoRoot?: string;
} = {}): Promise<DashboardMonitoringSummary> {
  const repoRoot = input.repoRoot ?? resolveAdminRepoRoot();
  const runner = input.runner ?? defaultRunner;
  const scriptPath = resolve(repoRoot, "deploy/compose/compose-ops-summary.sh");
  const { stdout } = await runner(scriptPath, []);
  const payload = JSON.parse(stdout);
  return buildDashboardMonitoringSummary(payload, stdout.trim());
}
