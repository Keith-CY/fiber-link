import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { getDashboardAnalytics } from "../services/fiber-link-api";

const eq = (a, b) => a === b;
const inc = (n) => n + 1;

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

const RANKING_LIMIT = 5;

function rangeLabelFor(value) {
  return RANGES.find((range) => range.value === value)?.label ?? "30 days";
}

function formatAmount(amount) {
  const n = parseFloat(amount ?? "0");
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatShortDate(value) {
  if (!value) return "No tips yet";
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function withdrawalStateLabel(state) {
  return String(state ?? "pending").replace(/_/g, " ").toLowerCase();
}

function withdrawalStateClass(state) {
  return `is-${String(state ?? "pending").toLowerCase().replace(/_/g, "-")}`;
}

export default class FiberLinkAnalytics extends Component {
  @tracked range = "30d";
  @tracked data = null;
  @tracked isLoading = false;
  @tracked errorMessage = null;
  @tracked queuedRange = null;

  get ranges() {
    return RANGES;
  }

  get hasData() {
    return (
      this.data &&
      (this.timeSeries.length > 0 ||
        this.topPosts.length > 0 ||
        this.topTippers.length > 0 ||
        this.withdrawals.length > 0)
    );
  }

  get isShowingStaleData() {
    return Boolean(this.errorMessage && this.hasData);
  }

  get isRefreshingVisibleData() {
    return Boolean(this.isLoading && this.hasData);
  }

  get panelClass() {
    return `fiber-link-analytics${this.isShowingStaleData ? " is-stale" : ""}`;
  }

  get loadingClass() {
    return `fiber-link-analytics__loading${this.isRefreshingVisibleData ? " is-inline" : ""}`;
  }

  get loadingMessage() {
    return this.isRefreshingVisibleData ? "Refreshing creator signal..." : "Loading creator signal...";
  }

  get timeSeries() {
    return this.data?.timeSeries ?? [];
  }

  get topPosts() {
    return this.data?.topPosts ?? [];
  }

  get visibleTopPosts() {
    return this.topPosts.slice(0, RANKING_LIMIT);
  }

  get hiddenTopPostCount() {
    return Math.max(this.topPosts.length - this.visibleTopPosts.length, 0);
  }

  get topTippers() {
    return this.data?.topTippers ?? [];
  }

  get visibleTopTippers() {
    return this.topTippers.slice(0, RANKING_LIMIT);
  }

  get hiddenTopTipperCount() {
    return Math.max(this.topTippers.length - this.visibleTopTippers.length, 0);
  }

  get withdrawals() {
    return this.data?.withdrawalHistory ?? [];
  }

  get recentWithdrawals() {
    return this.withdrawals.slice(0, 5);
  }

  get rangeLabel() {
    return rangeLabelFor(this.range);
  }

  get visibleRange() {
    return this.data?.range ?? this.range;
  }

  get visibleRangeLabel() {
    return rangeLabelFor(this.visibleRange);
  }

  get isRangePending() {
    return Boolean(this.hasData && this.data?.range && this.data.range !== this.range);
  }

  get rangeStateLabel() {
    if (!this.isRangePending) return `Showing ${this.visibleRangeLabel}`;
    return `Showing ${this.visibleRangeLabel}; ${this.rangeLabel} requested`;
  }

  get totalAmount() {
    return this.timeSeries.reduce((sum, row) => sum + parseFloat(row.amount ?? "0"), 0);
  }

  get activeTipDays() {
    return this.timeSeries.filter((row) => parseFloat(row.amount ?? "0") > 0).length;
  }

  get quietTipDays() {
    return Math.max(this.timeSeries.length - this.activeTipDays, 0);
  }

  get peakDay() {
    if (!this.timeSeries.length) return null;
    return this.timeSeries.reduce((best, row) => {
      const rowAmount = parseFloat(row.amount ?? "0");
      const bestAmount = parseFloat(best.amount ?? "0");
      return rowAmount > bestAmount ? row : best;
    }, this.timeSeries[0]);
  }

  get peakDayDateLabel() {
    return formatShortDate(this.peakDay?.date);
  }

  get peakDayAmountLabel() {
    return `${formatAmount(this.peakDay?.amount)} CKB`;
  }

  get rhythmNote() {
    if (!this.timeSeries.length) return "No settled tip days in this window yet.";
    if (this.activeTipDays === 0) return `${this.timeSeries.length} quiet days, no settled tip volume yet.`;
    if (this.quietTipDays === 0) return `${this.activeTipDays} active tip days, no quiet days in this chart.`;
    return `${this.activeTipDays} active tip days, ${this.quietTipDays} quiet days. Peak: ${this.peakDayDateLabel}.`;
  }

  get strongestPost() {
    return this.topPosts[0] ?? null;
  }

  get strongestPostLabel() {
    return this.strongestPost ? `Post #${this.strongestPost.postId}` : "No post winner yet";
  }

  get strongestPostMeta() {
    if (!this.strongestPost) return "Settled tips will reveal the first post to revisit.";
    return `${this.strongestPost.tipCount} tips / ${formatAmount(this.strongestPost.totalAmount)} CKB`;
  }

  get topSupporter() {
    return this.topTippers[0] ?? null;
  }

  get topSupporterLabel() {
    return this.topSupporter?.userId ?? "No supporter leader yet";
  }

  get topSupporterMeta() {
    if (!this.topSupporter) return "Repeat supporter signals appear after tips settle.";
    return `${this.topSupporter.tipCount} tips / ${formatAmount(this.topSupporter.totalAmount)} CKB`;
  }

  get latestWithdrawal() {
    return this.recentWithdrawals[0] ?? null;
  }

  get latestWithdrawalMeta() {
    if (!this.latestWithdrawal) return "No payout requests in this window.";
    return `${formatAmount(this.latestWithdrawal.amount)} ${this.latestWithdrawal.asset} / ${withdrawalStateLabel(this.latestWithdrawal.state)}`;
  }

  get creatorBriefLead() {
    if (this.strongestPost && this.topSupporter) {
      return `${this.strongestPostLabel} is carrying this window, and ${this.topSupporterLabel} is the supporter to notice.`;
    }
    if (this.strongestPost) {
      return `${this.strongestPostLabel} is the strongest earning post in this window.`;
    }
    if (this.topSupporter) {
      return `${this.topSupporterLabel} is the supporter creating the clearest repeat signal.`;
    }
    if (this.withdrawals.length) {
      return "This window is mostly payout activity, not fresh settled tips.";
    }
    return "This window is waiting for its first strong creator signal.";
  }

  get creatorBriefBody() {
    if (this.totalAmount > 0) {
      return `${formatAmount(this.totalAmount)} CKB settled in the visible ${this.visibleRangeLabel} window across ${this.activeTipDays} active tip days. Use these cues to decide what to revisit, who to notice, and when to review payouts.`;
    }
    if (this.withdrawals.length) {
      return `There are payout requests in the visible ${this.visibleRangeLabel} window, but no settled tip rhythm yet. Review payout status first, then wait for new settled tips before reading content signals.`;
    }
    return "When settled tips arrive, this brief will call out the post, supporter, and payout pressure worth inspecting first.";
  }

  get generatedAtLabel() {
    return formatDateTime(this.data?.generatedAt);
  }

  get maxTimeSeriesAmount() {
    if (!this.timeSeries.length) return 1;
    return Math.max(...this.timeSeries.map((d) => parseFloat(d.amount ?? "0")), 1);
  }

  barWidth(amount) {
    const pct = (parseFloat(amount ?? "0") / this.maxTimeSeriesAmount) * 100;
    return `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
  }

  barRowClass(row) {
    const amount = parseFloat(row?.amount ?? "0");
    let className = "fiber-link-analytics__bar-row";
    if (amount <= 0) className += " is-zero";
    if (amount > 0 && row?.date === this.peakDay?.date) className += " is-peak";
    return className;
  }

  constructor(owner, args) {
    super(owner, args);
    void this.loadAnalytics().catch(() => {});
  }

  @action
  async onRangeChange(event) {
    const nextRange = event.target.value;
    if (nextRange === this.range && this.data?.range === nextRange && !this.errorMessage) {
      return;
    }
    this.range = nextRange;
    await this.loadAnalytics();
  }

  @action
  async loadAnalytics() {
    if (this.isLoading) {
      this.queuedRange = this.range;
      return;
    }
    this.isLoading = true;
    this.errorMessage = null;
    const requestedRange = this.range;
    try {
      this.data = await getDashboardAnalytics({ range: requestedRange });
    } catch (e) {
      this.errorMessage = e?.message || "Failed to load analytics.";
    } finally {
      this.isLoading = false;
      const queuedRange = this.queuedRange;
      this.queuedRange = null;
      if (queuedRange && queuedRange === this.range && queuedRange !== this.data?.range) {
        await this.loadAnalytics();
      }
    }
  }

  <template>
    <section id="fiber-link-analytics-panel" class={{this.panelClass}} data-fiber-link-analytics>
      <div class="fiber-link-analytics__masthead">
        <div class="fiber-link-analytics__headline">
          <span class="fiber-link-analytics__eyebrow">Creator analytics</span>
          <h3 class="fiber-link-analytics__title">
            Know which moments are earning attention.
          </h3>
          <p>
            Track settled CKB volume, the posts converting into tips, repeat
            supporters, and withdrawal pressure without leaving Discourse.
          </p>
        </div>

        <div class="fiber-link-analytics__controls">
          <div class="fiber-link-analytics__scope-control" aria-label="Analytics asset scope">
            <span>Asset scope</span>
            <strong>CKB settlement</strong>
          </div>

          <label class="fiber-link-analytics__range-control">
            <span>Window</span>
            <select
              class="fiber-link-analytics__range"
              aria-label="Date range"
              name="fiber-link-analytics-range"
              {{on "change" this.onRangeChange}}
            >
              {{#each this.ranges as |r|}}
                <option value={{r.value}} selected={{eq r.value this.range}}>{{r.label}}</option>
              {{/each}}
            </select>
            <em>Session only; new visits start at 30 days.</em>
          </label>
        </div>
      </div>

      <div class="fiber-link-analytics__proof-strip" role="list" aria-label="Analytics data basis">
        <span role="listitem">CKB settlement view</span>
        <span role="listitem">Settled tips only</span>
        <span role="listitem">Visible loaded window</span>
        <span role="listitem">Range not saved</span>
        <span role="listitem">Top 5 shown from ranked results</span>
        <span role="listitem">No modeled deltas</span>
      </div>

      {{#if this.errorMessage}}
        <div class="fiber-link-analytics__error" role="status">
          <span>Analytics unavailable</span>
          <p>
            {{this.errorMessage}}
              {{#if this.hasData}}
              Showing {{this.visibleRangeLabel}} data until {{this.rangeLabel}} refresh succeeds.
            {{else}}
              Withdrawal and activity tools remain available.
            {{/if}}
          </p>
          <button type="button" {{on "click" this.loadAnalytics}}>
            Retry analytics
          </button>
        </div>
      {{/if}}

      {{#if this.isLoading}}
        <div class={{this.loadingClass}} role="status">
          <span aria-hidden="true"></span>
          {{this.loadingMessage}}
          {{#if this.isRangePending}}
            <em>Keeping {{this.visibleRangeLabel}} visible while {{this.rangeLabel}} loads.</em>
          {{/if}}
        </div>
      {{/if}}

      {{#if this.hasData}}
        <div class="fiber-link-analytics__kpis" aria-label="Creator analytics summary">
          <article>
            <span>Settled volume</span>
            <strong>{{formatAmount this.totalAmount}}</strong>
            <em>CKB in {{this.visibleRangeLabel}}</em>
          </article>
          <article>
            <span>Tip days</span>
            <strong>{{this.activeTipDays}}</strong>
            <em>days with settled tips</em>
          </article>
          <article>
            <span>Best day</span>
            <strong>{{this.peakDayDateLabel}}</strong>
            <em>{{this.peakDayAmountLabel}}</em>
          </article>
          <article>
            <span>Withdrawals</span>
            <strong>{{this.withdrawals.length}}</strong>
            <em>requests in window</em>
          </article>
        </div>

        <section class="fiber-link-analytics__brief" aria-label="Creator analytics brief">
          <span>Creator brief</span>
          <strong>{{this.creatorBriefLead}}</strong>
          <p>{{this.creatorBriefBody}}</p>
        </section>

        <div class="fiber-link-analytics__next-head">
          <span>Suggested next moves</span>
          <p>
            Light guidance from settled activity only. Use it to choose what to
            inspect next, not as content strategy automation.
          </p>
        </div>

        <div class="fiber-link-analytics__actions" aria-label="Suggested creator actions">
          <article aria-label="Revisit winning post">
            <span>Revisit winner</span>
            <strong>{{this.strongestPostLabel}}</strong>
            <em>{{this.strongestPostMeta}}</em>
            {{#if this.strongestPost}}
              <a href="/p/{{this.strongestPost.postId}}" target="_blank" rel="noopener noreferrer">
                Open post
              </a>
            {{/if}}
          </article>
          <article aria-label="Notice top supporter">
            <span>Notice supporter</span>
            <strong>{{this.topSupporterLabel}}</strong>
            <em>{{this.topSupporterMeta}}</em>
          </article>
          <article aria-label="Review payout focus">
            <span>Payout focus</span>
            <strong>Withdrawal desk</strong>
            <em>{{this.latestWithdrawalMeta}}</em>
            <a href="#fiber-link-withdrawal-panel">Review payout form</a>
          </article>
        </div>

        <div class="fiber-link-analytics__body">
          <div class="fiber-link-analytics__chart-card">
            <div class="fiber-link-analytics__section-head">
              <span>Revenue rhythm</span>
              <strong>daily settled tips</strong>
            </div>
            <div class="fiber-link-analytics__freshness" aria-label="Analytics freshness">
              <span>Last updated</span>
              <strong>{{this.generatedAtLabel}}</strong>
              <em class="fiber-link-analytics__freshness-range">{{this.rangeStateLabel}}</em>
              {{#if this.isShowingStaleData}}
                <em class="fiber-link-analytics__freshness-warning">Refresh failed</em>
              {{/if}}
            </div>
            <p class="fiber-link-analytics__rhythm-note">{{this.rhythmNote}}</p>

            {{#if this.timeSeries.length}}
              <div class="fiber-link-analytics__chart" aria-label="Daily tips chart">
                {{#each this.timeSeries as |row|}}
                  <div class={{this.barRowClass row}} title="{{row.date}}: {{row.amount}} CKB">
                    <span class="fiber-link-analytics__bar-label">{{formatShortDate row.date}}</span>
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
            {{else}}
              <p class="fiber-link-analytics__empty is-compact">No settled tip days in this window.</p>
            {{/if}}
          </div>

          <div class="fiber-link-analytics__side">
            <section class="fiber-link-analytics__rank-card">
              <div class="fiber-link-analytics__section-head">
                <span>Top earning posts</span>
                <strong>ranked by settled CKB</strong>
              </div>

              {{#if this.visibleTopPosts.length}}
                <ol class="fiber-link-analytics__rank-list">
                  {{#each this.visibleTopPosts as |post i|}}
                    <li>
                      <span class="fiber-link-analytics__rank-index">{{inc i}}</span>
                      <a
                        class="fiber-link-analytics__rank-main"
                        href="/p/{{post.postId}}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Post #{{post.postId}}
                        <em>Open post</em>
                      </a>
                      <span class="fiber-link-analytics__rank-evidence">{{post.tipCount}} tips</span>
                      <strong class="fiber-link-analytics__rank-value">{{formatAmount post.totalAmount}} CKB</strong>
                    </li>
                  {{/each}}
                </ol>
                {{#if this.hiddenTopPostCount}}
                  <p class="fiber-link-analytics__rank-more">
                    +{{this.hiddenTopPostCount}} more returned by analytics. Keep the creator view to the top 5; use export/admin surfaces for full inspection.
                  </p>
                {{/if}}
              {{else}}
                <p class="fiber-link-analytics__empty is-compact">No tipped posts yet.</p>
              {{/if}}
            </section>

            <section class="fiber-link-analytics__rank-card">
              <div class="fiber-link-analytics__section-head">
                <span>Repeat supporters</span>
                <strong>ranked by settled CKB</strong>
              </div>

              {{#if this.visibleTopTippers.length}}
                <ol class="fiber-link-analytics__rank-list">
                  {{#each this.visibleTopTippers as |tipper i|}}
                    <li>
                      <span class="fiber-link-analytics__rank-index">{{inc i}}</span>
                      <span class="fiber-link-analytics__mono">{{tipper.userId}}</span>
                      <span class="fiber-link-analytics__rank-evidence">{{tipper.tipCount}} tips</span>
                      <strong class="fiber-link-analytics__rank-value">{{formatAmount tipper.totalAmount}} CKB</strong>
                    </li>
                  {{/each}}
                </ol>
                {{#if this.hiddenTopTipperCount}}
                  <p class="fiber-link-analytics__rank-more">
                    +{{this.hiddenTopTipperCount}} more returned by analytics. Keep the creator view to the top 5; use export/admin surfaces for full inspection.
                  </p>
                {{/if}}
              {{else}}
                <p class="fiber-link-analytics__empty is-compact">No supporter rankings yet.</p>
              {{/if}}
            </section>
          </div>
        </div>

        {{#if this.latestWithdrawal}}
          <section class="fiber-link-analytics__withdrawals">
            <div class="fiber-link-analytics__section-head">
              <span>Withdrawal pressure</span>
              <strong>latest payout signal</strong>
            </div>

            <article class="fiber-link-analytics__withdrawal-signal">
              <span class="fiber-link-analytics__status {{withdrawalStateClass this.latestWithdrawal.state}}">
                {{withdrawalStateLabel this.latestWithdrawal.state}}
              </span>
              <strong>{{formatAmount this.latestWithdrawal.amount}} {{this.latestWithdrawal.asset}}</strong>
              <p>
                Created {{formatDateTime this.latestWithdrawal.createdAt}}. Keep the full
                payout history near the withdrawal desk; analytics only surfaces the
                newest pressure point.
              </p>
              <span class="fiber-link-analytics__mono">{{this.latestWithdrawal.id}}</span>
            </article>
          </section>
        {{/if}}
      {{else if this.errorMessage}}
      {{else if this.isLoading}}
      {{else}}
        <div class="fiber-link-analytics__empty">
          <strong>No creator analytics yet.</strong>
          <span>
            When tips settle, this space will show earning rhythm, highest-signal
            posts, repeat supporters, and withdrawal pressure.
          </span>
        </div>
      {{/if}}
    </section>
  </template>
}
