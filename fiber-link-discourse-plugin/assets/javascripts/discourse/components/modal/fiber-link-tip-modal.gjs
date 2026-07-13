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
import { i18n } from "discourse-i18n";

import { createTip, getTipStatus, streamTipStatus } from "../../services/fiber-link-api";

const AMOUNT_PATTERN = /^(?:\d+)(?:\.\d{1,8})?$/;
const COPY_FEEDBACK_TIMEOUT_MS = 3000;
const TIP_STATUS_AUTO_POLL_INTERVAL_MS = 1000;
const TIP_STATUS_AUTO_POLL_MAX_BACKOFF_MS = 8000;
const TIP_STATUS_AUTO_POLL_MAX_FAILURES = 5;
const TIP_STATUS_AUTO_POLL_MAX_ELAPSED_MS = 120000;
const TIP_STATUS_HIDDEN_POLL_INTERVAL_MS = 15000;
const TIP_GENERATION_WATCHDOG_MS = 15000;
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

function isRetryableStatusError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.code);
  const message = normalizeMessage(error?.message).toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    isTransientNetworkError(message)
  );
}

function withTipGenerationWatchdog(promise) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(i18n("fiber_link.tip_modal.watchdog_message")));
    }, TIP_GENERATION_WATCHDOG_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function mapTipStateToLabel(state) {
  switch (state) {
    case "SETTLED":
      return i18n("fiber_link.tip_modal.status_settled");
    case "PROCESSING":
      return i18n("fiber_link.tip_modal.status_processing");
    case "FAILED":
      return i18n("fiber_link.tip_modal.status_failed");
    case "EXPIRED":
      return i18n("fiber_link.tip_modal.status_expired");
    case "DETECTED":
      return i18n("fiber_link.tip_modal.status_detected");
    default:
      return i18n("fiber_link.tip_modal.status_unpaid");
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
    return i18n("fiber_link.tip_modal.error_self_tip");
  }
  if (code === -32602 || lower.includes("invalid params")) {
    return i18n("fiber_link.tip_modal.error_invalid_params");
  }
  if (isTransientNetworkError(message)) {
    return i18n("fiber_link.tip_modal.error_generate_network");
  }
  return message || i18n("fiber_link.tip_modal.error_generate_failed");
}

