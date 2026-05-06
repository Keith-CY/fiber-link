import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { tracked } from "@glimmer/tracking";
import formatDate from "discourse/helpers/format-date";

export default class FiberLinkTipFeed extends Component {
  @tracked activeFilter = "all";
  @tracked searchQuery = "";

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
      { value: "sent", label: "Sent" },
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
                Settlement history across Discourse — received tips, sent
                payments, and withdrawals.
              </p>
            </div>
            <label class="fiber-link-tip-feed-search">
              <svg
                class="fiber-link-tip-feed-search__icon"
                aria-hidden="true"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                aria-label="Search activity"
                placeholder="Search user..."
                type="search"
                value={{this.searchQuery}}
                {{on "input" this.onSearchInput}}
              />
            </label>
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
                <tr data-tip-id={{tip.id}}>
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
          <p class="fiber-link-tip-feed-summary">{{this.resultSummary}}</p>
        {{/if}}
      {{/if}}
    {{/if}}
  </template>
}
