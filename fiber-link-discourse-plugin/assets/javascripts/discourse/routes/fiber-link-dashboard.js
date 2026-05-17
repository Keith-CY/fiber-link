import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { getDashboardSummary } from "../services/fiber-link-api";

const DEFAULT_POLL_INTERVAL_MS = 10000;
const DASHBOARD_LIMIT = 20;
const ALLOWED_POLL_INTERVALS = [10000, 30000, 60000];
const DASHBOARD_POLL_MAX_BACKOFF_MS = 60000;
const DASHBOARD_POLL_MAX_FAILURES = 5;
const DASHBOARD_POLL_MAX_FAILURE_WINDOW_MS = 300000;
const DASHBOARD_HIDDEN_POLL_INTERVAL_MS = 60000;
const SYNC_AGE_TICK_MS = 1000;

function mapDashboardErrorToMessage(error) {
  const message =
    typeof error?.message === "string" ? error.message.trim() : "";
  if (!message) {
    return "Failed to load dashboard.summary. Please retry.";
  }
  if (message.toLowerCase().includes("timed out")) {
    return "Dashboard data timed out. The service may be busy; retry when traffic settles.";
  }
  return message;
}

function isTransientDashboardError(message) {
  const value = message.toLowerCase();
  return (
    value.includes("network") ||
    value.includes("timeout") ||
    value.includes("failed to fetch") ||
    value.includes("service unavailable")
  );
}

function isRetryableDashboardError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.code);
  const message =
    typeof error?.message === "string" ? error.message.trim() : "";
  return (
    status === 429 ||
    status === 503 ||
    message.includes("429") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("too many requests") ||
    isTransientDashboardError(message)
  );
}

function formatSyncStatusLabel(rawValue) {
  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return "Live · syncing";
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / 1000),
  );
  if (ageSeconds < 2) {
    return "Live · synced now";
  }
  if (ageSeconds < 60) {
    return `Live · synced ${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  return `Live · synced ${ageMinutes}m ago`;
}

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
  if (state === "SETTLED" || state === "COMPLETED") {
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
  if (state === "BROADCASTED") {
    return {
      key: "broadcasted",
      label: "Broadcasted",
      className: "fiber-link-status-badge is-info",
      dotClassName: "fiber-link-tip-feed-status-dot is-pending",
      textClassName: "fiber-link-tip-feed-status-text is-pending",
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

  return (
    value
      .replace(/^@/, "")
      .split(/[_\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || value.slice(0, 2).toUpperCase()
  );
}

function formatCountCaption(count, singular, plural = `${singular}s`) {
  const normalizedCount = Number(count || 0);
  return `${normalizedCount} ${normalizedCount === 1 ? singular : plural}`;
}

function formatShortTimestamp(rawValue) {
  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(value);
}

function formatCompactRelativeTime(rawValue) {
  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / 1000),
  );
  if (ageSeconds < 2) {
    return "now";
  }
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours}h ago`;
  }

  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 7) {
    return `${ageDays}d ago`;
  }

  const ageWeeks = Math.floor(ageDays / 7);
  return `${ageWeeks}w ago`;
}

function buildConfirmationLabel(tip, status) {
  if (status.key === "failed") {
    return "Failed · requires attention";
  }

  if (status.key === "broadcasted") {
    return "Broadcasted · awaiting chain confirmation";
  }

  if (status.key === "pending") {
    return "Pending · awaiting confirmation";
  }

  if (tip?.activityType === "TIP" || tip?.direction === "IN") {
    return "Confirmed · Discourse post";
  }

  if (tip?.txHash) {
    return "Confirmed · CKB explorer";
  }

  return "Confirmed · recorded";
}

function normalizePostUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("/") || /^https?:\/\//.test(trimmed)
    ? trimmed
    : null;
}

function normalizePostContextLabel(value) {
  return value === "View the Reply" ? "View the Reply" : "View the Post";
}

