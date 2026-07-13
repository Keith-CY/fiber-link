import Component from "@glimmer/component";
import { action } from "@ember/object";
import { registerDestructor } from "@ember/destroyable";
import { on } from "@ember/modifier";
import { tracked } from "@glimmer/tracking";
import formatDate from "discourse/helpers/format-date";
import { i18n } from "discourse-i18n";

const RELATIVE_TIME_TICK_MS = 1000;

function formatCompactRelativeTime(rawValue) {
  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / 1000),
  );
  if (ageSeconds < 2) {
    return i18n("fiber_link.feed.rel_now");
  }
  if (ageSeconds < 60) {
    return i18n("fiber_link.feed.rel_seconds", { n: ageSeconds });
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) {
    return i18n("fiber_link.feed.rel_minutes", { n: ageMinutes });
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return i18n("fiber_link.feed.rel_hours", { n: ageHours });
  }

  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 7) {
    return i18n("fiber_link.feed.rel_days", { n: ageDays });
  }

  const ageWeeks = Math.floor(ageDays / 7);
  return i18n("fiber_link.feed.rel_weeks", { n: ageWeeks });
}

export default class FiberLinkTipFeed extends Component {
  @tracked activeFilter = "all";
  @tracked searchQuery = "";
  @tracked selectedTipId = null;
  @tracked relativeTimeTick = 0;

  _relativeTimeTimer = null;

  constructor(owner, args) {
    super(owner, args);
    this._relativeTimeTimer = setInterval(() => {
      this.relativeTimeTick += 1;
    }, RELATIVE_TIME_TICK_MS);
    registerDestructor(this, () => {
      clearInterval(this._relativeTimeTimer);
      this._relativeTimeTimer = null;
    });
  }

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
    const ticks = this.relativeTimeTick;
    const tips = Array.isArray(this.args.tips) ? this.args.tips : [];
    void ticks;

    return tips.map((tip) => ({
      ...tip,
      relativeTimeLabel: formatCompactRelativeTime(tip.createdAt),
    }));
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
    return i18n("fiber_link.feed.result_summary", { shown: count, total: this.tips.length });
  }

  countForFilter(value) {
    if (value === "all") {
      return this.tips.length;
    }

    return this.tips.filter((tip) => tip.directionKey === value || tip.statusKey === value).length;
  }

  get filterOptions() {
    return [
      { value: "all", label: i18n("fiber_link.feed.filter_all") },
      { value: "received", label: i18n("fiber_link.feed.filter_received") },
      { value: "withdrawn", label: i18n("fiber_link.feed.filter_withdrawals") },
      { value: "pending", label: i18n("fiber_link.feed.filter_pending") },
      { value: "failed", label: i18n("fiber_link.feed.filter_failed") },
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
      <p class="fiber-link-tip-feed-loading">{{i18n "fiber_link.feed.loading"}}</p>
    {{else}}
      {{#if this.errorMessage}}
        <p class="fiber-link-tip-feed-error">{{i18n "fiber_link.feed.load_failed" message=this.errorMessage}}</p>
      {{else}}
        {{#if this.isEmpty}}
          <p class="fiber-link-tip-feed-empty">
            {{i18n "fiber_link.feed.empty"}}
          </p>
        {{else}}
          <div class="fiber-link-tip-feed-header">
            <div>
              <div class="fiber-link-dashboard__section-kicker">
                <strong>02</strong>
                <span>{{i18n "fiber_link.feed.kicker"}}</span>
              </div>
              <h3>{{i18n "fiber_link.feed.title_lead"}} <span>{{i18n "fiber_link.feed.title_emphasis"}}</span></h3>
              <p>
                {{i18n "fiber_link.feed.description"}}
              </p>
            </div>
          </div>

          <div class="fiber-link-filter-group" aria-label={{i18n "fiber_link.feed.filters_aria"}}>
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
                <th>{{i18n "fiber_link.feed.th_amount"}}</th>
                <th>{{i18n "fiber_link.feed.th_type"}}</th>
                <th>{{i18n "fiber_link.feed.th_status"}}</th>
                <th>{{i18n "fiber_link.feed.th_user"}}</th>
                <th>{{i18n "fiber_link.feed.th_time"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.filteredTips key="id" as |tip|}}
                <tr
                  class="fiber-link-tip-feed-row"
                  data-tip-id={{tip.id}}
                  role="button"
                  tabindex="0"
                  aria-label={{i18n "fiber_link.feed.row_aria"}}
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
                  aria-label={{i18n "fiber_link.feed.close_aria"}}
                  {{on "click" this.closeDetails}}
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                    <path d="M6 6l12 12M18 6 6 18"></path>
                  </svg>
                </button>
              </div>

              <div class="fiber-link-transaction-dialog__hero">
                <h4 id="fiber-link-transaction-dialog-title">{{this.selectedTip.detailTitle}}</h4>
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
                    <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_record_id"}}</div>
                    <div class="fiber-link-transaction-dialog__value is-mono">
                      <span>{{this.selectedTip.id}}</span>
                      <button
                        type="button"
                        class="fiber-link-transaction-dialog__copy"
                        aria-label={{i18n "fiber_link.feed.copy_record_id"}}
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
                    <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_activity"}}</div>
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
                    <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_user"}}</div>
                    <div class="fiber-link-transaction-dialog__value">
                      <div class="fiber-link-transaction-dialog__avatar-line">
                        <span class="fiber-link-transaction-dialog__avatar">{{this.selectedTip.avatarInitials}}</span>
                        <span class="fiber-link-transaction-dialog__username">@{{this.selectedTip.counterpartyUsername}}</span>
                      </div>
                    </div>
                  </div>
                  <div class="fiber-link-transaction-dialog__cell">
                    <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_time"}}</div>
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
                      <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_destination"}}</div>
                      <div class="fiber-link-transaction-dialog__value is-mono">
                        <span>{{this.selectedTip.destination}}</span>
                        <button
                          type="button"
                          class="fiber-link-transaction-dialog__copy"
                          aria-label={{i18n "fiber_link.feed.copy_destination"}}
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
                      <div class="fiber-link-transaction-dialog__label">{{i18n "fiber_link.feed.label_ckb_tx"}}</div>
                      <div class="fiber-link-transaction-dialog__value is-mono">
                        <span>{{this.selectedTip.txHash}}</span>
                        <button
                          type="button"
                          class="fiber-link-transaction-dialog__copy"
                          aria-label={{i18n "fiber_link.feed.copy_ckb_tx"}}
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
                {{#if this.selectedTip.detailActionUrl}}
                  <a
                    class="fiber-link-transaction-dialog__explorer-link"
                    href={{this.selectedTip.detailActionUrl}}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{this.selectedTip.detailActionLabel}} <span class="fiber-link-transaction-dialog__arrow">↗</span>
                  </a>
                {{else}}
                  <button
                    type="button"
                    class="fiber-link-transaction-dialog__explorer-link is-disabled"
                    disabled
                  >
                    {{this.selectedTip.detailActionUnavailableLabel}} <span class="fiber-link-transaction-dialog__arrow">↗</span>
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
