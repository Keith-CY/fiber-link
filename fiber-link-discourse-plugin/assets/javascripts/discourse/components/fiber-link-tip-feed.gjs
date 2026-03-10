import Component from "@glimmer/component";
import formatDate from "discourse/helpers/format-date";

export default class FiberLinkTipFeed extends Component {
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
          <table class="fiber-link-tip-feed-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Status</th>
                <th>User</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.tips key="id" as |tip|}}
                <tr data-tip-id={{tip.id}}>
                  <td>
                    <p class="fiber-link-tip-feed-primary">
                      <strong>{{tip.amount}} {{tip.asset}}</strong>
                    </p>
                    <p class="fiber-link-tip-feed-direction-row">
                      <span class="fiber-link-tip-feed-direction">{{tip.directionLabel}}</span>
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
        {{/if}}
      {{/if}}
    {{/if}}
  </template>
}
