import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { getDashboardSummary } from "../services/fiber-link-api";

const DEFAULT_POLL_INTERVAL_MS = 10000;
const DASHBOARD_LIMIT = 20;
const ALLOWED_POLL_INTERVALS = [10000, 30000, 60000];

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

function mapTipStateToPresentation(state) {
  if (state === "SETTLED") {
    return {
      key: "completed",
      label: "Completed",
      className: "fiber-link-status-badge is-success",
      dotClassName: "fiber-link-tip-feed-status-dot is-completed",
      textClassName: "fiber-link-tip-feed-status-text is-completed",
    };
  }
  if (state === "FAILED") {
    return {
      key: "failed",
      label: "Failed",
      className: "fiber-link-status-badge is-danger",
      dotClassName: "fiber-link-tip-feed-status-dot is-failed",
      textClassName: "fiber-link-tip-feed-status-text is-failed",
    };
  }
  return {
    key: "pending",
    label: "Pending",
    className: "fiber-link-status-badge is-info",
    dotClassName: "fiber-link-tip-feed-status-dot is-pending",
    textClassName: "fiber-link-tip-feed-status-text is-pending",
  };
}

function mapDirectionPresentation(direction) {
  if (direction === "WITHDRAWAL" || direction === "WITHDRAWN") {
    return {
      key: "withdrawn",
      label: "Withdrawn",
      icon: "↗",
      className: "fiber-link-direction-icon is-withdrawn",
      amountPrefix: "-",
      amountClassName: "fiber-link-tip-feed-amount is-negative",
    };
  }

  if (direction === "OUT") {
    return {
      key: "sent",
      label: "Sent",
      icon: "↑",
      className: "fiber-link-direction-icon is-sent",
      amountPrefix: "-",
      amountClassName: "fiber-link-tip-feed-amount is-negative",
    };
  }

  return {
    key: "received",
    label: "Received",
    icon: "↓",
    className: "fiber-link-direction-icon is-received",
    amountPrefix: "+",
    amountClassName: "fiber-link-tip-feed-amount is-positive",
  };
}

function buildTipFeedSignature(tips) {
  return JSON.stringify(Array.isArray(tips) ? tips : []);
}

function buildAvatarInitials(username) {
  const value = typeof username === "string" ? username.trim() : "";
  if (!value) {
    return "U";
  }

  return value
    .replace(/^@/, "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || value.slice(0, 2).toUpperCase();
}

function formatCountCaption(count, singular, plural = `${singular}s`) {
  const normalizedCount = Number(count || 0);
  return `${normalizedCount} ${normalizedCount === 1 ? singular : plural}`;
}

function normalizeTips(tips) {
  const rows = Array.isArray(tips) ? tips : [];
  return rows.map((tip) => {
    const status = mapTipStateToPresentation(tip?.state);
    const direction = mapDirectionPresentation(tip?.direction);
    const absoluteTime = formatIsoTimestamp(tip?.createdAt);
    const counterpartyUsername =
      typeof tip?.counterpartyUsername === "string" && tip.counterpartyUsername.trim()
        ? tip.counterpartyUsername.trim()
        : typeof tip?.counterpartyUserId === "string"
          ? tip.counterpartyUserId
          : "unknown";

    return {
      id: typeof tip?.id === "string" ? tip.id : "unknown",
      amount: typeof tip?.amount === "string" ? tip.amount : "0",
      asset: tip?.asset === "USDI" ? "USDI" : "CKB",
      createdAt: typeof tip?.createdAt === "string" ? tip.createdAt : null,
      statusLabel: status.label,
      statusClassName: status.className,
      statusKey: status.key,
      directionKey: direction.key,
      directionLabel: direction.label,
      directionIcon: direction.icon,
      directionClassName: direction.className,
      amountPrefix: direction.amountPrefix,
      amountClassName: direction.amountClassName,
      statusDotClassName: status.dotClassName,
      statusTextClassName: status.textClassName,
      counterpartyUsername,
      avatarInitials: buildAvatarInitials(counterpartyUsername),
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
      pendingCaption: "0 invoices awaiting settlement",
      completedCaption: "Successful payments · 30d",
      failedCaption: "Requires attention",
      generatedAt: null,
      refreshedAt: null,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
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

    if (model.isInitialLoading) {
      model.set("isRefreshing", false);
    }

    try {
      const result = await getDashboardSummary({
        limit: DASHBOARD_LIMIT,
        includeAdmin: false,
      });

      if (model !== this._activeModel) {
        return;
      }

      const generatedAt = formatIsoTimestamp(result?.generatedAt) || new Date().toISOString();
      const normalizedTips = normalizeTips(result?.tips);
      const nextTipFeedSignature = buildTipFeedSignature(normalizedTips);
      const pendingCount = Number(result?.stats?.pendingCount ?? 0);
      const completedCount = Number(result?.stats?.completedCount ?? 0);
      const failedCount = Number(result?.stats?.failedCount ?? 0);

      const nextProperties = {
        isInitialLoading: false,
        isRefreshing: false,
        summaryErrorMessage: null,
        feedErrorMessage: null,
        availableBalance:
          typeof result?.balances?.available === "string"
            ? result.balances.available
            : typeof result?.balance === "string"
              ? result.balance
              : "0",
        pendingBalance:
          typeof result?.balances?.pending === "string" ? result.balances.pending : "0",
        lockedBalance:
          typeof result?.balances?.locked === "string" ? result.balances.locked : "0",
        balanceAsset: result?.balances?.asset === "USDI" ? "USDI" : "CKB",
        pendingCount,
        completedCount,
        failedCount,
        pendingCaption: `${formatCountCaption(pendingCount, "invoice")} awaiting settlement`,
        completedCaption: "Successful payments · 30d",
        failedCaption: "Requires attention",
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
    const pollIntervalMs = ALLOWED_POLL_INTERVALS.includes(
      Number(model?.pollIntervalMs),
    )
      ? Number(model.pollIntervalMs)
      : DEFAULT_POLL_INTERVAL_MS;

    this._pollTimer = setTimeout(() => {
      void this._refreshSummary(model);
    }, pollIntervalMs);
  }

  _clearPollTimer() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
