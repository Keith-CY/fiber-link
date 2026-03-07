import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { getDashboardSummary } from "../services/fiber-link-api";

const POLL_INTERVAL_MS = 4000;
const DASHBOARD_LIMIT = 20;

function formatTimestamp(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return rawValue;
  }

  return value.toISOString();
}

function buildTipStats(tips) {
  const rows = Array.isArray(tips) ? tips : [];
  let pendingCount = 0;
  let settledCount = 0;
  let failedCount = 0;

  for (const tip of rows) {
    const state = typeof tip?.state === "string" ? tip.state.toUpperCase() : "UNKNOWN";
    if (state === "UNPAID") {
      pendingCount += 1;
      continue;
    }
    if (state === "SETTLED") {
      settledCount += 1;
      continue;
    }
    if (state === "FAILED") {
      failedCount += 1;
    }
  }

  return {
    totalTipCount: rows.length,
    pendingTipCount: pendingCount,
    settledTipCount: settledCount,
    failedTipCount: failedCount,
  };
}

export default class FiberLinkDashboardRoute extends Route {
  _activeModel = null;
  _pollTimer = null;

  model() {
    this._clearPollTimer();

    const model = EmberObject.create({
      isSummaryLoading: true,
      summaryErrorMessage: null,
      isFeedLoading: true,
      feedErrorMessage: null,
      balance: "0",
      balanceAsset: "CKB",
      generatedAt: null,
      refreshedAt: null,
      tipFeedItems: [],
      totalTipCount: 0,
      pendingTipCount: 0,
      settledTipCount: 0,
      failedTipCount: 0,
    });

    this._activeModel = model;
    void this._refreshSummary(model);

    return model;
  }

  resetController(_controller, isExiting) {
    if (isExiting) {
      this._activeModel = null;
      this._clearPollTimer();
    }
  }

  async _refreshSummary(model) {
    if (!model || model !== this._activeModel) {
      return;
    }

    this._clearPollTimer();

    model.setProperties({
      isSummaryLoading: true,
      summaryErrorMessage: null,
      isFeedLoading: true,
      feedErrorMessage: null,
    });

    try {
      const result = await getDashboardSummary({
        limit: DASHBOARD_LIMIT,
        includeAdmin: false,
      });

      if (model !== this._activeModel) {
        return;
      }

      const tips = Array.isArray(result?.tips) ? result.tips : [];
      const hasUnpaid = tips.some((tip) => tip?.state === "UNPAID");
      const stats = buildTipStats(tips);

      model.setProperties({
        isSummaryLoading: false,
        summaryErrorMessage: null,
        isFeedLoading: false,
        feedErrorMessage: null,
        balance: typeof result?.balance === "string" ? result.balance : "0",
        balanceAsset: "CKB",
        generatedAt: formatTimestamp(result?.generatedAt),
        refreshedAt: new Date().toISOString(),
        tipFeedItems: tips,
        ...stats,
      });

      if (hasUnpaid) {
        this._schedulePoll(model);
      }
    } catch (error) {
      if (model !== this._activeModel) {
        return;
      }

      const message = error?.message ?? "Failed to load dashboard.summary";
      model.setProperties({
        isSummaryLoading: false,
        summaryErrorMessage: message,
        isFeedLoading: false,
        feedErrorMessage: message,
      });
    }
  }

  _schedulePoll(model) {
    this._clearPollTimer();
    this._pollTimer = setTimeout(() => {
      void this._refreshSummary(model);
    }, POLL_INTERVAL_MS);
  }

  _clearPollTimer() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
