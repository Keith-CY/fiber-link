import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { tracked } from "@glimmer/tracking";
import formatDate from "discourse/helpers/format-date";

export default class FiberLinkTipFeed extends Component {
  @tracked activeFilter = "all";

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
    return this.tips.filter((tip) => this.activeFilter === "all" || tip.directionKey === this.activeFilter);
  }

  get resultSummary() {
    const count = this.filteredTips.length;
    return `Showing ${count} of ${this.tips.length} transactions`;
  }

  get activeFilterLabel() {
    if (this.activeFilter === "received") {
      return "Received";
    }
    if (this.activeFilter === "sent") {
      return "Sent";
    }
    if (this.activeFilter === "withdrawn") {
      return "Withdrawn";
    }
    return "All Activity";
  }

  @action
  setFilter(event) {
    const value = event?.target?.value || event?.currentTarget?.dataset?.filter || "all";
    this.activeFilter = value;
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
          <div class="fiber-link-tip-feed-toolbar">
            <label class="fiber-link-filter-select-shell">
              <span class="fiber-link-filter-select-label">Filter</span>
              <span class="fiber-link-filter-select-wrap">
                <select
                  class="fiber-link-filter-select"
                  aria-label="Activity filter"
                  value={{this.activeFilter}}
                  {{on "change" this.setFilter}}
                >
                  <option value="all">All Activity</option>
                  <option value="received">Received</option>
                  <option value="sent">Sent</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
                <span class="fiber-link-filter-select-current" aria-hidden="true">{{this.activeFilterLabel}}</span>
                <span class="fiber-link-filter-select-chevron" aria-hidden="true">⌄</span>
              </span>
            </label>
          </div>
          <table class="fiber-link-tip-feed-table is-icon-first">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>User</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.filteredTips key="id" as |tip|}}
                <tr data-tip-id={{tip.id}}>
                  <td>
                    <span class={{tip.directionClassName}} title={{tip.directionLabel}} aria-label={{tip.directionLabel}}>
                      {{tip.directionIcon}}
                    </span>
                  </td>
                  <td>
                    <p class="fiber-link-tip-feed-primary">
                      <strong>{{tip.amount}} {{tip.asset}}</strong>
                    </p>
                    {{#if tip.message}}
                      <p class="fiber-link-tip-feed-message">{{tip.message}}</p>
                    {{/if}}
                  </td>
                  <td><span class={{tip.statusClassName}}>{{tip.statusLabel}}</span></td>
                  <td>@{{tip.counterpartyUsername}}</td>
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
