import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { on } from "@ember/modifier";

const STAGE_VALUES = Object.freeze(["UNPAID", "SETTLED", "FAILED"]);
const STAGE_FILTER_OPTIONS = Object.freeze(["ALL", ...STAGE_VALUES]);

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function normalizeStageCounts(rawCounts) {
  const countsByStage = { UNPAID: 0, SETTLED: 0, FAILED: 0 };
  const rows = Array.isArray(rawCounts) ? rawCounts : [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const stage = toStringOrEmpty(row.stage);
    const rawCount = Number(row.count);
    if ((stage === "UNPAID" || stage === "SETTLED" || stage === "FAILED") && Number.isFinite(rawCount)) {
      countsByStage[stage] = Math.max(0, Math.trunc(rawCount));
    }
  }

  return STAGE_VALUES.map((stage) => ({ stage, count: countsByStage[stage] }));
}

function normalizeInvoiceRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      invoice: toStringOrEmpty(row.invoice),
      state: toStringOrEmpty(row.state),
      amount: toStringOrEmpty(row.amount),
      asset: toStringOrEmpty(row.asset),
      fromUserId: toStringOrEmpty(row.fromUserId),
      toUserId: toStringOrEmpty(row.toUserId),
      createdAt: toStringOrEmpty(row.createdAt),
      timelineHref: toStringOrEmpty(row.timelineHref),
    }))
    .filter((row) => row.invoice && row.timelineHref);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  const header = [
    "invoice",
    "stage",
    "amount",
    "asset",
    "from_user_id",
    "to_user_id",
    "created_at",
    "timeline_href",
  ];

  const lines = [header.map(toCsvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.invoice,
        row.state,
        row.amount,
        row.asset,
        row.fromUserId,
        row.toUserId,
        row.createdAt,
        row.timelineHref,
      ]
        .map(toCsvCell)
        .join(","),
    );
  }

  return lines.join("\n");
}

export default class FiberLinkLifecycleBoard extends Component {
  @tracked selectedStage = "ALL";
  @tracked invoiceQuery = "";

  get stageFilterOptions() {
    return STAGE_FILTER_OPTIONS;
  }

  get stageCounts() {
    return normalizeStageCounts(this.args?.board?.stageCounts);
  }

  get invoiceRows() {
    return normalizeInvoiceRows(this.args?.board?.invoiceRows);
  }

  get filteredRows() {
    const normalizedQuery = this.invoiceQuery.trim().toLowerCase();
    return this.invoiceRows.filter((row) => {
      if (this.selectedStage !== "ALL" && row.state !== this.selectedStage) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return (
        row.invoice.toLowerCase().includes(normalizedQuery) ||
        row.fromUserId.toLowerCase().includes(normalizedQuery) ||
        row.toUserId.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  get csvHref() {
    const csv = buildCsv(this.filteredRows);
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }

  @action
  updateStageFilter(event) {
    const value = event?.target?.value;
    this.selectedStage = STAGE_FILTER_OPTIONS.includes(value) ? value : "ALL";
  }

  @action
  updateInvoiceQuery(event) {
    this.invoiceQuery = toStringOrEmpty(event?.target?.value);
  }

  @action
  clearFilters() {
    this.selectedStage = "ALL";
    this.invoiceQuery = "";
  }

  <template>
    <section class="fiber-link-lifecycle-board">
      <h4>Lifecycle Pipeline Board</h4>
      <p>Stage counts and sample invoice rows from the latest dashboard.summary payload.</p>

      <p class="fiber-link-lifecycle-board__stage-counts">
        {{#each this.stageCounts as |row|}}
          <span><strong>{{row.stage}}: {{row.count}}</strong></span>
        {{/each}}
      </p>

      <div class="fiber-link-lifecycle-board__filters">
        <label>
          Lifecycle stage
          <select
            value={{this.selectedStage}}
            aria-label="Lifecycle stage"
            {{on "change" this.updateStageFilter}}
          >
            {{#each this.stageFilterOptions as |stageOption|}}
              <option value={{stageOption}}>{{stageOption}}</option>
            {{/each}}
          </select>
        </label>

        <label>
          Search invoice
          <input
            type="text"
            aria-label="Search invoice"
            value={{this.invoiceQuery}}
            {{on "input" this.updateInvoiceQuery}}
          />
        </label>

        <a href={{this.csvHref}} download="fiber-link-lifecycle-board.csv">Export CSV</a>
        <button type="button" {{on "click" this.clearFilters}}>Clear</button>
      </div>

      <table class="fiber-link-lifecycle-board__table">
        <thead>
          <tr>
            <th>invoice</th>
            <th>stage</th>
            <th>amount</th>
            <th>asset</th>
            <th>from</th>
            <th>to</th>
            <th>createdAt</th>
            <th>timeline</th>
          </tr>
        </thead>
        <tbody>
          {{#each this.filteredRows as |row|}}
            <tr>
              <td><code>{{row.invoice}}</code></td>
              <td>{{row.state}}</td>
              <td>{{row.amount}}</td>
              <td>{{row.asset}}</td>
              <td>{{row.fromUserId}}</td>
              <td>{{row.toUserId}}</td>
              <td>{{row.createdAt}}</td>
              <td>
                <a
                  href={{row.timelineHref}}
                  title="Timeline placeholder link for future invoice lifecycle timeline view."
                >
                  Timeline
                </a>
              </td>
            </tr>
          {{else}}
            <tr>
              <td colspan="8">No invoice rows for current lifecycle filter.</td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </section>
  </template>
}
