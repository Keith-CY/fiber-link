import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
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
  @tracked amount = "61";
  @tracked destinationAddress = "";
  @tracked isSubmitting = false;
  @tracked isQuoteLoading = false;
  @tracked errorMessage = null;
  @tracked successMessage = null;
  @tracked quoteErrorMessage = null;
  @tracked quote = null;
  @tracked requestedId = null;
  @tracked requestedState = null;

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

  get networkFee() {
    return normalizeValue(this.quote?.networkFee) || "0";
  }

  get receiveAmount() {
    return normalizeValue(this.quote?.receiveAmount) || normalizeValue(this.amount) || "0";
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

    return null;
  }

  get addressErrorMessage() {
    const value = normalizeValue(this.destinationAddress);
    if (!value) {
      return "Enter a CKB withdrawal address.";
    }

    if (!ADDRESS_PATTERN.test(value)) {
      return "Address must start with ckt1 or ckb1.";
    }

    return null;
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
    if (this.addressErrorMessage) {
      return this.addressErrorMessage;
    }

    if (this.quote?.destinationValid) {
      return "Address valid";
    }

    return normalizeValue(this.quote?.validationMessage) || null;
  }

  get addressValidationClass() {
    if (this.addressErrorMessage || this.quote?.destinationValid === false) {
      return "fiber-link-dashboard__withdrawal-validation is-error";
    }
    if (this.quote?.destinationValid) {
      return "fiber-link-dashboard__withdrawal-validation is-success";
    }
    return "fiber-link-dashboard__withdrawal-validation";
  }

  get isSubmitDisabled() {
    return (
      this.isSubmitting ||
      this.isQuoteLoading ||
      !!this.amountErrorMessage ||
      !!this.addressErrorMessage ||
      this.quote?.destinationValid === false
    );
  }

  get submitLabel() {
    return this.isSubmitting ? "Requesting..." : "Request Withdrawal";
  }

  get minimumWithdrawalAmount() {
    return MIN_WITHDRAW_AMOUNT;
  }

  get requestedResultPresentation() {
    return getWithdrawalResultPresentation(this.requestedState);
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
    this._scheduleQuoteRefresh();
  }

  @action
  onAddressInput(event) {
    this.destinationAddress = event?.target?.value ?? "";
    this.errorMessage = null;
    this._scheduleQuoteRefresh();
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
      this.quoteErrorMessage = error?.message ?? "Failed to calculate withdrawal quote.";
    } finally {
      this.isQuoteLoading = false;
    }
  }

  @action
  async submit() {
    if (this.isSubmitDisabled || !this.destination) {
      this.errorMessage = this.amountErrorMessage || this.addressErrorMessage || this.quoteErrorMessage;
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;
    this.successMessage = null;

    try {
      const result = await requestWithdrawal({
        amount: normalizeValue(this.amount),
        asset: this.asset,
        destination: this.destination,
      });

      this.requestedId = result?.id ?? null;
      this.requestedState = result?.state ?? null;
      this.successMessage = this.requestedId
        ? `Requested withdrawal ${this.requestedId}`
        : "Withdrawal request submitted.";

      if (typeof this.args.onRequested === "function") {
        this.args.onRequested(result);
      }
    } catch (error) {
      this.errorMessage = error?.message ?? "Failed to request withdrawal.";
    } finally {
      this.isSubmitting = false;
    }
  }

  <template>
    <section class="fiber-link-dashboard__withdrawal">
      <div class="fiber-link-dashboard__withdrawal-header">
        <div>
          <h3>Withdraw</h3>
          <p>Move your settled CKB balance to a wallet you control.</p>
        </div>
        <div class="fiber-link-dashboard__withdrawal-badge">
          <span>Minimum</span>
          <strong>{{this.minimumWithdrawalAmount}} CKB</strong>
        </div>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error" data-fiber-link-withdrawal-result="error">
          {{this.errorMessage}}
        </p>
      {{/if}}

      {{#if this.successMessage}}
        <div
          class={{this.requestedResultPresentation.alertClass}}
          data-fiber-link-withdrawal-result="success"
        >
          <p class="fiber-link-dashboard__withdrawal-success">{{this.successMessage}}</p>
          {{#if this.requestedResultPresentation.detail}}
            <p class="fiber-link-dashboard__withdrawal-note">
              {{this.requestedResultPresentation.detail}}
            </p>
          {{/if}}
          {{#if this.requestedState}}
            <span
              class={{this.requestedResultPresentation.badgeClass}}
              data-fiber-link-withdrawal-result="state"
            >
              {{this.requestedResultPresentation.badgeLabel}}
            </span>
          {{/if}}
        </div>
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
        <div class="fiber-link-dashboard__withdrawal-summary-item">
          <span>Network fee</span>
          <strong>{{this.networkFee}} CKB</strong>
        </div>
        <div class="fiber-link-dashboard__withdrawal-summary-item is-highlighted">
          <span>You receive</span>
          <strong>{{this.receiveAmount}} {{this.asset}}</strong>
        </div>
      </div>

      <div class="fiber-link-dashboard__withdrawal-form">
        <label class="fiber-link-tip-field">
          <span class="fiber-link-tip-label">Amount</span>
          <input
            class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input"
            data-fiber-link-withdrawal-input="amount"
            inputmode="decimal"
            min={{this.minimumWithdrawalAmount}}
            type="text"
            value={{this.amount}}
            {{on "input" this.onAmountInput}}
          />
          {{#if this.amountErrorMessage}}
            <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
          {{/if}}
        </label>

        <label class="fiber-link-tip-field">
          <span class="fiber-link-tip-label">Destination Address</span>
          <input
            class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input is-address"
            data-fiber-link-withdrawal-input="address"
            placeholder="paste address"
            spellcheck="false"
            type="text"
            value={{this.destinationAddress}}
            {{on "input" this.onAddressInput}}
          />
        </label>

        {{#if this.addressValidationMessage}}
          <p class={{this.addressValidationClass}}>{{this.addressValidationMessage}}</p>
        {{/if}}

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
          @icon="arrow-up-right-from-square"
        />
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
