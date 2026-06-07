import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import DButton from "discourse/components/d-button";

import { quoteWithdrawal, requestWithdrawal } from "../services/fiber-link-api";

const MIN_WITHDRAW_AMOUNT = 61;
const ADDRESS_PATTERN = /^(?:ckt|ckb)1[0-9a-zA-Z]+$/;
const QUOTE_DEBOUNCE_MS = 300;

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getWithdrawalResultPresentation(state) {
  if (state === "LIQUIDITY_PENDING") {
    return {
      alertClass: "fiber-link-tip-alert is-warning",
      badgeClass: "fiber-link-status-badge is-liquidity-pending",
      badgeLabel: "Liquidity Pending",
      detail: "Withdrawal queued until liquidity is available.",
    };
  }

  return {
    alertClass: "fiber-link-tip-alert is-success",
    badgeClass: "fiber-link-status-badge is-warning",
    badgeLabel: state,
    detail: null,
  };
}

export default class FiberLinkWithdrawalPanel extends Component {
  @service toasts;

  @tracked amount = "61";
  @tracked destinationAddress = "";
  @tracked isSubmitting = false;
  @tracked isQuoteLoading = false;
  @tracked errorMessage = null;
  @tracked quoteErrorMessage = null;
  @tracked pasteErrorMessage = null;
  @tracked quote = null;
  @tracked requestedId = null;
  @tracked requestedState = null;
  @tracked hasSubmitted = false;

