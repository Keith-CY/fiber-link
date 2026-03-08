import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { getDashboardSummary } from "../services/fiber-link-api";

const POLL_INTERVAL_MS = 10000;
const DASHBOARD_LIMIT = 20;

function formatIsoTimestamp(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return rawValue;
  }

  return value.toISOString();
}

function formatRelativeTime(rawValue, referenceValue) {
  const value = new Date(rawValue);
  const reference = new Date(referenceValue || Date.now());
  if (Number.isNaN(value.getTime()) || Number.isNaN(reference.getTime())) {
    return rawValue;
  }

  const diffMs = value.getTime() - reference.getTime();
  const units = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, unitMs] of units) {
    if (Math.abs(diffMs) >= unitMs || unit === "minute") {
      return formatter.format(Math.round(diffMs / unitMs), unit);
    }
  }

  return "just now";
}

function mapTipStateToPresentation(state) {
  if (state === "SETTLED") {
    return {
      label: "Payment received",
      className: "fiber-link-status-badge is-success",
    };
  }
  if (state === "FAILED") {
    return {
      label: "Failed",
      className: "fiber-link-status-badge is-danger",
    };
  }
  return {
    label: "Awaiting payment",
    className: "fiber-link-status-badge is-warning",
  };
}

function mapDirectionLabel(direction) {
  return direction === "OUT" ? "Outgoing" : "Incoming";
}

function buildTipFeedSignature(tips) {
  return JSON.stringify(Array.isArray(tips) ? tips : []);
}

function normalizeTips(tips, generatedAt) {
  const rows = Array.isArray(tips) ? tips : [];
  return rows.map((tip) => {
    const status = mapTipStateToPresentation(tip?.state);
    const absoluteTime = formatIsoTimestamp(tip?.createdAt);
    return {
      id: typeof tip?.id === "string" ? tip.id : "unknown",
      amount: typeof tip?.amount === "string" ? tip.amount : "0",
      asset: tip?.asset === "USDI" ? "USDI" : "CKB",
      statusLabel: status.label,
      statusClassName: status.className,
      directionLabel: mapDirectionLabel(tip?.direction),
      counterpartyUsername:
        typeof tip?.counterpartyUsername === "string" && tip.counterpartyUsername.trim()
          ? tip.counterpartyUsername.trim()
          : typeof tip?.counterpartyUserId === "string"
            ? tip.counterpartyUserId
            : "unknown",
      relativeTimeLabel: formatRelativeTime(tip?.createdAt, generatedAt),
      absoluteTimeLabel: absoluteTime,
      message: typeof tip?.message === "string" && tip.message.trim() ? tip.message.trim() : null,
    };
  });
}

export default class FiberLinkDashboardRoute extends Route {
  _activeModel = null;
  _pollTimer = null;
  _lastTipFeedSignature = null;

  model() {
    this._clearPollTimer();

    const model = EmberObject.create({
      isInitialLoading: true,
      isRefreshing: false,
      summaryErrorMessage: null,
      feedErrorMessage: null,
      availableBalance: "0",
      pendingBalance: "0",
      lockedBalance: "0",
      balanceAsset: "CKB",
      pendingCount: 0,
      completedCount: 0,
      failedCount: 0,
      generatedAt: null,
      refreshedAt: null,
      tipFeedItems: [],
    });

    this._activeModel = model;
    void this._refreshSummary(model);

    return model;
  }

  resetController(_controller, isExiting) {
    if (isExiting) {
      this._activeModel = null;
      this._lastTipFeedSignature = null;
      this._clearPollTimer();
    }
  }

  async _refreshSummary(model) {
    if (!model || model !== this._activeModel) {
      return;
    }

    this._clearPollTimer();

    const isInitialLoad = Boolean(model.isInitialLoading);
    model.setProperties({
      summaryErrorMessage: null,
      feedErrorMessage: null,
      isRefreshing: !isInitialLoad,
    });

    try {
      const result = await getDashboardSummary({
        limit: DASHBOARD_LIMIT,
        includeAdmin: false,
      });

      if (model !== this._activeModel) {
        return;
      }

      const generatedAt = formatIsoTimestamp(result?.generatedAt) || new Date().toISOString();
      const normalizedTips = normalizeTips(result?.tips, generatedAt);
      const nextTipFeedSignature = buildTipFeedSignature(normalizedTips);

      const nextProperties = {
        isInitialLoading: false,
        isRefreshing: false,
        summaryErrorMessage: null,
        feedErrorMessage: null,
        availableBalance: typeof result?.balances?.available === "string" ? result.balances.available : typeof result?.balance === "string" ? result.balance : "0",
        pendingBalance: typeof result?.balances?.pending === "string" ? result.balances.pending : "0",
        lockedBalance: typeof result?.balances?.locked === "string" ? result.balances.locked : "0",
        balanceAsset: result?.balances?.asset === "USDI" ? "USDI" : "CKB",
        pendingCount: Number(result?.stats?.pendingCount ?? 0),
        completedCount: Number(result?.stats?.completedCount ?? 0),
        failedCount: Number(result?.stats?.failedCount ?? 0),
        generatedAt,
        refreshedAt: new Date().toISOString(),
      };

      if (nextTipFeedSignature !== this._lastTipFeedSignature) {
        nextProperties.tipFeedItems = normalizedTips;
        this._lastTipFeedSignature = nextTipFeedSignature;
      }

      model.setProperties(nextProperties);
    } catch (error) {
      if (model !== this._activeModel) {
        return;
      }

      const message = error?.message ?? "Failed to load dashboard.summary";
      model.setProperties({
        isInitialLoading: false,
        isRefreshing: false,
        summaryErrorMessage: message,
        feedErrorMessage: message,
      });
    } finally {
      if (model === this._activeModel) {
        this._schedulePoll(model);
      }
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
