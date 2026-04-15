import Component from "@glimmer/component";
import { registerDestructor } from "@ember/destroyable";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DModalCancel from "discourse/components/d-modal-cancel";

import { createTip, getTipStatus } from "../../services/fiber-link-api";

const AMOUNT_PATTERN = /^(?:\d+)(?:\.\d{1,8})?$/;
const TIP_STATUS_AUTO_POLL_INTERVAL_MS = 1000;
const FIBER_LINK_HOMEPAGE_URL = "https://fiberlink.me/";
const FIBER_LINK_LOGO_URL = "https://fiberlink.me/brand/fiber-link-logo.png";
const QUICK_AMOUNTS = ["5", "10", "31", "50"];

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

function mapTipStateToLabel(state) {
  switch (state) {
    case "SETTLED":
      return "Payment complete";
    case "PROCESSING":
      return "Confirming payment";
    case "FAILED":
      return "Payment failed";
    case "EXPIRED":
      return "Invoice expired";
    case "DETECTED":
      return "Payment detected";
    default:
      return "Awaiting payment";
  }
}

function mapTipStateToClass(state) {
  switch (state) {
    case "SETTLED":
      return "fiber-link-tip-status-badge is-success";
    case "PROCESSING":
    case "DETECTED":
      return "fiber-link-tip-status-badge is-info";
    case "FAILED":
    case "EXPIRED":
      return "fiber-link-tip-status-badge is-danger";
    default:
      return "fiber-link-tip-status-badge is-warning";
  }
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

function buildWalletHref(invoice) {
  const value = normalizeMessage(invoice);
  return value ? `fiber://invoice/${value}` : null;
}

export default class FiberLinkTipModal extends Component {
  @tracked amount = "1";
  @tracked message = "";
  @tracked invoice;
  @tracked invoiceQrDataUrl;
  @tracked currentStep = "generate";
  @tracked statusState = "UNPAID";
  @tracked statusLabel = mapTipStateToLabel("UNPAID");
  @tracked statusClass = mapTipStateToClass("UNPAID");
  @tracked isGenerating = false;
  @tracked isChecking = false;
  @tracked errorMessage;
  @tracked copyFeedback;
  @tracked autoPollMessage;
  @tracked showAdvanced = false;

  _pollTimer = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this._clearStatusPollTimer());
  }

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

  get topicTitle() {
    const value = normalizeMessage(this.args?.model?.topicTitle);
    return value || "Community post";
  }

  get postSummary() {
    const value = normalizeMessage(this.args?.model?.postSummary);
    return value || "Support this contributor directly from the conversation.";
  }

  get brandHomepageUrl() {
    return FIBER_LINK_HOMEPAGE_URL;
  }

  get brandLogoUrl() {
    return FIBER_LINK_LOGO_URL;
  }

  get trimmedMessage() {
    return normalizeMessage(this.message);
  }

  get hasMessage() {
    return !!this.trimmedMessage;
  }

  get quickAmounts() {
    return QUICK_AMOUNTS;
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

  get displayAmount() {
    return normalizeMessage(this.amount) || "0";
  }

  get payTitle() {
    return `Pay ${this.displayAmount} CKB`;
  }

  get paySubtitle() {
    return `to @${this.targetUsername}`;
  }

  get statusDescription() {
    switch (this.statusState) {
      case "SETTLED":
        return `${this.displayAmount} CKB has been sent to @${this.targetUsername}.`;
      case "PROCESSING":
        return "Payment detected. We’re confirming it on the network.";
      case "DETECTED":
        return "Payment detected. Confirmation should follow shortly.";
      case "FAILED":
        return "The payment could not be completed. Please try again.";
      case "EXPIRED":
        return "This payment request expired. Generate a new one to continue.";
      default:
        return "Scan with Fiber Wallet. This window updates automatically after payment.";
    }
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

  get checkStatusLabel() {
    return this.isChecking ? "Checking..." : "Check status";
  }

  get generateButtonLabel() {
    return this.isGenerating ? "Preparing payment..." : "Continue to Payment";
  }

  get shouldShowInvoiceQr() {
    return typeof this.invoiceQrDataUrl === "string" && this.invoiceQrDataUrl.trim().startsWith("data:image/");
  }

  get walletHref() {
    return buildWalletHref(this.invoice);
  }

  get isGenerateStep() {
    return this.currentStep === "generate";
  }

  get isPayStep() {
    return this.currentStep === "pay";
  }

  get isConfirmedStep() {
    return this.currentStep === "confirmed";
  }

  get moreOptionsLabel() {
    return this.showAdvanced ? "Hide payment details" : "More options";
  }

  _clearStatusPollTimer() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _scheduleStatusPoll() {
    this._clearStatusPollTimer();
    if (!this.invoice || this.isGenerating || this.isChecking) {
      return;
    }

    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      void this.checkStatus({ isAutoPoll: true });
    }, TIP_STATUS_AUTO_POLL_INTERVAL_MS);
  }

  @action
  onAmountInput(event) {
    this.amount = event?.target?.value ?? "";
    this.copyFeedback = null;
    this.autoPollMessage = null;
  }

  @action
  onMessageInput(event) {
    this.message = event?.target?.value ?? "";
  }

  @action
  setQuickAmount(amount) {
    this.amount = amount;
    this.copyFeedback = null;
    this.autoPollMessage = null;
  }

  @action
  toggleAdvanced() {
    this.showAdvanced = !this.showAdvanced;
  }

  @action
  async generateInvoice() {
    let scheduleAutoPoll = false;

    if (this.isGenerating) {
      return;
    }

    this.errorMessage = null;
    this.copyFeedback = null;
    this.autoPollMessage = null;
    this._clearStatusPollTimer();

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
        message: normalizeMessage(this.message) || null,
      });

      if (!normalizeMessage(result?.invoice)) {
        throw new Error("Invoice is empty");
      }

      this.invoice = result?.invoice;
      this.invoiceQrDataUrl = normalizeMessage(result?.invoiceQrDataUrl) || null;
      this.currentStep = "pay";
      this.statusState = "UNPAID";
      this.statusLabel = mapTipStateToLabel("UNPAID");
      this.statusClass = mapTipStateToClass("UNPAID");
      this.autoPollMessage = "Status updates automatically";
      this.showAdvanced = false;
      scheduleAutoPoll = true;
    } catch (e) {
      this.errorMessage = mapCreateTipErrorToMessage(e);
    } finally {
      this.isGenerating = false;
      if (scheduleAutoPoll) {
        this._scheduleStatusPoll();
      }
    }
  }

  @action
  async checkStatus(options = {}) {
    const isAutoPoll = options.isAutoPoll === true;
    let scheduleAutoPoll = false;

    if (!this.invoice || this.isChecking) {
      return;
    }

    if (!isAutoPoll) {
      this.errorMessage = null;
      this._clearStatusPollTimer();
    }
    this.copyFeedback = null;
    this.isChecking = true;

    try {
      const state = normalizeMessage((await getTipStatus({ invoice: this.invoice }))?.state).toUpperCase() || "UNPAID";
      this.statusState = state;
      this.statusLabel = mapTipStateToLabel(state);
      this.statusClass = mapTipStateToClass(state);
      this.errorMessage = null;

      if (state === "SETTLED") {
        this.currentStep = "confirmed";
        this.showAdvanced = false;
        this.autoPollMessage = null;
        this._clearStatusPollTimer();
      } else if (state === "UNPAID" || state === "DETECTED" || state === "PROCESSING") {
        this.currentStep = "pay";
        this.autoPollMessage = "Status updates automatically";
        scheduleAutoPoll = true;
      } else {
        this.currentStep = "pay";
        this.autoPollMessage = null;
        this._clearStatusPollTimer();
      }
    } catch (e) {
      if (isAutoPoll && isTransientNetworkError(normalizeMessage(e?.message))) {
        this.autoPollMessage = "Status updates automatically";
        scheduleAutoPoll = true;
      } else {
        this.errorMessage = mapStatusErrorToMessage(e);
      }
    } finally {
      this.isChecking = false;
      if (scheduleAutoPoll) {
        this._scheduleStatusPoll();
      }
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
      this.copyFeedback = "Copied invoice";
    } catch (_error) {
      this.copyFeedback = "Copy failed";
    }
  }

  <template>
    <DModal @closeModal={{@closeModal}} @title="Pay with Fiber" class="fiber-link-tip-modal">
      <:body>
        <div class="fiber-link-tip-modal__content fiber-link-tip-modal__content--checkout">
          <header class="fiber-link-tip-modal__hero">
            <p class="fiber-link-tip-modal__eyebrow">Native CKB tip</p>
            <h2>{{this.payTitle}}</h2>
            <p class="fiber-link-tip-modal__hero-subtitle">{{this.paySubtitle}}</p>
          </header>

          <ol class="fiber-link-tip-stepper" aria-label="Tip payment progress">
            <li class={{if this.isGenerateStep "is-active" (if this.invoice "is-complete" "")}}>
              <span>Configure</span>
            </li>
            <li class={{if this.isPayStep "is-active" (if this.isConfirmedStep "is-complete" "")}}>
              <span>Pay</span>
            </li>
            <li class={{if this.isConfirmedStep "is-active" ""}}>
              <span>Confirm</span>
            </li>
          </ol>

          {{#if this.errorMessage}}
            <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
          {{/if}}

          {{#if this.isSelfTip}}
            <p class="fiber-link-tip-alert is-warning">You can’t tip your own post.</p>
          {{/if}}

          <div class="fiber-link-tip-modal__grid">
            <aside class="fiber-link-tip-summary" data-fiber-link-tip-modal="summary">
              <div class="fiber-link-tip-summary__header">
                <p class="fiber-link-tip-summary__eyebrow">Payment summary</p>
                <a
                  href={{this.brandHomepageUrl}}
                  class="fiber-link-tip-summary__brand"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-fiber-link-tip-modal="brand-link"
                >
                  <img
                    src={{this.brandLogoUrl}}
                    alt="Fiber Link"
                    class="fiber-link-tip-summary__logo"
                    data-fiber-link-tip-modal="brand-logo"
                  />
                  <span>Fiber Link</span>
                </a>
              </div>

              <dl class="fiber-link-tip-summary__list">
                <div>
                  <dt>Recipient</dt>
                  <dd>@{{this.targetUsername}}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{{this.displayAmount}} CKB</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>Fiber Link</dd>
                </div>
                <div>
                  <dt>Topic</dt>
                  <dd title={{this.topicTitle}}>{{this.topicTitle}}</dd>
                </div>
                {{#if this.hasMessage}}
                  <div>
                    <dt>Message</dt>
                    <dd>{{this.trimmedMessage}}</dd>
                  </div>
                {{/if}}
              </dl>

              <p class="fiber-link-tip-summary__meta">Powered by Fiber Link • wallet-ready payment requests</p>
            </aside>

            <div class="fiber-link-tip-modal__main">
              {{#if this.isGenerateStep}}
                <section class="fiber-link-tip-panel" data-fiber-link-tip-modal-step="generate">
                  <div class="fiber-link-tip-panel__header">
                    <h3>Send tip</h3>
                    <p>Confirm the amount, add an optional note, then continue to payment.</p>
                  </div>

                  <div class="fiber-link-tip-form">
                    <label class="fiber-link-tip-field">
                      <span class="fiber-link-tip-label">Amount</span>
                      <div class="fiber-link-tip-input-group">
                        <input
                          class="fiber-link-tip-input fiber-link-tip-input--amount"
                          inputmode="decimal"
                          value={{this.amount}}
                          {{on "input" this.onAmountInput}}
                        />
                        <span class="fiber-link-tip-input-suffix">CKB</span>
                      </div>
                    </label>

                    <div class="fiber-link-tip-quick-amounts" aria-label="Quick amounts">
                      {{#each this.quickAmounts as |quickAmount|}}
                        <button
                          type="button"
                          class="fiber-link-tip-chip"
                          {{on "click" (fn this.setQuickAmount quickAmount)}}
                        >
                          {{quickAmount}}
                        </button>
                      {{/each}}
                    </div>

                    {{#if this.amountErrorMessage}}
                      <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
                    {{/if}}

                    <label class="fiber-link-tip-field">
                      <span class="fiber-link-tip-label">Message <span class="fiber-link-tip-label__optional">optional</span></span>
                      <textarea
                        class="fiber-link-tip-input fiber-link-tip-textarea"
                        aria-label="Message (optional)"
                        rows="2"
                        placeholder="Say thanks to the creator"
                        value={{this.message}}
                        {{on "input" this.onMessageInput}}
                      ></textarea>
                    </label>
                  </div>
                </section>
              {{/if}}

              {{#if this.isPayStep}}
                <section class="fiber-link-tip-panel fiber-link-tip-panel--pay" data-fiber-link-tip-modal-step="pay">
                  <div class="fiber-link-tip-panel__header">
                    <h3>{{this.statusLabel}}</h3>
                    <p>{{this.statusDescription}}</p>
                  </div>

                  <div class="fiber-link-tip-status-row fiber-link-tip-status-row--panel">
                    <span class={{this.statusClass}}>{{this.statusLabel}}</span>
                    <p class="fiber-link-tip-status-copy">{{this.autoPollMessage}}</p>
                  </div>

                  {{#if this.invoice}}
                    {{#if this.shouldShowInvoiceQr}}
                      <div class="fiber-link-tip-invoice-visual fiber-link-tip-invoice-visual--hero">
                        <img
                          class="fiber-link-tip-invoice-qr"
                          data-fiber-link-tip-modal="invoice-qr"
                          src={{this.invoiceQrDataUrl}}
                          alt="Invoice QR code"
                        />
                      </div>
                    {{else}}
                      <div class="fiber-link-tip-invoice-visual fiber-link-tip-invoice-visual--placeholder">
                        <p class="fiber-link-tip-step-card__placeholder">
                          QR preview unavailable. Open Fiber Wallet or copy the invoice below.
                        </p>
                      </div>
                    {{/if}}

                    <p class="fiber-link-tip-pay-hint">Scan with Fiber Wallet. Already paid? Wait a few seconds for confirmation.</p>

                    <div class="fiber-link-tip-panel__actions">
                      <DButton @translatedLabel="Copy Invoice" @action={{this.copyInvoice}} />
                      {{#if this.copyFeedback}}
                        <span class="fiber-link-tip-copy-feedback">{{this.copyFeedback}}</span>
                      {{/if}}
                    </div>

                    <button
                      type="button"
                      class="btn-link fiber-link-tip-advanced-toggle"
                      {{on "click" this.toggleAdvanced}}
                    >
                      {{this.moreOptionsLabel}}
                    </button>

                    {{#if this.showAdvanced}}
                      <div class="fiber-link-tip-advanced-panel">
                        <p class="fiber-link-tip-invoice-label">Payment details</p>
                        <code class="fiber-link-tip-invoice" title={{this.invoice}}>{{this.invoice}}</code>
                        <div class="fiber-link-tip-advanced-panel__actions">
                          {{#if this.walletHref}}
                            <a
                              class="btn fiber-link-tip-wallet-link"
                              data-fiber-link-tip-modal="wallet-link-secondary"
                              href={{this.walletHref}}
                            >
                              Open wallet deep link
                            </a>
                          {{/if}}
                          <DButton
                            class="fiber-link-tip-advanced-action"
                            @action={{this.checkStatus}}
                            @translatedLabel={{this.checkStatusLabel}}
                            @disabled={{this.isCheckStatusDisabled}}
                          />
                        </div>
                      </div>
                    {{/if}}
                  {{/if}}
                </section>
              {{/if}}

              {{#if this.isConfirmedStep}}
                <section class="fiber-link-tip-panel fiber-link-tip-panel--confirmed" data-fiber-link-tip-modal-step="confirmed">
                  <div class="fiber-link-tip-success-mark" aria-hidden="true">
                    <span>✓</span>
                  </div>
                  <div class="fiber-link-tip-panel__header fiber-link-tip-panel__header--centered">
                    <h3>Payment complete</h3>
                    <p>{{this.displayAmount}} CKB sent to @{{this.targetUsername}}.</p>
                  </div>
                  <div class="fiber-link-tip-status-row fiber-link-tip-status-row--success">
                    <span class={{this.statusClass}}>{{this.statusLabel}}</span>
                  </div>
                  <div class="fiber-link-tip-confirmed-summary">
                    <p><strong>Network:</strong> Fiber Link</p>
                    {{#if this.hasMessage}}
                      <p><strong>Message:</strong> {{this.trimmedMessage}}</p>
                    {{/if}}
                  </div>
                </section>
              {{/if}}
            </div>
          </div>
        </div>
      </:body>

      <:footer>
        <div class="fiber-link-tip-footer">
          <div class="fiber-link-tip-footer__secondary">
            {{#if this.isConfirmedStep}}
              <a
                href={{this.brandHomepageUrl}}
                target="_blank"
                rel="noopener noreferrer"
                class="btn"
              >
                View Fiber Link
              </a>
            {{else}}
              <DModalCancel @close={{@closeModal}} />
            {{/if}}
          </div>

          <div class="fiber-link-tip-footer__primary">
            {{#if this.isGenerateStep}}
              <DButton
                class="btn-primary"
                @action={{this.generateInvoice}}
                @disabled={{this.isGenerateInvoiceDisabled}}
                @translatedLabel={{this.generateButtonLabel}}
              />
            {{/if}}

            {{#if this.isPayStep}}
              {{#if this.walletHref}}
                <a
                  class="btn btn-primary fiber-link-tip-wallet-link fiber-link-tip-wallet-link--primary"
                  data-fiber-link-tip-modal="wallet-link"
                  href={{this.walletHref}}
                >
                  Open Fiber Wallet
                </a>
              {{else}}
                <DButton
                  class="btn-primary"
                  @action={{this.checkStatus}}
                  @disabled={{this.isCheckStatusDisabled}}
                  @translatedLabel={{this.checkStatusLabel}}
                />
              {{/if}}
            {{/if}}

            {{#if this.isConfirmedStep}}
              <DButton class="btn-primary" @action={{@closeModal}} @translatedLabel="Done" />
            {{/if}}
          </div>
        </div>
      </:footer>
    </DModal>
  </template>
}
