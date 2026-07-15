import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { i18n } from "discourse-i18n";
import { getDashboardAnalytics } from "../services/fiber-link-api";

const eq = (a, b) => a === b;
const inc = (n) => n + 1;


function formatAmount(amount) {
  const n = parseFloat(amount ?? "0");
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default class FiberLinkAnalytics extends Component {
  @tracked range = "30d";
  @tracked data = null;
  @tracked isLoading = false;
  @tracked errorMessage = null;

  get ranges() {
    return [
      { value: "7d", label: i18n("fiber_link.analytics.range_7d") },
      { value: "30d", label: i18n("fiber_link.analytics.range_30d") },
      { value: "all", label: i18n("fiber_link.analytics.range_all") },
    ];
  }

  get hasData() {
    return (
      this.data &&
      (this.data.timeSeries?.length > 0 ||
        this.data.topPosts?.length > 0 ||
        this.data.topTippers?.length > 0)
    );
  }

  get maxTimeSeriesAmount() {
    if (!this.data?.timeSeries?.length) return 1;
    return Math.max(...this.data.timeSeries.map((d) => parseFloat(d.amount ?? "0")), 1);
  }

  barWidth(amount) {
    const pct = (parseFloat(amount ?? "0") / this.maxTimeSeriesAmount) * 100;
    return `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
  }

  constructor(owner, args) {
    super(owner, args);
    this.loadAnalytics();
  }

  @action
  async onRangeChange(event) {
    this.range = event.target.value;
    await this.loadAnalytics();
  }

  @action
  async loadAnalytics() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = null;
    try {
      this.data = await getDashboardAnalytics({ range: this.range });
    } catch (e) {
      this.errorMessage = e?.message || i18n("fiber_link.analytics.load_failed");
    } finally {
      this.isLoading = false;
    }
  }

  <template>
    <section class="fiber-link-analytics" data-fiber-link-analytics>
      <div class="fiber-link-analytics__header">
        <h3 class="fiber-link-analytics__title">{{i18n "fiber_link.analytics.title"}}</h3>
        <select
          class="fiber-link-analytics__range"
          aria-label={{i18n "fiber_link.analytics.range_aria_label"}}
          {{on "change" this.onRangeChange}}
        >
          {{#each this.ranges as |r|}}
            <option value={{r.value}} selected={{eq r.value this.range}}>{{r.label}}</option>
          {{/each}}
        </select>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
      {{/if}}

      {{#if this.isLoading}}
        <p class="fiber-link-analytics__loading">{{i18n "fiber_link.analytics.loading"}}</p>
      {{else if this.hasData}}

        {{#if this.data.timeSeries.length}}
          <div class="fiber-link-analytics__chart" aria-label={{i18n "fiber_link.analytics.chart_aria_label"}}>
            {{#each this.data.timeSeries as |row|}}
              <div class="fiber-link-analytics__bar-row" title="{{row.date}}: {{row.amount}} CKB">
                <span class="fiber-link-analytics__bar-label">{{row.date}}</span>
                <span class="fiber-link-analytics__bar-track">
                  <span
                    class="fiber-link-analytics__bar-fill"
                    style="width: {{this.barWidth row.amount}}"
                    aria-hidden="true"
                  ></span>
                </span>
                <span class="fiber-link-analytics__bar-value">{{formatAmount row.amount}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}

        <div class="fiber-link-analytics__tables">
          {{#if this.data.topPosts.length}}
            <div class="fiber-link-analytics__table-section">
              <h4>{{i18n "fiber_link.analytics.top_posts"}}</h4>
              <table class="fiber-link-analytics__table">
                <thead>
                  <tr><th>#</th><th>{{i18n "fiber_link.analytics.table_post"}}</th><th>{{i18n "fiber_link.analytics.table_tips"}}</th><th>{{i18n "fiber_link.analytics.table_total_ckb"}}</th></tr>
                </thead>
                <tbody>
                  {{#each this.data.topPosts as |post i|}}
                    <tr>
                      <td>{{inc i}}</td>
                      <td>
                        {{! /p/:postId is Discourse's short-link route: it resolves the
                            exact post and scrolls to it, and works for legacy rows with
                            no topicId. The API still returns topicId for consumers. }}
                        <a href="/p/{{post.postId}}" target="_blank" rel="noopener noreferrer">
                          {{i18n "fiber_link.analytics.post_link" id=post.postId}}
                        </a>
                      </td>
                      <td>{{post.tipCount}}</td>
                      <td>{{formatAmount post.totalAmount}}</td>
                    </tr>
                  {{/each}}
                </tbody>
              </table>
            </div>
          {{/if}}

          {{#if this.data.topTippers.length}}
            <div class="fiber-link-analytics__table-section">
              <h4>{{i18n "fiber_link.analytics.top_supporters"}}</h4>
              <table class="fiber-link-analytics__table">
                <thead>
                  <tr><th>#</th><th>{{i18n "fiber_link.analytics.table_supporter"}}</th><th>{{i18n "fiber_link.analytics.table_tips"}}</th><th>{{i18n "fiber_link.analytics.table_total_ckb"}}</th></tr>
                </thead>
                <tbody>
                  {{#each this.data.topTippers as |tipper i|}}
                    <tr>
                      <td>{{inc i}}</td>
                      {{! The Discourse proxy enriches rows with local usernames; fall back to the raw id. }}
                      <td>{{if tipper.username tipper.username tipper.userId}}</td>
                      <td>{{tipper.tipCount}}</td>
                      <td>{{formatAmount tipper.totalAmount}}</td>
                    </tr>
                  {{/each}}
                </tbody>
              </table>
            </div>
          {{/if}}
        </div>

      {{else}}
        <p class="fiber-link-analytics__empty">{{i18n "fiber_link.analytics.empty"}}</p>
      {{/if}}
    </section>
  </template>
}
