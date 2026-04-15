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
  if (state === "SETTLED") {
    return "Payment received";
  }
  if (state === "FAILED") {
    return "Payment failed";
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
      const result = await getTipStatus({ invoice: this.invoice });
      const state = normalizeMessage(result?.state).toUpperCase();
      this.statusLabel = mapTipStateToLabel(state);
      this.statusClass = mapTipStateToClass(state);
      this.errorMessage = null;

      if (state === "SETTLED") {
        this.currentStep = "confirmed";
        this.showAdvanced = false;
        this.autoPollMessage = null;
        this._clearStatusPollTimer();
      } else if (state === "UNPAID") {
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
      this.copyFeedback = "Copied";
    } catch (_error) {
      this.copyFeedback = "Copy failed";
    }
  }

  <template>
    <DModal @closeModal={{@closeModal}} @title="Pay with Fiber" class="fiber-link-tip-modal">
      <:body>
        <div class="fiber-link-tip-modal__content fiber-link-tip-modal__content--productized">
          <aside class="fiber-link-tip-modal__brand-rail">
            <a
              href={{this.brandHomepageUrl}}
              class="fiber-link-tip-brand"
              target="_blank"
              rel="noopener noreferrer"
              data-fiber-link-tip-modal="brand-link"
            >
              <img
                src={{this.brandLogoUrl}}
                alt="Fiber Link"
                class="fiber-link-tip-brand__logo"
                data-fiber-link-tip-modal="brand-logo"
              />
              <span class="fiber-link-tip-brand__meta">
                <span class="fiber-link-tip-brand__eyebrow">Powered by Fiber Link</span>
                <span class="fiber-link-tip-brand__url">fiberlink.me</span>
              </span>
            </a>

            <section class="fiber-link-tip-hero">
              <p class="fiber-link-tip-hero__eyebrow">Payments uncompromised</p>
              <h3>Creator rewards inside the conversation</h3>
              <p>
                Send a native CKB tip without leaving the discussion. Fiber Link keeps payment context,
                wallet handoff, and confirmation in one place.
              </p>
            </section>

            <section class="fiber-link-tip-context-card">
              <p class="fiber-link-tip-context-card__eyebrow">Tip target</p>
              <strong class="fiber-link-tip-context-card__recipient">@{{this.targetUsername}}</strong>
              <p class="fiber-link-tip-context-card__title">{{this.topicTitle}}</p>
              <p class="fiber-link-tip-context-card__summary">{{this.postSummary}}</p>
              <div class="fiber-link-tip-context-card__metrics">
                <div>
                  <span>Amount</span>
                  <strong>{{this.displayAmount}} CKB</strong>
                </div>
                <div>
                  <span>Network</span>
                  <strong>Fiber Link</strong>
                </div>
              </div>
              {{#if this.hasMessage}}
                <div class="fiber-link-tip-context-card__message">
                  <span>Message</span>
                  <p>{{this.trimmedMessage}}</p>
                </div>
              {{/if}}
            </section>

            <ol class="fiber-link-tip-progress" aria-label="Tip payment progress">
              <li class={{if this.isGenerateStep "is-active" (if this.invoice "is-complete" "")}}>
                <span>1</span>
                <div>
                  <strong>Configure</strong>
                  <p>Set amount and personalize the tip.</p>
                </div>
              </li>
              <li class={{if this.isPayStep "is-active" (if this.isConfirmedStep "is-complete" "")}}>
                <span>2</span>
                <div>
                  <strong>Pay</strong>
                  <p>Scan the request in Fiber Wallet or hand off via deep link.</p>
                </div>
              </li>
              <li class={{if this.isConfirmedStep "is-active" ""}}>
                <span>3</span>
                <div>
                  <strong>Confirm</strong>
                  <p>Watch settlement complete and close with confidence.</p>
                </div>
              </li>
            </ol>
          </aside>

          <div class="fiber-link-tip-modal__main">
            <header class="fiber-link-tip-modal__header fiber-link-tip-modal__header--productized">
              <p class="fiber-link-tip-modal__recipient">Recipient</p>
              <strong class="fiber-link-tip-modal__recipient-name">@{{this.targetUsername}}</strong>
              <p class="fiber-link-tip-modal__amount">{{this.displayAmount}} CKB</p>
            </header>

            {{#if this.errorMessage}}
              <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
            {{/if}}

            {{#if this.isSelfTip}}
              <p class="fiber-link-tip-alert is-warning">You can’t tip your own post.</p>
            {{/if}}

            {{#if this.isGenerateStep}}
              <section class="fiber-link-tip-step-card fiber-link-tip-step-card--immersive" data-fiber-link-tip-modal-step="generate">
                <div class="fiber-link-tip-step-card__header">
                  <p class="fiber-link-tip-step-card__eyebrow">Step 1</p>
                  <h3>Configure the tip</h3>
                  <p class="fiber-link-tip-step-card__description">
                    Choose an amount, add an optional note, then generate the payment request.
                  </p>
                </div>
                <div class="fiber-link-tip-form">
                  <label class="fiber-link-tip-field">
                    <span class="fiber-link-tip-label">Amount</span>
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
                  <label class="fiber-link-tip-field">
                    <span class="fiber-link-tip-label">Tip message (optional)</span>
                    <textarea
                      class="fiber-link-tip-input fiber-link-tip-textarea"
                      rows="3"
                      value={{this.message}}
                      {{on "input" this.onMessageInput}}
                    ></textarea>
                  </label>
                </div>
                <div class="fiber-link-tip-step-card__footer-actions">
                  <DButton
                    class="btn-primary fiber-link-tip-step-card__action"
                    @action={{this.generateInvoice}}
                    @disabled={{this.isGenerateInvoiceDisabled}}
                    @translatedLabel="Generate Invoice"
                  />
                  <p class="fiber-link-tip-step-card__helper">
                    Fiber Link will create a wallet-ready request and keep checking settlement automatically.
                  </p>
                </div>
              </section>
            {{/if}}

            {{#if this.isPayStep}}
              <section class="fiber-link-tip-step-card fiber-link-tip-step-card--immersive" data-fiber-link-tip-modal-step="pay">
                <div class="fiber-link-tip-step-card__header">
                  <p class="fiber-link-tip-step-card__eyebrow">Step 2</p>
                  <h3>Scan and pay</h3>
                  <p class="fiber-link-tip-step-card__description">
                    Use Fiber Wallet to scan the QR code, or open the request directly in a compatible wallet.
                  </p>
                </div>
                {{#if this.invoice}}
                  <div class="fiber-link-tip-payment-shell">
                    <div class="fiber-link-tip-payment-shell__qr-column">
                      <p class="fiber-link-tip-step-card__caption">Scan with Fiber Wallet</p>
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
                            QR preview unavailable. Use the wallet deep link or copy the invoice below.
                          </p>
                        </div>
                      {{/if}}
                    </div>
                    <div class="fiber-link-tip-payment-shell__details">
                      <div class="fiber-link-tip-status-row fiber-link-tip-status-row--panel">
                        <span class={{this.statusClass}}>{{this.statusLabel}}</span>
                        <p class="fiber-link-tip-step-card__caption">{{this.autoPollMessage}}</p>
                      </div>
                      <div class="fiber-link-tip-step-card__actions fiber-link-tip-step-card__actions--stacked">
                        <DButton @translatedLabel="Copy Invoice" @action={{this.copyInvoice}} />
                        {{#if this.walletHref}}
                          <a
                            class="btn fiber-link-tip-wallet-link"
                            data-fiber-link-tip-modal="wallet-link"
                            href={{this.walletHref}}
                          >
                            Open Fiber Wallet
                          </a>
                        {{/if}}
                      </div>
                      {{#if this.copyFeedback}}
                        <span class="fiber-link-tip-copy-feedback">{{this.copyFeedback}}</span>
                      {{/if}}
                      <button
                        type="button"
                        class="btn-link fiber-link-tip-advanced-toggle"
                        {{on "click" this.toggleAdvanced}}
                      >
                        Advanced
                      </button>
                      {{#if this.showAdvanced}}
                        <div class="fiber-link-tip-advanced-panel">
                          <p class="fiber-link-tip-invoice-label">Invoice</p>
                          <code class="fiber-link-tip-invoice" title={{this.invoice}}>{{this.invoice}}</code>
                          <DButton
                            class="fiber-link-tip-advanced-action"
                            @action={{this.checkStatus}}
                            @translatedLabel={{this.checkStatusLabel}}
                            @disabled={{this.isCheckStatusDisabled}}
                          />
                        </div>
                      {{/if}}
                    </div>
                  </div>
                {{else}}
                  <p class="fiber-link-tip-step-card__placeholder">
                    Generate an invoice first. Then scan it in your Fiber wallet or copy it manually.
                  </p>
                {{/if}}
              </section>
            {{/if}}

            {{#if this.isConfirmedStep}}
              <section class="fiber-link-tip-step-card fiber-link-tip-step-card--immersive fiber-link-tip-step-card--confirmed" data-fiber-link-tip-modal-step="confirmed">
                <div class="fiber-link-tip-success-mark" aria-hidden="true">
                  <span>✓</span>
                </div>
                <div class="fiber-link-tip-step-card__header fiber-link-tip-step-card__header--centered">
                  <p class="fiber-link-tip-step-card__eyebrow">Step 3</p>
                  <h3>Payment confirmed</h3>
                  <p class="fiber-link-tip-step-card__description">
                    {{this.displayAmount}} CKB is on its way to @{{this.targetUsername}} through Fiber Link.
                  </p>
                </div>
                <div class="fiber-link-tip-status-row fiber-link-tip-status-row--success">
                  <span class={{this.statusClass}}>{{this.statusLabel}}</span>
                </div>
                <div class="fiber-link-tip-success-actions">
                  <a
                    href={{this.brandHomepageUrl}}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn fiber-link-tip-wallet-link"
                  >
                    Explore Fiber Link
                  </a>
                </div>
              </section>
            {{/if}}
          </div>
        </div>
      </:body>

      <:footer>
        <DModalCancel @close={{@closeModal}} />
      </:footer>
    </DModal>
  </template>
}
