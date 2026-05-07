import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { tracked } from "@glimmer/tracking";
import formatDate from "discourse/helpers/format-date";

export default class FiberLinkTipFeed extends Component {
  @tracked activeFilter = "all";
  @tracked searchQuery = "";
  @tracked selectedTipId = null;

  get isLoading() {
    return Boolean(this.args.isLoading);
  }

  get errorMessage() {
    if (typeof this.args.errorMessage !== "string") {
      return null;
    }
    const value = this.args.errorMessage.trim();
    return value ? value : null;
  }

  get tips() {
    return Array.isArray(this.args.tips) ? this.args.tips : [];
  }

  get isEmpty() {
    return !this.isLoading && !this.errorMessage && this.tips.length === 0;
  }

  get filteredTips() {
    const query = this.searchQuery.trim().toLowerCase();

    return this.tips.filter((tip) => {
      const matchesFilter = this.activeFilter === "all" || tip.directionKey === this.activeFilter || tip.statusKey === this.activeFilter;
      if (!matchesFilter || !query) {
        return matchesFilter;
      }

      return [
        tip.amount,
        tip.asset,
        tip.statusLabel,
        tip.directionLabel,
        tip.counterpartyUsername,
        tip.message,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }

  get resultSummary() {
    const count = this.filteredTips.length;
    return `Showing ${count} of ${this.tips.length} transactions · Last 30 days`;
  }

  countForFilter(value) {
    if (value === "all") {
      return this.tips.length;
    }

    return this.tips.filter((tip) => tip.directionKey === value || tip.statusKey === value).length;
  }

  get filterOptions() {
    return [
      { value: "all", label: "All" },
      { value: "received", label: "Received" },
      { value: "withdrawn", label: "Withdrawals" },
      { value: "pending", label: "Pending" },
      { value: "failed", label: "Failed" },
    ].map((option) => ({
      ...option,
      className: option.value === this.activeFilter ? "fiber-link-filter-chip is-active" : "fiber-link-filter-chip",
      count: this.countForFilter(option.value),
    }));
  }

  @action
  setFilter(event) {
    const value = event?.target?.value || event?.currentTarget?.dataset?.filter || "all";
    this.activeFilter = value;
  }

  @action
  onSearchInput(event) {
    this.searchQuery = event?.target?.value ?? "";
  }

  get selectedTip() {
    if (!this.selectedTipId) {
      return null;
    }

    return this.tips.find((tip) => tip.id === this.selectedTipId) ?? null;
  }

  @action
  openDetails(event) {
    const tipId = event?.currentTarget?.dataset?.tipId;
    if (!tipId) {
      return;
    }
    this.selectedTipId = tipId;
  }

  @action
  openDetailsFromKeyboard(event) {
    if (event?.key !== "Enter" && event?.key !== " ") {
      return;
    }
    event.preventDefault();
    this.openDetails(event);
  }

  @action
  closeDetails() {
    this.selectedTipId = null;
  }

  @action
  copyValue(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const value = event?.currentTarget?.dataset?.copyValue;
    if (typeof navigator === "undefined" || !value || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard.writeText(value);
  }

  <template>
    {{#if this.isLoading}}
      <p class="fiber-link-tip-feed-loading">Loading payments...</p>
    {{else}}
      {{#if this.errorMessage}}
        <p class="fiber-link-tip-feed-error">Failed to load payments: {{this.errorMessage}}</p>
      {{else}}
        {{#if this.isEmpty}}
          <p class="fiber-link-tip-feed-empty">
            You don’t have payments yet.
          </p>
        {{else}}
          <div class="fiber-link-tip-feed-header">
            <div>
              <div class="fiber-link-dashboard__section-kicker">
                <strong>02</strong>
                <span>RECENT ACTIVITY</span>
              </div>
              <h3>All <span>transactions.</span></h3>
              <p>
                Settlement history across Discourse — received tips and
                withdrawals that affect your creator balance.
              </p>
            </div>
          </div>

          <div class="fiber-link-filter-group" aria-label="Activity filters">
            {{#each this.filterOptions as |option|}}
              <button
                type="button"
                class={{option.className}}
                data-filter={{option.value}}
                {{on "click" this.setFilter}}
              >
                <span>{{option.label}}</span>
                <strong>{{option.count}}</strong>
              </button>
            {{/each}}
          </div>

          <table class="fiber-link-tip-feed-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Type</th>
                <th>Status</th>
                <th>User</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.filteredTips key="id" as |tip|}}
                <tr
                  class="fiber-link-tip-feed-row"
                  data-tip-id={{tip.id}}
                  role="button"
                  tabindex="0"
                  aria-label="Open transaction details"
                  {{on "click" this.openDetails}}
                  {{on "keydown" this.openDetailsFromKeyboard}}
                >
                  <td>
                    <p class={{tip.amountClassName}}>
                      <strong>{{tip.amountPrefix}} {{tip.amount}}</strong>
                      <span>{{tip.asset}}</span>
                    </p>
                  </td>
                  <td>
                    <span class="fiber-link-tip-feed-type">
                      <span class={{tip.directionClassName}} title={{tip.directionLabel}} aria-label={{tip.directionLabel}}>
                        {{tip.directionIcon}}
                      </span>
                      <span>{{tip.directionLabel}}</span>
                    </span>
                  </td>
                  <td>
                    <span class="fiber-link-tip-feed-status">
                      <span class={{tip.statusDotClassName}} aria-hidden="true"></span>
                      <span class={{tip.statusTextClassName}}>{{tip.statusLabel}}</span>
                    </span>
                  </td>
                  <td>
                    <span class="fiber-link-tip-feed-user">
                      <span class="fiber-link-tip-feed-avatar" aria-hidden="true">{{tip.avatarInitials}}</span>
                      <span>
                        <strong>@{{tip.counterpartyUsername}}</strong>
                        {{#if tip.message}}
                          <p class="fiber-link-tip-feed-message">{{tip.message}}</p>
                        {{/if}}
                      </span>
                    </span>
                  </td>
                  <td title={{tip.absoluteTimeLabel}}>{{formatDate tip.createdAt}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>

          {{#if this.selectedTip}}
            <div
              class="fiber-link-transaction-dialog-backdrop"
              role="presentation"
              {{on "click" this.closeDetails}}
            ></div>
            <section
              class="fiber-link-transaction-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fiber-link-transaction-dialog-title"
            >
              <div class="fiber-link-transaction-dialog__head">
                <span class={{this.selectedTip.transactionTagClassName}}>
                  <span class="fiber-link-transaction-dialog__tag-dot"></span>
                  {{this.selectedTip.directionLabel}}
                </span>
                <button
                  type="button"
                  class="fiber-link-transaction-dialog__close"
                  aria-label="Close transaction details"
                  {{on "click" this.closeDetails}}
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                    <path d="M6 6l12 12M18 6 6 18"></path>
                  </svg>
                </button>
              </div>

              <div class="fiber-link-transaction-dialog__hero">
                <h4 id="fiber-link-transaction-dialog-title">Transaction details</h4>
                <div class="fiber-link-transaction-dialog__summary">
                  <span class={{this.selectedTip.transactionSummaryStatusClassName}}>
                    {{this.selectedTip.statusLabel}}
                  </span>
                  <span class="fiber-link-transaction-dialog__summary-sep">·</span>
                  <span class={{this.selectedTip.transactionAmountClassName}}>
                    {{this.selectedTip.amountPrefix}} {{this.selectedTip.amount}} {{this.selectedTip.asset}}
                  </span>
                  <span class="fiber-link-transaction-dialog__summary-sep">·</span>
                  <span>{{this.selectedTip.relativeTimeLabel}}</span>
                </div>
              </div>

              <div class="fiber-link-transaction-dialog__rail">
                <div class="fiber-link-transaction-dialog__row">
                  <div class="fiber-link-transaction-dialog__cell">
                    <div class="fiber-link-transaction-dialog__label">Record ID</div>
                    <div class="fiber-link-transaction-dialog__value is-mono">
                      <span>{{this.selectedTip.id}}</span>
                      <button
                        type="button"
                        class="fiber-link-transaction-dialog__copy"
                        aria-label="Copy record ID"
                        data-copy-value={{this.selectedTip.id}}
                        {{on "click" this.copyValue}}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <rect x="9" y="9" width="11" height="11" rx="1.5"></rect>
                          <path d="M5 15V5a1 1 0 0 1 1-1h10"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="fiber-link-transaction-dialog__cell">
                    <div class="fiber-link-transaction-dialog__label">Activity</div>
                    <div class={{this.selectedTip.transactionActivityClassName}}>
                      <span class="fiber-link-transaction-dialog__activity-dot"></span>
                      <span>{{this.selectedTip.directionLabel}}</span>
                      <span class="fiber-link-transaction-dialog__activity-sep">·</span>
                      <span class="fiber-link-transaction-dialog__activity-state">{{this.selectedTip.statusLabel}}</span>
                    </div>
                  </div>
                </div>

                <div class="fiber-link-transaction-dialog__row">
                  <div class="fiber-link-transaction-dialog__cell">
                    <div class="fiber-link-transaction-dialog__label">User</div>
                    <div class="fiber-link-transaction-dialog__value">
                      <div class="fiber-link-transaction-dialog__avatar-line">
                        <span class="fiber-link-transaction-dialog__avatar">{{this.selectedTip.avatarInitials}}</span>
                        <span class="fiber-link-transaction-dialog__username">@{{this.selectedTip.counterpartyUsername}}</span>
                      </div>
                    </div>
                  </div>
                  <div class="fiber-link-transaction-dialog__cell">
                    <div class="fiber-link-transaction-dialog__label">Time</div>
                    <div class="fiber-link-transaction-dialog__value">
                      <span>{{this.selectedTip.relativeTimeLabel}}</span>
                      {{#if this.selectedTip.shortTimeLabel}}
                        <span class="fiber-link-transaction-dialog__time-absolute">{{this.selectedTip.shortTimeLabel}}</span>
                      {{/if}}
                    </div>
                  </div>
                </div>

                {{#if this.selectedTip.destination}}
                  <div class="fiber-link-transaction-dialog__row">
                    <div class="fiber-link-transaction-dialog__cell is-full">
                      <div class="fiber-link-transaction-dialog__label">Destination</div>
                      <div class="fiber-link-transaction-dialog__value is-mono">
                        <span>{{this.selectedTip.destination}}</span>
                        <button
                          type="button"
                          class="fiber-link-transaction-dialog__copy"
                          aria-label="Copy destination"
                          data-copy-value={{this.selectedTip.destination}}
                          {{on "click" this.copyValue}}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="9" y="9" width="11" height="11" rx="1.5"></rect>
                            <path d="M5 15V5a1 1 0 0 1 1-1h10"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                {{/if}}

                {{#if this.selectedTip.txHash}}
                  <div class="fiber-link-transaction-dialog__row">
                    <div class="fiber-link-transaction-dialog__cell is-full">
                      <div class="fiber-link-transaction-dialog__label">CKB transaction</div>
                      <div class="fiber-link-transaction-dialog__value is-mono">
                        <span>{{this.selectedTip.txHash}}</span>
                        <button
                          type="button"
                          class="fiber-link-transaction-dialog__copy"
                          aria-label="Copy CKB transaction"
                          data-copy-value={{this.selectedTip.txHash}}
                          {{on "click" this.copyValue}}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="9" y="9" width="11" height="11" rx="1.5"></rect>
                            <path d="M5 15V5a1 1 0 0 1 1-1h10"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                {{/if}}
              </div>

              <div class="fiber-link-transaction-dialog__actions">
                <div class={{this.selectedTip.transactionConfirmationClassName}}>
                  <span class="fiber-link-transaction-dialog__meta-mark"></span>
                  {{this.selectedTip.confirmationLabel}}
                </div>
                {{#if this.selectedTip.explorerUrl}}
                  <a
                    class="fiber-link-transaction-dialog__explorer-link"
                    href={{this.selectedTip.explorerUrl}}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in CKB Explorer <span class="fiber-link-transaction-dialog__arrow">↗</span>
                  </a>
                {{else}}
                  <button
                    type="button"
                    class="fiber-link-transaction-dialog__explorer-link is-disabled"
                    disabled
                  >
                    Open in CKB Explorer <span class="fiber-link-transaction-dialog__arrow">↗</span>
                  </button>
                {{/if}}
              </div>
            </section>
          {{/if}}

          <p class="fiber-link-tip-feed-summary">{{this.resultSummary}}</p>
        {{/if}}
      {{/if}}
    {{/if}}
  </template>
}
