import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { TIP_STATE_MAPPING } from "../components/fiber-link-tip-feed";
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
      mappingRows: TIP_STATE_MAPPING,
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
      const result = await getDashboardSummary({ limit: DASHBOARD_LIMIT });
      if (model !== this._activeModel) {
        return;
      }

      const tips = Array.isArray(result?.tips) ? result.tips : [];
      const hasUnpaid = tips.some((tip) => tip?.state === "UNPAID");

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
