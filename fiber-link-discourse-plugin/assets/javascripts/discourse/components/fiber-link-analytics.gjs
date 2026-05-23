import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { getDashboardAnalytics } from "../services/fiber-link-api";

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

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
    return RANGES;
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
      this.errorMessage = e?.message || "Failed to load analytics.";
    } finally {
      this.isLoading = false;
    }
  }

  <template>
    <section class="fiber-link-analytics" data-fiber-link-analytics>
      <div class="fiber-link-analytics__header">
        <h3 class="fiber-link-analytics__title">Analytics</h3>
        <select
          class="fiber-link-analytics__range"
          aria-label="Date range"
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
        <p class="fiber-link-analytics__loading">Loading analytics…</p>
      {{else if this.hasData}}

        {{#if this.data.timeSeries.length}}
          <div class="fiber-link-analytics__chart" aria-label="Daily tips chart">
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
              <h4>Top posts</h4>
              <table class="fiber-link-analytics__table">
                <thead>
                  <tr><th>#</th><th>Post</th><th>Tips</th><th>Total CKB</th></tr>
                </thead>
                <tbody>
                  {{#each this.data.topPosts as |post i|}}
                    <tr>
                      <td>{{add i 1}}</td>
                      <td>
                        <a href="/p/{{post.postId}}" target="_blank" rel="noopener noreferrer">
                          Post #{{post.postId}}
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
              <h4>Top supporters</h4>
              <table class="fiber-link-analytics__table">
                <thead>
                  <tr><th>#</th><th>User ID</th><th>Tips</th><th>Total CKB</th></tr>
                </thead>
                <tbody>
                  {{#each this.data.topTippers as |tipper i|}}
                    <tr>
                      <td>{{add i 1}}</td>
                      <td>{{tipper.userId}}</td>
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
        <p class="fiber-link-analytics__empty">No analytics data yet for this period.</p>
      {{/if}}
    </section>
  </template>
}
