import { describe, expect, it } from "vitest";
import {
  canStartStep,
  createWizardState,
  finalizeWizard,
  persistWizardState,
  resumeWizardState,
  updateStep,
} from "./wizard";

describe("quickstart wizard", () => {
  it("blocks next steps until prerequisites pass", () => {
    const state = createWizardState("run-1");
    expect(canStartStep(state, "config")).toBe(false);
    expect(() => updateStep(state, "config", "running")).toThrow(/prerequisites/);
  });

  it("persists and resumes interrupted progress", () => {
    let state = createWizardState("run-2");
    state = updateStep(state, "preflight", "success");
    state = updateStep(state, "config", "failure", "Set DATABASE_URL");

    const resumed = resumeWizardState(persistWizardState(state));
    expect(resumed.steps.find((s) => s.id === "config")?.status).toBe("failure");
    expect(resumed.steps.find((s) => s.id === "config")?.remediation).toContain("DATABASE_URL");
  });

  it("creates deterministic summary artifact", () => {
    let state = createWizardState("run-3");
    state = updateStep(state, "preflight", "success");
    state = updateStep(state, "config", "success");
    state = updateStep(state, "bootstrap", "success");
    state = updateStep(state, "verify", "success");
    state = finalizeWizard(state, {
      appliedConfig: { NODE_ENV: "production", PORT: "3000" },
      verification: { passed: true, details: "Health endpoint returned 200" },
    });

    expect(state.summary?.appliedConfig).toEqual({ NODE_ENV: "production", PORT: "3000" });
    expect(state.summary?.verification.passed).toBe(true);
  });
});
