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

function formatTimestamp(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return "unknown";
  }

  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return rawValue;
  }

  return value.toISOString();
}

function normalizeDirection(rawValue) {
  return rawValue === "OUT" ? "Outgoing" : "Incoming";
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
  get isLoading() {
    return Boolean(this.args.isLoading);
  }

  get errorMessage() {
    if (typeof this.args.errorMessage !== "string") {
      return null;
    }
    const value = this.args.errorMessage.trim();
    return value ? value : null;
  }

  get tips() {
    const rows = Array.isArray(this.args.tips) ? this.args.tips : [];
    return rows.map((tip) => {
      const lifecycle = buildLifecycleModel(tip?.state, { isPolling: false });
      return {
        id: typeof tip?.id === "string" ? tip.id : "unknown",
        invoice: typeof tip?.invoice === "string" ? tip.invoice : "unknown",
        amount: typeof tip?.amount === "string" ? tip.amount : "0",
        asset: tip?.asset === "USDI" ? "USDI" : "CKB",
        state: lifecycle.backendLabel,
        directionLabel: normalizeDirection(tip?.direction),
        counterpartyUserId:
          typeof tip?.counterpartyUserId === "string" ? tip.counterpartyUserId : "unknown",
        createdAtLabel: formatTimestamp(tip?.createdAt),
        lifecycleSummary: lifecycle.summary,
      };
    });
  }

  get isEmpty() {
    return !this.isLoading && !this.errorMessage && this.tips.length === 0;
  }

  <template>
    {{#if this.isLoading}}
      <p class="fiber-link-tip-feed-loading">Loading tip feed...</p>
    {{else}}
      {{#if this.errorMessage}}
        <p class="fiber-link-tip-feed-error">Failed to load tip feed: {{this.errorMessage}}</p>
      {{else}}
        {{#if this.isEmpty}}
          <p class="fiber-link-tip-feed-empty">No tips available for this account yet.</p>
        {{else}}
          <table class="fiber-link-tip-feed-table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>Amount</th>
                <th>Invoice</th>
                <th>Status</th>
                <th>Counterparty</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.tips as |tip|}}
                <tr data-tip-id={{tip.id}}>
                  <td>{{tip.directionLabel}}</td>
                  <td>{{tip.amount}} {{tip.asset}}</td>
                  <td>{{tip.invoice}}</td>
                  <td>{{tip.state}}</td>
                  <td>{{tip.counterpartyUserId}}</td>
                  <td>{{tip.createdAtLabel}}</td>
                </tr>
                <tr class="fiber-link-tip-feed-row-summary">
                  <td colspan="6">{{tip.lifecycleSummary}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      {{/if}}
    {{/if}}
  </template>
}