function mapStatusErrorToMessage(error) {
  const message = normalizeMessage(error?.message);
  if (isTransientNetworkError(message)) {
    return i18n("fiber_link.tip_modal.error_status_network");
  }
  return message || i18n("fiber_link.tip_modal.error_status_failed");
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
  _statusPollStartedAt = null;
  _statusPollFailureCount = 0;
  _sseHandle = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      this._clearStatusPollTimer();
      this._clearCopyFeedbackTimer();
      this._closeSse();
    });
  }

  _closeSse() {
    if (this._sseHandle) {
      this._sseHandle.close();
      this._sseHandle = null;
    }
  }

  _tryOpenSse(invoice) {
    this._closeSse();
    const handle = streamTipStatus(invoice, (event) => {
      const status = event?.status;
      if (status === "SETTLED") {
        this._closeSse();
        this._clearStatusPollTimer();
        this.statusState = "SETTLED";
        this.statusLabel = mapTipStateToLabel("SETTLED");
        this.statusClass = mapTipStateToClass("SETTLED");
        this.currentStep = "confirmed";
      } else if (status === "TIMEOUT" || status === "SSE_ERROR") {
        // SSE unavailable or timed out — fall back to polling.
        this._closeSse();
        this._scheduleStatusPoll();
      }
    });
    if (handle) {
      this._sseHandle = handle;
      return true;
    }
    return false;
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
    return value || i18n("fiber_link.tip.post_author_fallback");
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
    return value || i18n("fiber_link.tip_modal.topic_fallback");
  }

  get postNumber() {
    const rawValue = this.args?.model?.postNumber;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get postSummary() {
    const value = normalizeMessage(this.args?.model?.postSummary);
    return value || (this.postNumber ? i18n("fiber_link.tip_modal.reply_number", { number: this.postNumber }) : i18n("fiber_link.tip_modal.reply_fallback"));
  }

  get isReplyContext() {
    return this.args?.model?.isReplyContext === true;
  }

  get contextLabel() {
    return this.isReplyContext ? i18n("fiber_link.tip_modal.context_reply") : i18n("fiber_link.tip_modal.context_topic");
  }

  get contextSectionLabel() {
    return this.isReplyContext ? i18n("fiber_link.tip_modal.section_reply") : i18n("fiber_link.tip_modal.section_topic");
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
    return i18n("fiber_link.tip_modal.title");
  }

  get stepNumberLabel() {
    if (this.isPayStep) {
      return i18n("fiber_link.tip_modal.step_two");
    }
    if (this.isConfirmedStep) {
      return i18n("fiber_link.tip_modal.step_two");
    }
    return i18n("fiber_link.tip_modal.step_one");
  }

  get stepContextLabel() {
    if (this.isPayStep) {
      return i18n("fiber_link.tip_modal.step_context_pay");
    }
    if (this.isConfirmedStep) {
      return i18n("fiber_link.tip_modal.step_context_complete");
    }
    return i18n("fiber_link.tip_modal.step_context_amount");
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
      return i18n("fiber_link.tip_modal.error_amount_required");
    }
    if (!AMOUNT_PATTERN.test(value)) {
      return i18n("fiber_link.tip_modal.error_amount_pattern");
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return i18n("fiber_link.tip_modal.error_amount_positive");
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
    return this.isGenerating ? i18n("fiber_link.tip_modal.generating") : i18n("fiber_link.tip_modal.generate");
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
      return i18n("fiber_link.tip_modal.copied");
    }
    if (this.copyState === "failed") {
      return i18n("fiber_link.tip_modal.copy_failed");
    }
    return i18n("fiber_link.tip_modal.copy_invoice");
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

  _resetStatusPollBounds() {
    this._statusPollStartedAt = Date.now();
    this._statusPollFailureCount = 0;
  }

  _isDocumentHidden() {
    return typeof document !== "undefined" && document?.hidden === true;
  }

  _getStatusPollDelay() {
    const backoffDelay = Math.min(
      TIP_STATUS_AUTO_POLL_MAX_BACKOFF_MS,
      TIP_STATUS_AUTO_POLL_INTERVAL_MS * Math.pow(2, this._statusPollFailureCount),
    );

    return this._isDocumentHidden()
      ? Math.max(backoffDelay, TIP_STATUS_HIDDEN_POLL_INTERVAL_MS)
      : backoffDelay;
  }

  _canContinueStatusPolling() {
    if (!this._statusPollStartedAt) {
      this._statusPollStartedAt = Date.now();
    }

    const elapsedMs = Date.now() - this._statusPollStartedAt;
    return (
      elapsedMs <= TIP_STATUS_AUTO_POLL_MAX_ELAPSED_MS &&
      this._statusPollFailureCount < TIP_STATUS_AUTO_POLL_MAX_FAILURES
    );
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

    if (!this._canContinueStatusPolling()) {
      const message = this._statusPollFailureCount > 0
        ? i18n("fiber_link.tip_modal.poll_paused")
        : i18n("fiber_link.tip_modal.poll_timed_out");
      this.errorMessage = mapStatusErrorToMessage(
        new Error(message),
      );
      return;
    }

    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      void this.checkStatus({ isAutoPoll: true });
    }, this._getStatusPollDelay());
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
      this.errorMessage = i18n("fiber_link.tip_modal.error_self_tip");
      return;
    }

    if (this.amountErrorMessage) {
      this.errorMessage = this.amountErrorMessage;
      return;
    }

    if (!this.postId || !this.fromUserId || !this.targetUserId) {
      this.errorMessage = i18n("fiber_link.tip_modal.error_missing_context");
      return;
    }

    this.isGenerating = true;

    try {
      const result = await withTipGenerationWatchdog(
        createTip({
          amount: this.amount.trim(),
          asset: "CKB",
          postId: String(this.postId),
          fromUserId: String(this.fromUserId),
          toUserId: String(this.targetUserId),
          message: normalizeMessage(this.message) || null,
        }),
      );

      if (!normalizeMessage(result?.invoice)) {
        throw new Error(i18n("fiber_link.tip_modal.error_invoice_empty"));
      }

      this.invoice = result?.invoice;
      this.invoiceQrDataUrl = normalizeMessage(result?.invoiceQrDataUrl) || null;
      this.currentStep = "pay";
      this.statusState = "UNPAID";
      this.statusLabel = mapTipStateToLabel("UNPAID");
      this.statusClass = mapTipStateToClass("UNPAID");
      this._resetStatusPollBounds();

      // Try SSE first; fall back to polling if the browser or proxy doesn't support it.
      const sseOpened = this._tryOpenSse(this.invoice);
      if (!sseOpened) {
        scheduleAutoPoll = true;
      }
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
      this._resetStatusPollBounds();
    }
    this.isChecking = true;

    try {
      const state = normalizeMessage((await getTipStatus({ invoice: this.invoice }))?.state).toUpperCase() || "UNPAID";
      this.statusState = state;
      this.statusLabel = mapTipStateToLabel(state);
      this.statusClass = mapTipStateToClass(state);
      this.errorMessage = null;
      this._statusPollFailureCount = 0;

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
      if (isAutoPoll && isRetryableStatusError(e)) {
        this._statusPollFailureCount += 1;
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
                <span>{{i18n "fiber_link.tip_modal.tipping"}}</span>
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
                  <span>{{i18n "fiber_link.tip_modal.recipient_note"}}</span>
                </div>
              </div>
              <p class="fiber-link-tip-modal__receive-note">
                <span>{{i18n "fiber_link.tip_modal.receives"}}</span>
                <strong>{{this.displayAmount}}<small>CKB</small></strong>
              </p>
            </div>

            <div class="fiber-link-tip-modal__meta" data-fiber-link-tip-modal="summary">
              <div class="fiber-link-tip-modal__meta-cell">
                <span>{{this.contextSectionLabel}}</span>
                <strong title={{this.contextTitle}}>{{this.contextTitle}}</strong>
              </div>
              <div class="fiber-link-tip-modal__meta-cell">
                <span>{{i18n "fiber_link.tip_modal.network"}}</span>
                <strong>{{i18n "fiber_link.tip_modal.network_value"}}</strong>
              </div>
            </div>
          </header>

          {{#if this.errorMessage}}
            <p class="fiber-link-tip-alert is-error" data-fiber-link-tip-modal="error">{{this.errorMessage}}</p>
          {{/if}}

          {{#if this.isGenerating}}
            <p class="fiber-link-tip-alert is-info" data-fiber-link-tip-modal="invoice-loading">
              {{i18n "fiber_link.tip_modal.preparing_invoice"}}
            </p>
          {{/if}}

          {{#if this.isSelfTip}}
            <p class="fiber-link-tip-alert is-warning">{{i18n "fiber_link.tip_modal.error_self_tip"}}</p>
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
                    <span class="fiber-link-tip-label">{{i18n "fiber_link.tip_modal.amount_label"}}</span>
                    <span class="fiber-link-tip-field-hint">≈ $0.42 USD</span>
                  </span>
                  <div class="fiber-link-tip-input-group">
                    <input
                      class="fiber-link-tip-input fiber-link-tip-input--amount"
                      aria-label={{i18n "fiber_link.tip_modal.amount_label"}}
                      inputmode="decimal"
                      name="fiber-link-tip-amount"
                      value={{this.amount}}
                      {{on "input" this.onAmountInput}}
                    />
                    <span class="fiber-link-tip-input-suffix">CKB</span>
                  </div>
                </label>

                <div class="fiber-link-tip-quick-amounts" aria-label={{i18n "fiber_link.tip_modal.quick_amounts_aria"}}>
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
                    {{i18n "fiber_link.tip_modal.custom"}}
                  </button>
                </div>

                {{#if this.amountErrorMessage}}
                  <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
                {{/if}}

                <label class="fiber-link-tip-field">
                  <span class="fiber-link-tip-field-row">
                    <span class="fiber-link-tip-label">{{i18n "fiber_link.tip_modal.message_label"}}</span>
                    <span class="fiber-link-tip-field-hint">{{i18n "fiber_link.tip_modal.message_hint" current=this.messageCharacterCount max=this.maxMessageLength}}</span>
                  </span>
                  <span class="fiber-link-tip-textarea-wrap">
                    <textarea
                      class="fiber-link-tip-input fiber-link-tip-textarea"
                      aria-label={{i18n "fiber_link.tip_modal.message_aria"}}
                      maxlength={{this.maxMessageLength}}
                      name="fiber-link-tip-message"
                      rows="3"
                      placeholder={{i18n "fiber_link.tip_modal.message_placeholder"}}
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
                      alt={{i18n "fiber_link.tip_modal.qr_alt"}}
                    />
                  </div>
                {{else}}
                  <div class="fiber-link-tip-invoice-visual fiber-link-tip-invoice-visual--placeholder">
                    <p class="fiber-link-tip-step-card__placeholder">
                      {{i18n "fiber_link.tip_modal.qr_unavailable"}}
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
                    <small>{{i18n "fiber_link.tip_modal.listening"}}</small>
                  </span>
                </div>

                <div class="fiber-link-tip-invoice-line">
                  <span>{{i18n "fiber_link.tip_modal.invoice_label"}}</span>
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
                    <span>{{i18n "fiber_link.tip_modal.expires_in"}}</span>
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
                <h3>{{i18n "fiber_link.tip_modal.confirmed_title"}}</h3>
                <p class="fiber-link-tip-step-card__caption">{{i18n "fiber_link.tip_modal.confirmed_caption" amount=this.displayAmount username=this.targetUsername}}</p>
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
            <span>{{i18n "fiber_link.tip_modal.powered_by"}}</span>
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
              {{#unless this.isConfirmedStep}}
                <DModalCancel @close={{@closeModal}} />
              {{/unless}}
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
                  {{i18n "fiber_link.tip_modal.open_wallet"}}
                </button>
              {{/if}}

              {{#if this.isConfirmedStep}}
                <DButton class="btn-primary" @action={{@closeModal}} @translatedLabel={{i18n "fiber_link.tip_modal.done"}} />
              {{/if}}
            </div>
          </div>
        </div>
      </:footer>
    </DModal>
  </template>
}
