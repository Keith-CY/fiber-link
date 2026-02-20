export type QuickstartStepId = "preflight" | "config" | "bootstrap" | "verify";
export type QuickstartStepStatus = "pending" | "running" | "success" | "failure";

export type QuickstartStepState = {
  id: QuickstartStepId;
  status: QuickstartStepStatus;
  remediation?: string;
};

export type QuickstartSummaryArtifact = {
  appliedConfig: Record<string, string>;
  verification: { passed: boolean; details: string };
};

export type QuickstartWizardState = {
  runId: string;
  steps: QuickstartStepState[];
  summary?: QuickstartSummaryArtifact;
};

const ORDER: QuickstartStepId[] = ["preflight", "config", "bootstrap", "verify"];

export function createWizardState(runId: string): QuickstartWizardState {
  return {
    runId,
    steps: ORDER.map((id) => ({ id, status: "pending" })),
  };
}

export function canStartStep(state: QuickstartWizardState, step: QuickstartStepId): boolean {
  const index = ORDER.indexOf(step);
  return state.steps.slice(0, index).every((s) => s.status === "success");
}

export function updateStep(
  state: QuickstartWizardState,
  step: QuickstartStepId,
  status: QuickstartStepStatus,
  remediation?: string,
): QuickstartWizardState {
  if ((status === "running" || status === "success") && !canStartStep(state, step)) {
    throw new Error(`Cannot start ${step} before prerequisites succeed`);
  }

  return {
    ...state,
    steps: state.steps.map((s) => (s.id === step ? { ...s, status, remediation } : s)),
  };
}

export function persistWizardState(state: QuickstartWizardState): string {
  return JSON.stringify(state);
}

export function resumeWizardState(serialized: string): QuickstartWizardState {
  const parsed = JSON.parse(serialized) as QuickstartWizardState;
  return {
    runId: parsed.runId,
    steps: ORDER.map((id) => parsed.steps.find((s) => s.id === id) ?? { id, status: "pending" }),
    summary: parsed.summary,
  };
}

export function finalizeWizard(
  state: QuickstartWizardState,
  summary: QuickstartSummaryArtifact,
): QuickstartWizardState {
  if (state.steps.some((s) => s.status !== "success")) {
    throw new Error("Cannot finalize quickstart before all steps succeed");
  }
  return { ...state, summary };
}
