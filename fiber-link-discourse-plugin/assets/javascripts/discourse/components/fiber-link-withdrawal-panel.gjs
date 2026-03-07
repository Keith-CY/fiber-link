import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { tracked } from "@glimmer/tracking";
import DButton from "discourse/components/d-button";

import { requestWithdrawal } from "../services/fiber-link-api";

const MIN_WITHDRAW_AMOUNT = 61;
const ADDRESS_PATTERN = /^(?:ckt|ckb)1[0-9a-zA-Z]+$/;

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
  @tracked toAddress = "";
  @tracked isSubmitting = false;
  @tracked errorMessage = null;
  @tracked successMessage = null;
  @tracked requestedId = null;
  @tracked requestedState = null;

  get amountErrorMessage() {
    const value = normalizeValue(this.amount);
    if (!value) {
      return "Enter an amount in CKB.";
    }

    if (!/^\d+$/.test(value)) {
      return "Amount must be a whole number.";
    }

    if (Number(value) < MIN_WITHDRAW_AMOUNT) {
      return `Amount must be at least ${MIN_WITHDRAW_AMOUNT} CKB.`;
    }

    return null;
  }

  get addressErrorMessage() {
    const value = normalizeValue(this.toAddress);
    if (!value) {
      return "Enter a CKB withdrawal address.";
    }

    if (!ADDRESS_PATTERN.test(value)) {
      return "Address must start with ckt1 or ckb1.";
    }

    return null;
  }

  get isSubmitDisabled() {
    return this.isSubmitting || !!this.amountErrorMessage || !!this.addressErrorMessage;
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

  @action
  onAmountInput(event) {
    this.amount = event?.target?.value ?? "";
    this.errorMessage = null;
  }

  @action
  onAddressInput(event) {
    this.toAddress = event?.target?.value ?? "";
    this.errorMessage = null;
  }

  @action
  async submit() {
    if (this.isSubmitDisabled) {
      this.errorMessage = this.amountErrorMessage || this.addressErrorMessage;
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;
    this.successMessage = null;

    try {
      const result = await requestWithdrawal({
        amount: normalizeValue(this.amount),
        asset: "CKB",
        toAddress: normalizeValue(this.toAddress),
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
          <h3>Withdraw Balance</h3>
          <p>Send your available CKB balance to a testnet or mainnet address.</p>
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

      <div class="fiber-link-dashboard__withdrawal-form">
        <label class="fiber-link-tip-field">
          <span class="fiber-link-tip-label">Amount (CKB)</span>
          <input
            class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input"
            data-fiber-link-withdrawal-input="amount"
            inputmode="numeric"
            min={{this.minimumWithdrawalAmount}}
            type="number"
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
            placeholder="ckt1..."
            spellcheck="false"
            type="text"
            value={{this.toAddress}}
            {{on "input" this.onAddressInput}}
          />
          {{#if this.addressErrorMessage}}
            <p class="fiber-link-tip-input-error">{{this.addressErrorMessage}}</p>
          {{/if}}
        </label>
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
