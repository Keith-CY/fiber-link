import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DModalCancel from "discourse/components/d-modal-cancel";

import { createTip, getTipStatus } from "../../services/fiber-link-api";

const AMOUNT_PATTERN = /^(?:\d+)(?:\.\d{1,8})?$/;

function mapTipStateToLabel(state) {
  if (state === "SETTLED") {
    return "Paid";
  }
  if (state === "FAILED") {
    return "Failed";
  }
  return "Awaiting payment";
}

function mapTipStateToClass(state) {
  if (state === "SETTLED") {
    return "fiber-link-tip-status-badge is-success";
  }
  if (state === "FAILED") {
    return "fiber-link-tip-status-badge is-danger";
  }
  return "fiber-link-tip-status-badge is-warning";
}

function normalizeMessage(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isTransientNetworkError(message) {
  const value = message.toLowerCase();
  return (
    value.includes("network") ||
    value.includes("timeout") ||
    value.includes("failed to fetch") ||
    value.includes("service unavailable")
  );
}

function mapCreateTipErrorToMessage(error) {
  const code = Number(error?.code);
  const message = normalizeMessage(error?.message);
  const lower = message.toLowerCase();

  if (code === -32002 || lower.includes("self")) {
    return "You can’t tip your own post.";
  }
  if (code === -32602 || lower.includes("invalid params")) {
    return "Unable to generate an invoice for this post. Please refresh and try again.";
  }
  if (isTransientNetworkError(message)) {
    return "Network issue while generating invoice. Please retry in a moment.";
  }
  return message || "Failed to generate invoice.";
}

function mapStatusErrorToMessage(error) {
  const message = normalizeMessage(error?.message);
  if (isTransientNetworkError(message)) {
    return "Network issue while checking status. Please retry.";
  }
  return message || "Failed to check status.";
}

export default class FiberLinkTipModal extends Component {
  @tracked amount = "1";
  @tracked invoice;
  @tracked statusLabel = "Awaiting payment";
  @tracked statusClass = mapTipStateToClass("UNPAID");
  @tracked isGenerating = false;
  @tracked isChecking = false;
  @tracked errorMessage;
  @tracked copyFeedback;

  get postId() {
    const rawValue = this.args?.model?.postId;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get fromUserId() {
    const rawValue = this.args?.model?.fromUserId;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get targetUserId() {
    const rawValue = this.args?.model?.targetUserId;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get targetUsername() {
    const value = normalizeMessage(this.args?.model?.targetUsername);
    return value || "post author";
  }

  get isSelfTip() {
    return this.args?.model?.isSelfTip === true;
  }

  get amountErrorMessage() {
    const value = normalizeMessage(this.amount);
    if (!value) {
      return "Enter an amount in CKB.";
    }
    if (!AMOUNT_PATTERN.test(value)) {
      return "Use numbers only (up to 8 decimal places).";
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "Amount must be greater than 0.";
    }
    return null;
  }

  get isGenerateInvoiceDisabled() {
    return (
      this.isGenerating ||
      this.isChecking ||
      this.isSelfTip ||
      !!this.amountErrorMessage ||
      !this.postId ||
      !this.fromUserId ||
      !this.targetUserId
    );
  }

  get isCheckStatusDisabled() {
    return !this.invoice || this.isChecking || this.isGenerating;
  }

  @action
  onAmountInput(event) {
    this.amount = event?.target?.value ?? "";
    this.copyFeedback = null;
  }

  @action
  async generateInvoice() {
    if (this.isGenerating) {
      return;
    }

    this.errorMessage = null;
    this.copyFeedback = null;

    if (this.isSelfTip) {
      this.errorMessage = "You can’t tip your own post.";
      return;
    }

    if (this.amountErrorMessage) {
      this.errorMessage = this.amountErrorMessage;
      return;
    }

    if (!this.postId || !this.fromUserId || !this.targetUserId) {
      this.errorMessage = "Missing tip context. Please refresh and retry.";
      return;
    }

    this.isGenerating = true;

    try {
      const result = await createTip({
        amount: this.amount.trim(),
        asset: "CKB",
        postId: String(this.postId),
        fromUserId: String(this.fromUserId),
        toUserId: String(this.targetUserId),
      });

      if (!normalizeMessage(result?.invoice)) {
        throw new Error("Invoice is empty");
      }

      this.invoice = result?.invoice;
      this.statusLabel = "Awaiting payment";
      this.statusClass = mapTipStateToClass("UNPAID");
    } catch (e) {
      this.errorMessage = mapCreateTipErrorToMessage(e);
    } finally {
      this.isGenerating = false;
    }
  }

  @action
  async checkStatus() {
    if (!this.invoice || this.isChecking) {
      return;
    }

    this.errorMessage = null;
    this.copyFeedback = null;
    this.isChecking = true;

    try {
      const result = await getTipStatus({ invoice: this.invoice });
      const state = normalizeMessage(result?.state).toUpperCase();
      this.statusLabel = mapTipStateToLabel(state);
      this.statusClass = mapTipStateToClass(state);
    } catch (e) {
      this.errorMessage = mapStatusErrorToMessage(e);
    } finally {
      this.isChecking = false;
    }
  }

  @action
  async copyInvoice() {
    if (!this.invoice) {
      return;
    }

    this.copyFeedback = null;

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(this.invoice);
      this.copyFeedback = "Copied";
    } catch (_error) {
      this.copyFeedback = "Copy failed";
    }
  }

  <template>
    <DModal @closeModal={{@closeModal}} @title="Pay with Fiber" class="fiber-link-tip-modal">
      <:body>
        <div class="fiber-link-tip-modal__content">
          <p class="fiber-link-tip-modal__recipient">
            Recipient: <strong>@{{this.targetUsername}}</strong>
          </p>

          {{#if this.errorMessage}}
            <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
          {{/if}}

          {{#if this.isSelfTip}}
            <p class="fiber-link-tip-alert is-warning">You can’t tip your own post.</p>
          {{/if}}

          <div class="fiber-link-tip-form">
            <label class="fiber-link-tip-field">
              <span class="fiber-link-tip-label">Amount (CKB)</span>
              <input
                class="fiber-link-tip-input"
                inputmode="decimal"
                value={{this.amount}}
                {{on "input" this.onAmountInput}}
              />
            </label>
            {{#if this.amountErrorMessage}}
              <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
            {{/if}}
          </div>

          {{#if this.invoice}}
            <div class="fiber-link-tip-invoice-card">
              <p class="fiber-link-tip-invoice-label">Invoice</p>
              <code class="fiber-link-tip-invoice" title={{this.invoice}}>{{this.invoice}}</code>
              <div class="fiber-link-tip-invoice-meta">
                <span class={{this.statusClass}}>{{this.statusLabel}}</span>
                <DButton @translatedLabel="Copy invoice" @action={{this.copyInvoice}} />
                {{#if this.copyFeedback}}
                  <span class="fiber-link-tip-copy-feedback">{{this.copyFeedback}}</span>
                {{/if}}
              </div>
            </div>
          {{else}}
            <p class="fiber-link-tip-help">
              Generate an invoice, complete payment in your wallet, then check status.
            </p>
          {{/if}}
        </div>
      </:body>

      <:footer>
        <DButton
          @action={{this.generateInvoice}}
          @translatedLabel="Generate Invoice"
          class="btn-primary"
          @disabled={{this.isGenerateInvoiceDisabled}}
        />

        <DButton
          @action={{this.checkStatus}}
          @translatedLabel="Check status"
          @disabled={{this.isCheckStatusDisabled}}
        />

        <DModalCancel @close={{@closeModal}} />
      </:footer>
    </DModal>
  </template>
}