  _quoteTimer = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this._clearQuoteTimer());
  }

  get asset() {
    return this.args.asset === "USDI" ? "USDI" : "CKB";
  }

  get availableBalance() {
    return normalizeValue(this.quote?.availableBalance) || normalizeValue(this.args.availableBalance) || "0";
  }

  get lockedBalance() {
    return normalizeValue(this.quote?.lockedBalance) || normalizeValue(this.args.lockedBalance) || "0";
  }

  get receiveAmount() {
    if (this.asset === "CKB") {
      return normalizeValue(this.amount) || "0";
    }

    return normalizeValue(this.quote?.receiveAmount) || normalizeValue(this.amount) || "0";
  }

  get networkFee() {
    if (this.asset === "CKB") {
      return "0";
    }

    return normalizeValue(this.quote?.networkFee) || "0";
  }

  get amountErrorMessage() {
    const value = normalizeValue(this.amount);
    if (!value) {
      return "Enter an amount in CKB.";
    }

    if (!/^\d+(?:\.\d+)?$/.test(value)) {
      return "Amount must be numeric.";
    }

    if (Number(value) < MIN_WITHDRAW_AMOUNT) {
      return `Amount must be at least ${MIN_WITHDRAW_AMOUNT} CKB.`;
    }

    if (Number(value) > this.availableBalanceNumber) {
      return "Amount exceeds available balance.";
    }

    return null;
  }

  get addressErrorMessage() {
    const value = normalizeValue(this.destinationAddress);
    if (!value) {
      return "Enter a valid CKB withdrawal address.";
    }

    if (!ADDRESS_PATTERN.test(value)) {
      return "Enter a valid CKB withdrawal address.";
    }

    return null;
  }

  get isDestinationBlank() {
    return !normalizeValue(this.destinationAddress);
  }

  get destination() {
    const address = normalizeValue(this.destinationAddress);
    if (!address) {
      return null;
    }

    return {
      kind: "CKB_ADDRESS",
      address,
    };
  }

  get addressValidationMessage() {
    if (this.pasteErrorMessage) {
      return this.pasteErrorMessage;
    }

    if (this.addressErrorMessage) {
      if (this.isDestinationBlank && !this.hasSubmitted) {
        return null;
      }

      return this.addressErrorMessage;
    }

    if (this.quote?.destinationValid) {
      return "Address valid";
    }

    return normalizeValue(this.quote?.validationMessage) || null;
  }

  get addressValidationClass() {
    if (this.pasteErrorMessage) {
      return "fiber-link-dashboard__withdrawal-validation is-error";
    }

    if (this.addressErrorMessage || this.quote?.destinationValid === false) {
      return "fiber-link-dashboard__withdrawal-validation is-error";
    }
    if (this.quote?.destinationValid) {
      return "fiber-link-dashboard__withdrawal-validation is-success";
    }
    return "fiber-link-dashboard__withdrawal-validation";
  }

  get isSubmitDisabled() {
    return Boolean(
      this.isSubmitting ||
        this.isQuoteLoading ||
        this.amountErrorMessage ||
        this.addressErrorMessage ||
        this.quoteErrorMessage ||
        this.quote?.destinationValid === false ||
        !this.destination,
    );
  }

  get submitDisabledReason() {
    if (!this.isSubmitDisabled) {
      return null;
    }
    if (this.isSubmitting) {
      return "Withdrawal request is being submitted.";
    }
    if (this.isQuoteLoading) {
      return "Calculating withdrawal quote and network fee.";
    }
    if (this.amountErrorMessage) {
      return this.amountErrorMessage;
    }
    if (!this.destination) {
      return "Enter a destination address to enable withdrawal.";
    }
    if (this.addressErrorMessage) {
      return this.addressErrorMessage;
    }
    if (this.quote?.destinationValid === false) {
      return normalizeValue(this.quote?.validationMessage) || "Destination address is not valid for withdrawal.";
    }
    if (this.quoteErrorMessage) {
      return this.quoteErrorMessage;
    }
    return "Withdrawal is temporarily unavailable. Retry after the dashboard refreshes.";
  }

  get submitLabel() {
    return this.isSubmitting ? "Requesting..." : "Request withdrawal →";
  }

  get minimumWithdrawalAmount() {
    return MIN_WITHDRAW_AMOUNT;
  }

  get availableBalanceNumber() {
    const value = Number(this.availableBalance);
    return Number.isFinite(value) ? value : 0;
  }

  get maxWithdrawalAmountLabel() {
    return this._formatAmount(this.availableBalanceNumber);
  }

  get requestedResultPresentation() {
    return getWithdrawalResultPresentation(this.requestedState);
  }

  get successToastMessage() {
    const detail = this.requestedResultPresentation.detail;
    if (detail) {
      return detail;
    }

    return this.requestedId
      ? `Requested withdrawal ${this.requestedId}`
      : "Withdrawal request submitted.";
  }

  _clearQuoteTimer() {
    if (this._quoteTimer) {
      clearTimeout(this._quoteTimer);
      this._quoteTimer = null;
    }
  }

  _scheduleQuoteRefresh() {
    this._clearQuoteTimer();
    this.quoteErrorMessage = null;

    if (this.amountErrorMessage || this.addressErrorMessage || !this.destination) {
      this.quote = null;
      return;
    }

    this._quoteTimer = setTimeout(() => {
      this._quoteTimer = null;
      void this.refreshQuote();
    }, QUOTE_DEBOUNCE_MS);
  }

  @action
  onAmountInput(event) {
    this.amount = event?.target?.value ?? "";
    this.errorMessage = null;
    this.hasSubmitted = false;
    this._scheduleQuoteRefresh();
  }

  @action
  onAddressInput(event) {
    this.destinationAddress = event?.target?.value ?? "";
    this.errorMessage = null;
    this.pasteErrorMessage = null;
    this.hasSubmitted = false;
    this._scheduleQuoteRefresh();
  }

  @action
  setQuickAmount(event) {
    const quickAmount = event?.currentTarget?.dataset?.quickAmount;
    const availableBalance = this.availableBalanceNumber;
    let nextAmount = availableBalance;

    if (quickAmount !== "max") {
      nextAmount = availableBalance * Number(quickAmount || 0);
      nextAmount = Math.max(nextAmount, this.minimumWithdrawalAmount);
      nextAmount = Math.min(nextAmount, availableBalance);
    }

    this.amount = this._formatAmount(nextAmount);
    this.errorMessage = null;
    this.hasSubmitted = false;
    this._scheduleQuoteRefresh();
  }

  @action
  async pasteDestination() {
    this.pasteErrorMessage = null;
    this.errorMessage = null;

    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard unavailable");
      }

      this.destinationAddress = await navigator.clipboard.readText();
      this.hasSubmitted = false;
      this._scheduleQuoteRefresh();
    } catch (_error) {
      this.pasteErrorMessage = "Clipboard access failed. Paste manually.";
    }
  }

  @action
  async refreshQuote() {
    if (this.amountErrorMessage || this.addressErrorMessage || !this.destination) {
      return;
    }

    this.isQuoteLoading = true;
    this.quoteErrorMessage = null;

    try {
      this.quote = await quoteWithdrawal({
        amount: normalizeValue(this.amount),
        asset: this.asset,
        destination: this.destination,
      });
    } catch (error) {
      this.quoteErrorMessage = error?.message ?? "Failed to calculate withdrawal quote. Please retry.";
    } finally {
      this.isQuoteLoading = false;
    }
  }

  @action
  async submit() {
    this.hasSubmitted = true;

    if (
      this.isSubmitDisabled ||
      this.amountErrorMessage ||
      this.addressErrorMessage ||
      !this.destination ||
      this.quote?.destinationValid === false
    ) {
      this.errorMessage =
        this.amountErrorMessage ||
        this.addressErrorMessage ||
        this.submitDisabledReason ||
        this.quoteErrorMessage ||
        "Enter a valid CKB withdrawal address.";
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    try {
      const result = await requestWithdrawal({
        amount: normalizeValue(this.amount),
        asset: this.asset,
        destination: this.destination,
      });

      this.requestedId = result?.id ?? null;
      this.requestedState = result?.state ?? null;
      this.toasts.success({
        duration: "short",
        data: { message: this.successToastMessage },
      });

      if (typeof this.args.onRequested === "function") {
        this.args.onRequested(result);
      }
    } catch (error) {
      this.errorMessage = error?.message ?? "Failed to request withdrawal.";
    } finally {
      this.isSubmitting = false;
    }
  }

  _formatAmount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return "0";
    }

    return numericValue.toFixed(8).replace(/\.?0+$/, "");
  }

  <template>
    <section class="fiber-link-dashboard__withdrawal">
      <div class="fiber-link-dashboard__section-kicker">
        <strong>01</strong>
        <span>WITHDRAW</span>
      </div>

      <div class="fiber-link-dashboard__withdrawal-heading">
        <h3>Move your <span>settled</span> CKB.</h3>
        <p>
          Send funds from your Fiber Link balance to a wallet you control.
          Minimum withdrawal is {{this.minimumWithdrawalAmount}} CKB.
        </p>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error" data-fiber-link-withdrawal-result="error">
          {{this.errorMessage}}
        </p>
      {{/if}}

      <div class="fiber-link-dashboard__withdrawal-summary-grid">
        <div class="fiber-link-dashboard__withdrawal-summary-item">
          <span>Available</span>
          <strong>{{this.availableBalance}} {{this.asset}}</strong>
        </div>
        <div class="fiber-link-dashboard__withdrawal-summary-item">
          <span>Locked</span>
          <strong>{{this.lockedBalance}} {{this.asset}}</strong>
        </div>
        <div class="fiber-link-dashboard__withdrawal-summary-item is-highlighted">
          <span>Payout amount</span>
          <strong>{{this.receiveAmount}} {{this.asset}}</strong>
        </div>
      </div>

      <div class="fiber-link-dashboard__withdrawal-form">
        <label class="fiber-link-tip-field">
          <span class="fiber-link-dashboard__field-row">
            <span class="fiber-link-tip-label">Amount</span>
            <span>Network fee {{this.networkFee}} {{this.asset}}</span>
          </span>
          <span class="fiber-link-dashboard__amount-input-wrap">
            <input
              class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input is-amount"
              data-fiber-link-withdrawal-input="amount"
              id="fiber-link-withdrawal-amount"
              name="fiber-link-withdrawal-amount"
              inputmode="decimal"
              min={{this.minimumWithdrawalAmount}}
              type="text"
              value={{this.amount}}
              {{on "input" this.onAmountInput}}
            />
            <span>{{this.asset}}</span>
          </span>
          <span class="fiber-link-dashboard__quick-amounts" aria-label="Withdrawal amount shortcuts">
            <button type="button" data-quick-amount="0.25" {{on "click" this.setQuickAmount}}>25%</button>
            <button type="button" data-quick-amount="0.5" {{on "click" this.setQuickAmount}}>50%</button>
            <button type="button" data-quick-amount="0.75" {{on "click" this.setQuickAmount}}>75%</button>
            <button type="button" data-quick-amount="max" {{on "click" this.setQuickAmount}}>Max · {{this.maxWithdrawalAmountLabel}}</button>
          </span>
          {{#if this.amountErrorMessage}}
            <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
          {{/if}}
        </label>

        <div class="fiber-link-tip-field">
          <span class="fiber-link-dashboard__field-row">
            <span class="fiber-link-tip-label">Destination Address</span>
            <button
              class="fiber-link-dashboard__paste-button"
              type="button"
              {{on "click" this.pasteDestination}}
            >
              Paste
            </button>
          </span>
          <input
            class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input is-address"
            aria-label="Destination Address"
            data-fiber-link-withdrawal-input="address"
              id="fiber-link-withdrawal-address"
              name="fiber-link-withdrawal-address"
            placeholder="ckb1q..."
            spellcheck="false"
            type="text"
            value={{this.destinationAddress}}
            {{on "input" this.onAddressInput}}
          />

          {{#if this.addressValidationMessage}}
            <p class={{this.addressValidationClass}}>{{this.addressValidationMessage}}</p>
          {{/if}}
        </div>

        {{#if this.quoteErrorMessage}}
          <p class="fiber-link-tip-input-error">{{this.quoteErrorMessage}}</p>
        {{/if}}
      </div>

      <div class="fiber-link-dashboard__withdrawal-actions">
        <DButton
          class="btn-primary fiber-link-dashboard__withdrawal-submit"
          data-fiber-link-withdrawal-action="submit"
          @action={{this.submit}}
          @disabled={{this.isSubmitDisabled}}
          @translatedLabel={{this.submitLabel}}
        />
        {{#if this.submitDisabledReason}}
          <p
            class="fiber-link-dashboard__withdrawal-disabled-reason"
            data-fiber-link-withdrawal-disabled-reason
          >
            {{this.submitDisabledReason}}
          </p>
        {{/if}}
        {{#if this.requestedId}}
          <p class="fiber-link-dashboard__withdrawal-meta">
            Latest request:
            <code data-fiber-link-withdrawal-result="id">{{this.requestedId}}</code>
          </p>
        {{/if}}
      </div>
    </section>
  </template>
}
