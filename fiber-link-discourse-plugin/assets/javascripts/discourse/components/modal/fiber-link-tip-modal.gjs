import Component from "@glimmer/component";
import { registerDestructor } from "@ember/destroyable";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DModalCancel from "discourse/components/d-modal-cancel";
import { avatarUrl } from "discourse/lib/avatar-utils";
import { clipboardCopy } from "discourse/lib/utilities";

import { createTip, getTipStatus } from "../../services/fiber-link-api";

const AMOUNT_PATTERN = /^(?:\d+)(?:\.\d{1,8})?$/;
const COPY_FEEDBACK_TIMEOUT_MS = 3000;
const TIP_STATUS_AUTO_POLL_INTERVAL_MS = 1000;
const FIBER_LINK_HOMEPAGE_URL = "https://www.fiberlink.me";
const FIBER_LINK_LOGO_URL = "https://fiberlink.me/brand/fiber-link-logo.png";
const MAX_MESSAGE_LENGTH = 120;
const QUICK_AMOUNTS = ["1", "5", "10"];

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
  @tracked copyState = "idle";

  _pollTimer = null;
  _copyFeedbackTimer = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      this._clearStatusPollTimer();
      this._clearCopyFeedbackTimer();
    });
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

  get targetAvatarUrl() {
    const template = normalizeMessage(this.args?.model?.targetAvatarTemplate);
    return template ? avatarUrl(template, "large") : null;
  }

  get targetInitial() {
    return this.targetUsername.slice(0, 1).toUpperCase();
  }

  get topicTitle() {
    const value = normalizeMessage(this.args?.model?.topicTitle);
    return value || "Community post";
  }

  get postNumber() {
    const rawValue = this.args?.model?.postNumber;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get postSummary() {
    const value = normalizeMessage(this.args?.model?.postSummary);
    return value || (this.postNumber ? `Reply #${this.postNumber}` : "Reply");
  }

  get isReplyContext() {
    return this.args?.model?.isReplyContext === true;
  }

  get contextLabel() {
    return this.isReplyContext ? "Reply:" : "Topic:";
  }

  get contextSectionLabel() {
    return this.isReplyContext ? "Reply context" : "Topic";
  }

  get contextTitle() {
    return this.isReplyContext ? this.postSummary : this.topicTitle;
  }

  get brandHomepageUrl() {
    return FIBER_LINK_HOMEPAGE_URL;
  }

  get brandLogoUrl() {
    return FIBER_LINK_LOGO_URL;
  }

  get modalTitle() {
    return "Send a tip";
  }

  get stepNumberLabel() {
    if (this.isPayStep) {
      return "Step 02";
    }
    if (this.isConfirmedStep) {
      return "Step 02";
    }
    return "Step 01";
  }

  get stepContextLabel() {
    if (this.isPayStep) {
      return "of 02 · Pay with wallet";
    }
    if (this.isConfirmedStep) {
      return "of 02 · Complete";
    }
    return "of 02 · Amount";
  }

  get invoicePreview() {
    const value = normalizeMessage(this.invoice);
    if (!value) {
      return "";
    }
    if (value.length <= 28) {
      return value;
    }
    return `${value.slice(0, 18)}…${value.slice(-6)}`;
  }

  get quickAmountItems() {
    const amount = normalizeMessage(this.amount);
    return QUICK_AMOUNTS.map((value) => ({
      value,
      className: value === amount ? "fiber-link-tip-chip is-selected" : "fiber-link-tip-chip",
      isSelected: value === amount,
      ariaPressed: value === amount ? "true" : "false",
    }));
  }

  get isCustomAmountSelected() {
    const amount = normalizeMessage(this.amount);
    return amount !== "" && !QUICK_AMOUNTS.includes(amount);
  }

  get customAmountClassName() {
    return this.isCustomAmountSelected
      ? "fiber-link-tip-chip is-selected"
      : "fiber-link-tip-chip";
  }

  get customAmountAriaPressed() {
    return this.isCustomAmountSelected ? "true" : "false";
  }

  get maxMessageLength() {
    return MAX_MESSAGE_LENGTH;
  }

  get messageCharacterCount() {
    return this.message.length;
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

  get generateButtonLabel() {
    return this.isGenerating ? "Preparing payment..." : "Review & Pay";
  }

  get shouldShowInvoiceQr() {
    return typeof this.invoiceQrDataUrl === "string" && this.invoiceQrDataUrl.trim().startsWith("data:image/");
  }

  get shouldShowInvoiceTimer() {
    return false;
  }

  get copyButtonIcon() {
    return this.copyState === "copied" ? "check" : "copy";
  }

  get copyButtonLabel() {
    if (this.copyState === "copied") {
      return "Copied";
    }
    if (this.copyState === "failed") {
      return "Copy failed";
    }
    return "Copy invoice";
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

  _clearCopyFeedbackTimer() {
    if (this._copyFeedbackTimer) {
      clearTimeout(this._copyFeedbackTimer);
      this._copyFeedbackTimer = null;
    }
  }

  _resetCopyState() {
    this._clearCopyFeedbackTimer();
    this.copyState = "idle";
  }

  _setTemporaryCopyState(state) {
    this._clearCopyFeedbackTimer();
    this.copyState = state;
    this._copyFeedbackTimer = setTimeout(() => {
      this._copyFeedbackTimer = null;
      this.copyState = "idle";
    }, COPY_FEEDBACK_TIMEOUT_MS);
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
    this._resetCopyState();
  }

  @action
  onMessageInput(event) {
    this.message = event?.target?.value ?? "";
  }

  @action
  onQuickAmountClick(event) {
    const value = event?.currentTarget?.dataset?.quickAmount ?? event?.target?.dataset?.quickAmount ?? "";
    if (!value) {
      return;
    }
    this.amount = value;
    this._resetCopyState();
  }

  @action
  async generateInvoice() {
    let scheduleAutoPoll = false;

    if (this.isGenerating) {
      return;
    }

    this.errorMessage = null;
    this._resetCopyState();
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
    this.isChecking = true;

    try {
      const state = normalizeMessage((await getTipStatus({ invoice: this.invoice }))?.state).toUpperCase() || "UNPAID";
      this.statusState = state;
      this.statusLabel = mapTipStateToLabel(state);
      this.statusClass = mapTipStateToClass(state);
      this.errorMessage = null;

      if (state === "SETTLED") {
        this.currentStep = "confirmed";
        this._clearStatusPollTimer();
      } else if (state === "UNPAID" || state === "DETECTED" || state === "PROCESSING") {
        this.currentStep = "pay";
        scheduleAutoPoll = true;
      } else {
        this.currentStep = "pay";
        this._clearStatusPollTimer();
      }
    } catch (e) {
      if (isAutoPoll && isTransientNetworkError(normalizeMessage(e?.message))) {
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

    this._resetCopyState();

    try {
      await clipboardCopy(this.invoice);
      this._setTemporaryCopyState("copied");
    } catch (_error) {
      this._setTemporaryCopyState("failed");
    }
  }

  <template>
    <DModal @closeModal={{@closeModal}} @title={{this.modalTitle}} class="fiber-link-tip-modal">
      <:body>
        <div class="fiber-link-tip-modal__content">
          <header class="fiber-link-tip-modal__header">
            <section class="fiber-link-tip-modal__hero">
              <h2>
                <span>{{this.displayAmount}}</span>
                <em>CKB</em>
              </h2>
              <div class="fiber-link-tip-modal__hero-sub">
                <span>Tipping</span>
                <span class="fiber-link-tip-modal__hero-handle">@{{this.targetUsername}}</span>
              </div>
            </section>

            <div class="fiber-link-tip-modal__recipient-strip" data-fiber-link-tip-modal="recipient">
              <div class="fiber-link-tip-modal__recipient-identity">
                {{#if this.targetAvatarUrl}}
                  <img
                    class="fiber-link-tip-modal__recipient-avatar"
                    data-fiber-link-tip-modal="recipient-avatar"
                    src={{this.targetAvatarUrl}}
                    alt=""
                  />
                {{else}}
                  <span
                    class="fiber-link-tip-modal__recipient-avatar fiber-link-tip-modal__recipient-avatar--fallback"
                    aria-hidden="true"
                  >
                    {{this.targetInitial}}
                  </span>
                {{/if}}
                <div class="fiber-link-tip-modal__recipient-copy">
                  <strong>@{{this.targetUsername}}</strong>
                  <span>Recipient · verified 2d ago</span>
                </div>
              </div>
              <p class="fiber-link-tip-modal__receive-note">
                <span>Receives</span>
                <strong>{{this.displayAmount}}<small>CKB</small></strong>
              </p>
            </div>

            <div class="fiber-link-tip-modal__meta" data-fiber-link-tip-modal="summary">
              <div class="fiber-link-tip-modal__meta-cell">
                <span>{{this.contextSectionLabel}}</span>
                <strong title={{this.contextTitle}}>{{this.contextTitle}}</strong>
              </div>
              <div class="fiber-link-tip-modal__meta-cell">
                <span>Network</span>
                <strong>Fiber Link · Mainnet</strong>
              </div>
            </div>
          </header>

          {{#if this.errorMessage}}
            <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
          {{/if}}

          {{#if this.isSelfTip}}
            <p class="fiber-link-tip-alert is-warning">You can’t tip your own post.</p>
          {{/if}}

          {{#if this.isGenerateStep}}
            <section class="fiber-link-tip-step-card" data-fiber-link-tip-modal-step="generate">
              <div class="fiber-link-tip-step-card__header">
                <span class="fiber-link-tip-step-card__eyebrow">
                  <strong>{{this.stepNumberLabel}}</strong>
                  <span>{{this.stepContextLabel}}</span>
                  <span class="fiber-link-tip-step-card__line" aria-hidden="true"></span>
                  <span
                    class="fiber-link-tip-step-card__progress"
                    data-fiber-link-tip-modal="stepper"
                    aria-hidden="true"
                  >
                    <span class="is-active"></span>
                    <span></span>
                  </span>
                </span>
              </div>

              <div class="fiber-link-tip-form">
                <label class="fiber-link-tip-field">
                  <span class="fiber-link-tip-field-row">
                    <span class="fiber-link-tip-label">Amount</span>
                    <span class="fiber-link-tip-field-hint">≈ $0.42 USD</span>
                  </span>
                  <div class="fiber-link-tip-input-group">
                    <input
                      class="fiber-link-tip-input fiber-link-tip-input--amount"
                      aria-label="Amount"
                      inputmode="decimal"
                      name="fiber-link-tip-amount"
                      value={{this.amount}}
                      {{on "input" this.onAmountInput}}
                    />
                    <span class="fiber-link-tip-input-suffix">CKB</span>
                  </div>
                </label>

                <div class="fiber-link-tip-quick-amounts" aria-label="Quick amounts">
                  {{#each this.quickAmountItems as |quickAmount|}}
                    <button
                      type="button"
                      class={{quickAmount.className}}
                      data-quick-amount={{quickAmount.value}}
                      aria-pressed={{quickAmount.ariaPressed}}
                      {{on "click" this.onQuickAmountClick}}
                    >
                      {{quickAmount.value}} CKB
                    </button>
                  {{/each}}
                  <button
                    type="button"
                    class={{this.customAmountClassName}}
                    aria-pressed={{this.customAmountAriaPressed}}
                  >
                    Custom
                  </button>
                </div>

                {{#if this.amountErrorMessage}}
                  <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
                {{/if}}

                <label class="fiber-link-tip-field">
                  <span class="fiber-link-tip-field-row">
                    <span class="fiber-link-tip-label">Tip message</span>
                    <span class="fiber-link-tip-field-hint">Optional · {{this.messageCharacterCount}} / {{this.maxMessageLength}}</span>
                  </span>
                  <span class="fiber-link-tip-textarea-wrap">
                    <textarea
                      class="fiber-link-tip-input fiber-link-tip-textarea"
                      aria-label="Message (optional)"
                      maxlength={{this.maxMessageLength}}
                      name="fiber-link-tip-message"
                      rows="3"
                      placeholder="Leave a short note"
                      value={{this.message}}
                      {{on "input" this.onMessageInput}}
                    ></textarea>
                  </span>
                </label>

              </div>
            </section>
          {{/if}}

          {{#if this.isPayStep}}
            <section class="fiber-link-tip-step-card fiber-link-tip-step-card--pay" data-fiber-link-tip-modal-step="pay">
              <div class="fiber-link-tip-step-card__header">
                <span class="fiber-link-tip-step-card__eyebrow">
                  <strong>{{this.stepNumberLabel}}</strong>
                  <span>{{this.stepContextLabel}}</span>
                  <span class="fiber-link-tip-step-card__line" aria-hidden="true"></span>
                  <span
                    class="fiber-link-tip-step-card__progress"
                    data-fiber-link-tip-modal="stepper"
                    aria-hidden="true"
                  >
                    <span class="is-active"></span>
                    <span class="is-active"></span>
                  </span>
                </span>
              </div>

              {{#if this.invoice}}
                {{#if this.shouldShowInvoiceQr}}
                  <div class="fiber-link-tip-invoice-visual">
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

                <div class="fiber-link-tip-status-row">
                  <span class="fiber-link-tip-status-line">
                    <span
                      class="fiber-link-tip-status-spinner"
                      data-fiber-link-tip-modal="status-spinner"
                      aria-hidden="true"
                    ></span>
                    <span>{{this.statusLabel}}</span>
                    <small>· listening on Fiber Link</small>
                  </span>
                </div>

                <div class="fiber-link-tip-invoice-line">
                  <span>Invoice</span>
                  <strong
                    data-fiber-link-tip-modal="invoice-value"
                    data-fiber-link-invoice={{this.invoice}}
                    title={{this.invoice}}
                  >
                    {{this.invoicePreview}}
                  </strong>
                  <DButton
                    class="fiber-link-tip-copy-button"
                    data-fiber-link-tip-modal="copy-invoice"
                    @action={{this.copyInvoice}}
                    @icon={{this.copyButtonIcon}}
                    @translatedAriaLabel={{this.copyButtonLabel}}
                    @translatedTitle={{this.copyButtonLabel}}
                  />
                </div>

                {{#if this.shouldShowInvoiceTimer}}
                  <div class="fiber-link-tip-timer">
                    <span>Expires in</span>
                    <span class="fiber-link-tip-timer__track" aria-hidden="true"></span>
                    <strong>09:24</strong>
                  </div>
                {{/if}}
              {{/if}}
            </section>
          {{/if}}

          {{#if this.isConfirmedStep}}
            <section class="fiber-link-tip-step-card fiber-link-tip-step-card--confirmed" data-fiber-link-tip-modal-step="confirmed">
              <div class="fiber-link-tip-success-mark" aria-hidden="true">
                <span>✓</span>
              </div>
              <div class="fiber-link-tip-step-card__header is-centered">
                <h3>Payment complete</h3>
                <p class="fiber-link-tip-step-card__caption">{{this.displayAmount}} CKB sent to @{{this.targetUsername}}.</p>
              </div>
              <div class="fiber-link-tip-status-row">
                <span class={{this.statusClass}}>{{this.statusLabel}}</span>
              </div>
            </section>
          {{/if}}
        </div>
      </:body>

      <:footer>
        <div class="fiber-link-tip-footer">
          <div class="fiber-link-tip-modal__powered-by">
            <img
              src={{this.brandLogoUrl}}
              alt=""
              class="fiber-link-tip-modal__brand-logo"
              data-fiber-link-tip-modal="brand-logo"
            />
            <span>Powered by</span>
            <a
              href={{this.brandHomepageUrl}}
              target="_blank"
              rel="noopener noreferrer"
              data-fiber-link-tip-modal="brand-link"
            >
              <strong>Fiber Link</strong>
            </a>
          </div>

          <div class="fiber-link-tip-footer__actions">
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
                <button
                  type="button"
                  class="btn-primary fiber-link-tip-wallet-link"
                  data-fiber-link-tip-modal="wallet-button"
                  disabled
                >
                  Open Fiber Wallet →
                </button>
              {{/if}}

              {{#if this.isConfirmedStep}}
                <DButton class="btn-primary" @action={{@closeModal}} @translatedLabel="Done" />
              {{/if}}
            </div>
          </div>
        </div>
      </:footer>
    </DModal>
  </template>
}