function normalizeTips(tips) {
  const rows = Array.isArray(tips) ? tips : [];
  return rows.map((tip) => {
    const status = mapTipStateToPresentation(tip?.state);
    const direction = mapDirectionPresentation(tip?.direction);
    const absoluteTime = formatIsoTimestamp(tip?.createdAt);
    const counterpartyUsername =
      typeof tip?.counterpartyUsername === "string" &&
      tip.counterpartyUsername.trim()
        ? tip.counterpartyUsername.trim()
        : typeof tip?.counterpartyUserId === "string"
          ? tip.counterpartyUserId
          : "unknown";

    const activityType =
      tip?.activityType === "WITHDRAWAL" ? "WITHDRAWAL" : "TIP";
    const postUrl =
      activityType === "TIP" ? normalizePostUrl(tip?.postUrl) : null;
    const postContextLabel = normalizePostContextLabel(tip?.postContextLabel);
    const explorerUrl =
      typeof tip?.explorerUrl === "string" && tip.explorerUrl.trim()
        ? tip.explorerUrl.trim()
        : null;

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
      shortTimeLabel: formatShortTimestamp(tip?.createdAt),
      relativeTimeLabel: formatCompactRelativeTime(tip?.createdAt),
      message:
        typeof tip?.message === "string" && tip.message.trim()
          ? tip.message.trim()
          : null,
      activityType,
      postUrl,
      postContextLabel,
      detailTitle:
        activityType === "TIP" ? "Payment details" : "Transaction details",
      detailActionUrl: activityType === "TIP" ? postUrl : explorerUrl,
      detailActionLabel:
        activityType === "TIP" ? postContextLabel : "Open in CKB Explorer",
      detailActionUnavailableLabel:
        activityType === "TIP" ? "Post unavailable" : "Open in CKB Explorer",
      txHash:
        typeof tip?.txHash === "string" && tip.txHash.trim()
          ? tip.txHash.trim()
          : null,
      explorerUrl,
      destinationKind:
        typeof tip?.destinationKind === "string" && tip.destinationKind.trim()
          ? tip.destinationKind.trim()
          : null,
      destination:
        typeof tip?.destination === "string" && tip.destination.trim()
          ? tip.destination.trim()
          : null,
      transactionTagClassName: [
        "fiber-link-transaction-dialog__tag",
        direction.key === "received" ? "is-received" : "",
        status.key === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" "),
      transactionSummaryStatusClassName: [
        "fiber-link-transaction-dialog__summary-status",
        status.key === "completed" ? "is-completed" : "",
        status.key === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" "),
      transactionAmountClassName: [
        "fiber-link-transaction-dialog__summary-amount",
        direction.amountPrefix === "+" ? "is-positive" : "is-negative",
      ].join(" "),
      transactionActivityClassName: [
        "fiber-link-transaction-dialog__value",
        "fiber-link-transaction-dialog__activity",
        status.key === "completed" ? "is-completed" : "",
        status.key === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" "),
      transactionConfirmationClassName: [
        "fiber-link-transaction-dialog__meta",
        status.key === "failed" ? "is-failed" : "",
        status.key === "pending" || status.key === "broadcasted"
          ? "is-pending"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmationLabel: buildConfirmationLabel(tip, status),
    };
  });
}

export default class FiberLinkDashboardRoute extends Route {
  _activeModel = null;
  _pollTimer = null;
  _syncAgeTimer = null;
  _lastTipFeedSignature = null;
  _dashboardPollFailureCount = 0;
  _dashboardPollFirstFailureAt = null;
  _lastRefreshFailed = false;

  model() {
    this._clearPollTimer();
    this._clearSyncAgeTimer();

    const model = EmberObject.create({
      isInitialLoading: true,
      isRefreshing: false,
      summaryErrorMessage: null,
      feedErrorMessage: null,
      lastErrorAt: null,
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
      syncStatusLabel: "Live · syncing",
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      tipFeedItems: [],
      retryDashboardSummary: () => {
        if (!model.isRefreshing) {
          this._resetDashboardPollBackoff();
          model.set("isRefreshing", true);
          void this._refreshSummary(model);
        }
      },
    });

    this._activeModel = model;
    this._resetDashboardPollBackoff();
    void this._refreshSummary(model);

    return model;
  }

