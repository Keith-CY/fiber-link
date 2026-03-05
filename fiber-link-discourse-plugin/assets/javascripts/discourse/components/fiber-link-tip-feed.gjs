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

function mapStateToBadge(state) {
  if (state === "SETTLED") {
    return { label: "Paid", className: "fiber-link-status-badge is-success" };
  }
  if (state === "FAILED") {
    return { label: "Failed", className: "fiber-link-status-badge is-danger" };
  }
  if (state === "UNPAID") {
    return { label: "Awaiting payment", className: "fiber-link-status-badge is-warning" };
  }
  return { label: "Unknown", className: "fiber-link-status-badge" };
}

function shortenInvoice(invoice) {
  if (typeof invoice !== "string") {
    return "unknown";
  }
  if (invoice.length <= 40) {
    return invoice;
  }
  return `${invoice.slice(0, 18)}…${invoice.slice(-10)}`;
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
      const badge = mapStateToBadge(lifecycle.backendLabel);
      const invoice = typeof tip?.invoice === "string" ? tip.invoice : "unknown";
      return {
        id: typeof tip?.id === "string" ? tip.id : "unknown",
        invoice,
        shortInvoice: shortenInvoice(invoice),
        amount: typeof tip?.amount === "string" ? tip.amount : "0",
        asset: tip?.asset === "USDI" ? "USDI" : "CKB",
        state: badge.label,
        stateClassName: badge.className,
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
          <p class="fiber-link-tip-feed-empty">
            You don’t have tip records yet. Once someone tips your post, it will appear here.
          </p>
        {{else}}
          <table class="fiber-link-tip-feed-table">
            <thead>
              <tr>
                <th>Tip</th>
                <th>Status</th>
                <th>Counterparty</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.tips as |tip|}}
                <tr data-tip-id={{tip.id}}>
                  <td>
                    <p class="fiber-link-tip-feed-primary">
                      <strong>{{tip.amount}} {{tip.asset}}</strong>
                      <span class="fiber-link-tip-feed-direction">{{tip.directionLabel}}</span>
                    </p>
                    <p class="fiber-link-tip-feed-secondary" title={{tip.invoice}}>
                      {{tip.shortInvoice}}
                    </p>
                  </td>
                  <td><span class={{tip.stateClassName}}>{{tip.state}}</span></td>
                  <td>@{{tip.counterpartyUserId}}</td>
                  <td>{{tip.createdAtLabel}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      {{/if}}
    {{/if}}
  </template>
}
