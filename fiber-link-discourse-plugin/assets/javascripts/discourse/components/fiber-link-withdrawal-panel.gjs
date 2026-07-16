import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import DButton from "discourse/components/d-button";
import { i18n } from "discourse-i18n";

import { quoteWithdrawal, requestWithdrawal } from "../services/fiber-link-api";

const MIN_WITHDRAW_AMOUNT = 61;
const eq = (a, b) => a === b;
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
      badgeLabel: i18n("fiber_link.withdrawal.badge_liquidity_pending"),
      detail: i18n("fiber_link.withdrawal.detail_liquidity_pending"),
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
  @tracked selectedAsset = null;

  _quoteTimer = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this._clearQuoteTimer());
  }

  get asset() {
    return this.selectedAsset || this.args.asset || "CKB";
  }

  // Assets the creator actually holds; the selector only renders when there
  // is more than one, so single-asset creators keep the uncluttered form.
  get selectableAssets() {
    const balances = Array.isArray(this.args.assetBalances) ? this.args.assetBalances : [];
    return balances.map((entry) => entry.asset).filter(Boolean);
  }

  get showAssetSelector() {
    return this.selectableAssets.length > 1;
  }

  get selectedAssetBalances() {
    const balances = Array.isArray(this.args.assetBalances) ? this.args.assetBalances : [];
    return balances.find((entry) => entry.asset === this.asset) ?? null;
  }

  get isPrimaryAssetSelected() {
    return this.asset === (this.args.asset || "CKB");
  }

  get availableBalance() {
    // The scalar args balances describe the primary asset only; never let
    // them bleed into another asset's display while balances/quote load.
    return (
      normalizeValue(this.quote?.availableBalance) ||
      normalizeValue(this.selectedAssetBalances?.available) ||
      (this.isPrimaryAssetSelected ? normalizeValue(this.args.availableBalance) : "") ||
      "0"
    );
  }

  get lockedBalance() {
    return (
      normalizeValue(this.quote?.lockedBalance) ||
      normalizeValue(this.selectedAssetBalances?.locked) ||
      (this.isPrimaryAssetSelected ? normalizeValue(this.args.lockedBalance) : "") ||
      "0"
    );
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
      return i18n("fiber_link.withdrawal.error_amount_required");
    }

    if (!/^\d+(?:\.\d+)?$/.test(value)) {
      return i18n("fiber_link.withdrawal.error_amount_numeric");
    }

    if (this.minimumWithdrawalAmount > 0 && Number(value) < this.minimumWithdrawalAmount) {
      return i18n("fiber_link.withdrawal.error_amount_min", { min: this.minimumWithdrawalAmount });
    }

    if (Number(value) > this.availableBalanceNumber) {
      return i18n("fiber_link.withdrawal.error_amount_exceeds");
    }

    return null;
  }

  get addressErrorMessage() {
    const value = normalizeValue(this.destinationAddress);
    if (!value) {
      return i18n("fiber_link.withdrawal.error_address_invalid");
    }

    if (!ADDRESS_PATTERN.test(value)) {
      return i18n("fiber_link.withdrawal.error_address_invalid");
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
      return i18n("fiber_link.withdrawal.address_valid");
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
      return i18n("fiber_link.withdrawal.reason_submitting");
    }
    if (this.isQuoteLoading) {
      return i18n("fiber_link.withdrawal.reason_quoting");
    }
    if (this.amountErrorMessage) {
      return this.amountErrorMessage;
    }
    if (!this.destination) {
      return i18n("fiber_link.withdrawal.reason_no_destination");
    }
    if (this.addressErrorMessage) {
      return this.addressErrorMessage;
    }
    if (this.quote?.destinationValid === false) {
      return normalizeValue(this.quote?.validationMessage) || i18n("fiber_link.withdrawal.reason_destination_invalid");
    }
    if (this.quoteErrorMessage) {
      return this.quoteErrorMessage;
    }
    return i18n("fiber_link.withdrawal.reason_unavailable");
  }

  get submitLabel() {
    return this.isSubmitting
      ? i18n("fiber_link.withdrawal.submitting")
      : i18n("fiber_link.withdrawal.submit");
  }

  get minimumWithdrawalAmount() {
    const quoted = Number(this.quote?.minimumAmount);
    if (Number.isFinite(quoted) && quoted > 0) {
      return quoted;
    }
    // The 61 floor is the CKB minimal cell capacity; UDT assets have no
    // client-side floor until the server quotes one.
    return this.asset === "CKB" ? MIN_WITHDRAW_AMOUNT : 0;
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
      ? i18n("fiber_link.withdrawal.toast_requested", { id: this.requestedId })
      : i18n("fiber_link.withdrawal.toast_submitted");
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
  onAssetChange(event) {
    this.selectedAsset = event?.target?.value || "CKB";
    this.quote = null;
    this.errorMessage = null;
    this.quoteErrorMessage = null;
    this.hasSubmitted = false;
    this._scheduleQuoteRefresh();
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
      this.pasteErrorMessage = i18n("fiber_link.withdrawal.paste_failed");
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
      this.quoteErrorMessage = error?.message ?? i18n("fiber_link.withdrawal.quote_failed");
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
        i18n("fiber_link.withdrawal.error_address_invalid");
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
      this.errorMessage = error?.message ?? i18n("fiber_link.withdrawal.request_failed");
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
        <span>{{i18n "fiber_link.withdrawal.kicker"}}</span>
      </div>

      <div class="fiber-link-dashboard__withdrawal-heading">
        <h3>{{i18n "fiber_link.withdrawal.title_lead"}} <span>{{i18n "fiber_link.withdrawal.title_emphasis"}}</span> {{i18n "fiber_link.withdrawal.title_tail"}}</h3>
        <p>
          {{i18n "fiber_link.withdrawal.description" min=this.minimumWithdrawalAmount}}
        </p>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error" data-fiber-link-withdrawal-result="error">
          {{this.errorMessage}}
        </p>
      {{/if}}

      <div class="fiber-link-dashboard__withdrawal-summary-grid">
        <div class="fiber-link-dashboard__withdrawal-summary-item">
          <span>{{i18n "fiber_link.withdrawal.available"}}</span>
          <strong>{{this.availableBalance}} {{this.asset}}</strong>
        </div>
        <div class="fiber-link-dashboard__withdrawal-summary-item">
          <span>{{i18n "fiber_link.withdrawal.locked"}}</span>
          <strong>{{this.lockedBalance}} {{this.asset}}</strong>
        </div>
        <div class="fiber-link-dashboard__withdrawal-summary-item is-highlighted">
          <span>{{i18n "fiber_link.withdrawal.payout_amount"}}</span>
          <strong>{{this.receiveAmount}} {{this.asset}}</strong>
        </div>
      </div>

      <div class="fiber-link-dashboard__withdrawal-form">
        <label class="fiber-link-tip-field">
          {{#if this.showAssetSelector}}
            <span class="fiber-link-dashboard__field-row">
              <span class="fiber-link-tip-label">{{i18n "fiber_link.withdrawal.asset_label"}}</span>
              <select
                class="fiber-link-dashboard__withdrawal-asset"
                data-fiber-link-withdrawal-input="asset"
                aria-label={{i18n "fiber_link.withdrawal.asset_label"}}
                {{on "change" this.onAssetChange}}
              >
                {{#each this.selectableAssets as |assetOption|}}
                  <option value={{assetOption}} selected={{eq assetOption this.asset}}>{{assetOption}}</option>
                {{/each}}
              </select>
            </span>
          {{/if}}
          <span class="fiber-link-dashboard__field-row">
            <span class="fiber-link-tip-label">{{i18n "fiber_link.withdrawal.amount_label"}}</span>
            <span>{{i18n "fiber_link.withdrawal.network_fee" fee=this.networkFee asset=this.asset}}</span>
          </span>
          <span class="fiber-link-dashboard__amount-input-wrap">
            <input
              class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input is-amount"
              data-fiber-link-withdrawal-input="amount"
              inputmode="decimal"
              min={{this.minimumWithdrawalAmount}}
              type="text"
              value={{this.amount}}
              {{on "input" this.onAmountInput}}
            />
            <span>{{this.asset}}</span>
          </span>
          <span class="fiber-link-dashboard__quick-amounts" aria-label={{i18n "fiber_link.withdrawal.quick_amounts_aria"}}>
            <button type="button" data-quick-amount="0.25" {{on "click" this.setQuickAmount}}>25%</button>
            <button type="button" data-quick-amount="0.5" {{on "click" this.setQuickAmount}}>50%</button>
            <button type="button" data-quick-amount="0.75" {{on "click" this.setQuickAmount}}>75%</button>
            <button type="button" data-quick-amount="max" {{on "click" this.setQuickAmount}}>{{i18n "fiber_link.withdrawal.max_button" amount=this.maxWithdrawalAmountLabel}}</button>
          </span>
          {{#if this.amountErrorMessage}}
            <p class="fiber-link-tip-input-error">{{this.amountErrorMessage}}</p>
          {{/if}}
        </label>

        <div class="fiber-link-tip-field">
          <span class="fiber-link-dashboard__field-row">
            <span class="fiber-link-tip-label">{{i18n "fiber_link.withdrawal.destination_label"}}</span>
            <button
              class="fiber-link-dashboard__paste-button"
              type="button"
              {{on "click" this.pasteDestination}}
            >
              {{i18n "fiber_link.withdrawal.paste"}}
            </button>
          </span>
          <input
            class="fiber-link-tip-input fiber-link-dashboard__withdrawal-input is-address"
            aria-label={{i18n "fiber_link.withdrawal.destination_label"}}
            data-fiber-link-withdrawal-input="address"
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
            {{i18n "fiber_link.withdrawal.latest_request"}}
            <code data-fiber-link-withdrawal-result="id">{{this.requestedId}}</code>
          </p>
        {{/if}}
      </div>
    </section>
  </template>
}
