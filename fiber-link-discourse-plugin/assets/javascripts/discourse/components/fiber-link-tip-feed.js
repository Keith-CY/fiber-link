import Component from "@glimmer/component";

const LIFECYCLE_STEPS = Object.freeze([
  {
    key: "created",
    label: "created",
    description: "Tip intent is created and the invoice exists.",
  },
  {
    key: "paid",
    label: "paid",
    description: "Payment has been detected for the invoice.",
  },
  {
    key: "settling",
    label: "settling",
    description: "Transient UI state while polling tip.status.",
  },
  {
    key: "recorded",
    label: "recorded",
    description: "Ledger/accounting side effects are complete.",
  },
]);

export const TIP_STATE_MAPPING = Object.freeze([
  {
    uiState: "created / pending",
    backendState: "UNPAID",
    copy: "Created and waiting for payment.",
  },
  {
    uiState: "paid / recorded",
    backendState: "SETTLED",
    copy: "Payment confirmed and recorded by backend settlement.",
  },
  {
    uiState: "failed",
    backendState: "FAILED",
    copy: "Payment failed or expired.",
  },
  {
    uiState: "settling",
    backendState: "polling/loading",
    copy: "Shown while tip.status is being refreshed.",
  },
]);

function mapStepStatus(stepKey, backendState, isPolling) {
  if (backendState === "SETTLED") {
    return "complete";
  }

  if (backendState === "FAILED") {
    if (stepKey === "created") {
      return "complete";
    }
    return "failed";
  }

  if (backendState === "UNPAID") {
    if (stepKey === "created") {
      return "complete";
    }
    if (stepKey === "settling" && isPolling) {
      return "active";
    }
    return "pending";
  }

  if (stepKey === "settling" && isPolling) {
    return "active";
  }
  return "pending";
}

function toStateLabel(status) {
  if (status === "complete") {
    return "complete";
  }
  if (status === "active") {
    return "in progress";
  }
  if (status === "failed") {
    return "failed";
  }
  return "pending";
}

export function normalizeTipState(rawState) {
  if (rawState === "UNPAID" || rawState === "SETTLED" || rawState === "FAILED") {
    return rawState;
  }
  return "UNKNOWN";
}

export function buildLifecycleModel(rawState, { isPolling = false } = {}) {
  const backendState = normalizeTipState(rawState);
  const steps = LIFECYCLE_STEPS.map((step) => {
    const status = mapStepStatus(step.key, backendState, isPolling);
    return {
      ...step,
      state: status,
      stateLabel: toStateLabel(status),
      stateClass: `fiber-link-step-${status}`,
    };
  });

  if (backendState === "UNPAID") {
    return {
      backendState,
      backendLabel: "UNPAID",
      summary: "Created/pending: invoice exists and payment is still pending.",
      steps,
    };
  }

  if (backendState === "SETTLED") {
    return {
      backendState,
      backendLabel: "SETTLED",
      summary: "Paid/recorded: SETTLED covers payment confirmation plus recording.",
      steps,
    };
  }

  if (backendState === "FAILED") {
    return {
      backendState,
      backendLabel: "FAILED",
      summary: "Failed: backend marked this invoice as FAILED.",
      steps,
    };
  }

  return {
    backendState,
    backendLabel: "UNKNOWN",
    summary: "Waiting for status from tip.status.",
    steps,
  };
}

export default class FiberLinkTipFeed extends Component {
  get tips() {
    return this.args.tips ?? [];
  }
}
