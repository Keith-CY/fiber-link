import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DModalCancel from "discourse/components/d-modal-cancel";

import { createTip, getTipStatus } from "../../services/fiber-link-api";

function mapTipStateToLabel(state) {
  return state === "SETTLED" ? "Settled" : "Pending";
}

export default class FiberLinkTipModal extends Component {
  @tracked amount = "1";
  @tracked invoice;
  @tracked statusLabel;
  @tracked isGenerating = false;
  @tracked isChecking = false;
  @tracked errorMessage;

  get isCheckStatusDisabled() {
    return !this.invoice || this.isChecking;
  }

  @action
  onAmountInput(event) {
    this.amount = event?.target?.value ?? "";
  }

  @action
  async generateInvoice() {
    if (this.isGenerating) {
      return;
    }

    this.errorMessage = null;
    this.isGenerating = true;

    try {
      const postId = this.args?.model?.postId;
      if (!postId) {
        throw new Error("Missing post context");
      }

      const result = await createTip({
        amount: this.amount,
        asset: "CKB",
        postId,
      });

      this.invoice = result?.invoice;
      this.statusLabel = "Pending";
    } catch (e) {
      // Avoid showing stack traces in the modal.
      this.errorMessage = e?.message ?? "Failed to generate invoice";
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
    this.isChecking = true;

    try {
      const result = await getTipStatus({ invoice: this.invoice });
      this.statusLabel = mapTipStateToLabel(result?.state);
    } catch (e) {
      this.errorMessage = e?.message ?? "Failed to check status";
    } finally {
      this.isChecking = false;
    }
  }

  <template>
    <DModal @closeModal={{@closeModal}} @title="Pay with Fiber">
      <:body>
        {{#if this.errorMessage}}
          <p class="fiber-link-tip-error">{{this.errorMessage}}</p>
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
        </div>

        {{#if this.invoice}}
          <p class="fiber-link-tip-invoice">{{this.invoice}}</p>
          <p class="fiber-link-tip-status">{{this.statusLabel}}</p>
        {{/if}}
      </:body>

      <:footer>
        <DButton
          @action={{this.generateInvoice}}
          @translatedLabel="Generate Invoice"
          class="btn-primary"
          @disabled={{this.isGenerating}}
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