  resetController(_controller, isExiting) {
    if (isExiting) {
      this._activeModel = null;
      this._lastTipFeedSignature = null;
      this._clearPollTimer();
      this._clearSyncAgeTimer();
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

      const generatedAt =
        formatIsoTimestamp(result?.generatedAt) || new Date().toISOString();
      const normalizedTips = normalizeTips(result?.tips).filter(
        (tip) => tip.directionKey !== "sent",
      );
      const nextTipFeedSignature = buildTipFeedSignature(normalizedTips);
      const pendingCount = Number(result?.stats?.pendingCount ?? 0);
      const completedCount = Number(result?.stats?.completedCount ?? 0);
      const failedCount = Number(result?.stats?.failedCount ?? 0);

      const nextProperties = {
        isInitialLoading: false,
        isRefreshing: false,
        summaryErrorMessage: null,
        feedErrorMessage: null,
        lastErrorAt: null,
        availableBalance:
          typeof result?.balances?.available === "string"
            ? result.balances.available
            : typeof result?.balance === "string"
              ? result.balance
              : "0",
        pendingBalance:
          typeof result?.balances?.pending === "string"
            ? result.balances.pending
            : "0",
        lockedBalance:
          typeof result?.balances?.locked === "string"
            ? result.balances.locked
            : "0",
        balanceAsset: result?.balances?.asset === "USDI" ? "USDI" : "CKB",
        pendingCount,
        completedCount,
        failedCount,
        pendingCaption: `${formatCountCaption(pendingCount, "invoice")} awaiting settlement`,
        completedCaption: "Successful payments · 30d",
        failedCaption: "Requires attention",
        generatedAt,
        refreshedAt: new Date().toISOString(),
        syncStatusLabel: formatSyncStatusLabel(generatedAt),
      };

      if (nextTipFeedSignature !== this._lastTipFeedSignature) {
        nextProperties.tipFeedItems = normalizedTips;
        this._lastTipFeedSignature = nextTipFeedSignature;
      }

      model.setProperties(nextProperties);
      this._resetDashboardPollBackoff();
      this._startSyncAgeTimer(model);
    } catch (error) {
      if (model !== this._activeModel) {
        return;
      }

      const retryable = isRetryableDashboardError(error);
      const message = mapDashboardErrorToMessage(error);
      if (retryable) {
        this._recordDashboardPollFailure();
      } else {
        this._resetDashboardPollBackoff();
      }
      model.setProperties({
        isInitialLoading: false,
        isRefreshing: false,
        summaryErrorMessage: message,
        feedErrorMessage: message,
        lastErrorAt: new Date().toISOString(),
      });
    } finally {
      if (model === this._activeModel) {
        this._schedulePoll(model);
      }
    }
  }

  _resetDashboardPollBackoff() {
    this._dashboardPollFailureCount = 0;
    this._dashboardPollFirstFailureAt = null;
    this._lastRefreshFailed = false;
  }

  _recordDashboardPollFailure() {
    if (!this._dashboardPollFirstFailureAt) {
      this._dashboardPollFirstFailureAt = Date.now();
    }
    this._dashboardPollFailureCount += 1;
    this._lastRefreshFailed = true;
  }

  _isDocumentHidden() {
    return typeof document !== "undefined" && document?.hidden === true;
  }

  _canContinueDashboardPolling() {
    if (!this._lastRefreshFailed) {
      return true;
    }

    return (
      this._dashboardPollFailureCount < DASHBOARD_POLL_MAX_FAILURES &&
      Date.now() - this._dashboardPollFirstFailureAt <=
        DASHBOARD_POLL_MAX_FAILURE_WINDOW_MS
    );
  }

  _getDashboardPollDelay(model) {
    const pollIntervalMs = ALLOWED_POLL_INTERVALS.includes(
      Number(model?.pollIntervalMs),
    )
      ? Number(model.pollIntervalMs)
      : DEFAULT_POLL_INTERVAL_MS;
    const backoffDelay = this._lastRefreshFailed
      ? Math.min(
          DASHBOARD_POLL_MAX_BACKOFF_MS,
          pollIntervalMs *
            Math.pow(2, Math.max(0, this._dashboardPollFailureCount - 1)),
        )
      : pollIntervalMs;

    return this._isDocumentHidden()
      ? Math.max(backoffDelay, DASHBOARD_HIDDEN_POLL_INTERVAL_MS)
      : backoffDelay;
  }

  _schedulePoll(model) {
    this._clearPollTimer();
    if (!this._canContinueDashboardPolling()) {
      const pauseMessage =
        "Auto-refresh paused after repeated failures. Retry dashboard to resume.";
      model?.setProperties?.({
        summaryErrorMessage: pauseMessage,
        feedErrorMessage: pauseMessage,
      });
      return;
    }

    this._pollTimer = setTimeout(() => {
      void this._refreshSummary(model);
    }, this._getDashboardPollDelay(model));
  }

  _startSyncAgeTimer(model) {
    this._clearSyncAgeTimer();
    this._syncAgeTimer = setInterval(() => {
      if (!model || model !== this._activeModel || !model.generatedAt) {
        return;
      }
      model.set("syncStatusLabel", formatSyncStatusLabel(model.generatedAt));
    }, SYNC_AGE_TICK_MS);
  }

  _clearPollTimer() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _clearSyncAgeTimer() {
    if (this._syncAgeTimer) {
      clearInterval(this._syncAgeTimer);
      this._syncAgeTimer = null;
    }
  }
}
