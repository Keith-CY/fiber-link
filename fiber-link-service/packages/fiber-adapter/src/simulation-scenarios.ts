import type { InvoiceState } from "./types";

export type SimulationScenarioName =
  | "settle-after-1-poll"
  | "settled-immediately"
  | "always-unpaid"
  | "always-failed"
  | "withdrawal-failed";

export type SimulationInvoiceLifecycle =
  | { kind: "always"; state: InvoiceState }
  | { kind: "settle-after-polls"; settleAfterPolls: number };

export type SimulationWithdrawalBehavior =
  | { kind: "success" }
  | { kind: "error"; message: string };

export type SimulationScenario = {
  name: SimulationScenarioName;
  description: string;
  invoiceLifecycle: SimulationInvoiceLifecycle;
  withdrawalBehavior: SimulationWithdrawalBehavior;
};

const SCENARIOS: Record<SimulationScenarioName, Omit<SimulationScenario, "name">> = {
  "settle-after-1-poll": {
    description: "First status check is UNPAID, second and later checks are SETTLED.",
    invoiceLifecycle: { kind: "settle-after-polls", settleAfterPolls: 1 },
    withdrawalBehavior: { kind: "success" },
  },
  "settled-immediately": {
    description: "Every invoice status check is SETTLED.",
    invoiceLifecycle: { kind: "always", state: "SETTLED" },
    withdrawalBehavior: { kind: "success" },
  },
  "always-unpaid": {
    description: "Every invoice status check remains UNPAID.",
    invoiceLifecycle: { kind: "always", state: "UNPAID" },
    withdrawalBehavior: { kind: "success" },
  },
  "always-failed": {
    description: "Every invoice status check is FAILED and withdrawals are rejected.",
    invoiceLifecycle: { kind: "always", state: "FAILED" },
    withdrawalBehavior: { kind: "error", message: "simulated withdrawal rejected" },
  },
  "withdrawal-failed": {
    description: "Invoices settle after one poll but all withdrawals are rejected.",
    invoiceLifecycle: { kind: "settle-after-polls", settleAfterPolls: 1 },
    withdrawalBehavior: { kind: "error", message: "simulated withdrawal rejected" },
  },
};

export const DEFAULT_SIMULATION_SCENARIO_NAME: SimulationScenarioName = "settle-after-1-poll";

export function listSimulationScenarioNames(): SimulationScenarioName[] {
  return Object.keys(SCENARIOS) as SimulationScenarioName[];
}

export function resolveSimulationScenario(name: string | undefined): SimulationScenario {
  const candidate = name?.trim() || DEFAULT_SIMULATION_SCENARIO_NAME;
  const scenarioName = candidate as SimulationScenarioName;
  const resolved = SCENARIOS[scenarioName];
  if (!resolved) {
    throw new Error(
      `Unknown simulation scenario '${candidate}'. Supported scenarios: ${listSimulationScenarioNames().join(", ")}`,
    );
  }

  const invoiceLifecycle: SimulationInvoiceLifecycle =
    resolved.invoiceLifecycle.kind === "always"
      ? { kind: "always", state: resolved.invoiceLifecycle.state }
      : { kind: "settle-after-polls", settleAfterPolls: resolved.invoiceLifecycle.settleAfterPolls };

  const withdrawalBehavior: SimulationWithdrawalBehavior =
    resolved.withdrawalBehavior.kind === "success"
      ? { kind: "success" }
      : { kind: "error", message: resolved.withdrawalBehavior.message };

  return {
    name: scenarioName,
    description: resolved.description,
    invoiceLifecycle,
    withdrawalBehavior,
  };
}
