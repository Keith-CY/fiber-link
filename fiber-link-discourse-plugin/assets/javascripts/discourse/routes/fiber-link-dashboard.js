import Route from "@ember/routing/route";
import EmberObject from "@ember/object";

import { buildLifecycleModel, TIP_STATE_MAPPING } from "../components/fiber-link-tip-feed";
import { getTipStatus } from "../services/fiber-link-api";

const POLL_INTERVAL_MS = 4000;

export default class FiberLinkDashboardRoute extends Route {
  queryParams = {
    invoice: { refreshModel: true },
  };

  _activeModel = null;
  _pollTimer = null;

  model(params = {}) {
    this._clearPollTimer();

    const invoice = this._normalizeInvoice(params.invoice ?? this._invoiceFromLocation());
    const initialLifecycle = buildLifecycleModel(null, { isPolling: Boolean(invoice) });

    const model = EmberObject.create({
      invoice,
      isEmptyState: !invoice,
      isErrorState: false,
      isLoading: Boolean(invoice),
      errorMessage: null,
      backendState: initialLifecycle.backendState,
      backendLabel: initialLifecycle.backendLabel,
      lifecycleSummary: invoice
        ? "Loading lifecycle from tip.status..."
        : "No invoice selected. Add ?invoice=<invoice-id> to this URL.",
      lifecycleSteps: initialLifecycle.steps,
      mappingRows: TIP_STATE_MAPPING,
      lastCheckedAt: null,
    });

    this._activeModel = model;

    if (invoice) {
      this._refreshLifecycle(model);
    }

    return model;
  }

  resetController(_controller, isExiting) {
    if (isExiting) {
      this._activeModel = null;
      this._clearPollTimer();
    }
  }

  async _refreshLifecycle(model) {
    if (!model || model !== this._activeModel) {
      return;
    }

    this._clearPollTimer();
    const loadingLifecycle = buildLifecycleModel(model.get("backendState"), { isPolling: true });

    model.setProperties({
      isLoading: true,
      isErrorState: false,
      errorMessage: null,
      lifecycleSteps: loadingLifecycle.steps,
    });

    try {
      const result = await getTipStatus({ invoice: model.get("invoice") });
      if (model !== this._activeModel) {
        return;
      }

      const nextLifecycle = buildLifecycleModel(result?.state, { isPolling: false });

      model.setProperties({
        isLoading: false,
        isErrorState: false,
        backendState: nextLifecycle.backendState,
        backendLabel: nextLifecycle.backendLabel,
        lifecycleSummary: nextLifecycle.summary,
        lifecycleSteps: nextLifecycle.steps,
        lastCheckedAt: new Date().toISOString(),
      });

      if (nextLifecycle.backendState === "UNPAID") {
        this._schedulePoll(model);
      }
    } catch (error) {
      if (model !== this._activeModel) {
        return;
      }

      const fallbackLifecycle = buildLifecycleModel(model.get("backendState"), { isPolling: false });

      model.setProperties({
        isLoading: false,
        isErrorState: true,
        errorMessage: error?.message ?? "Failed to load tip.status",
        lifecycleSummary: "Unable to read lifecycle state from tip.status.",
        lifecycleSteps: fallbackLifecycle.steps,
      });
    }
  }

  _schedulePoll(model) {
    this._clearPollTimer();
    this._pollTimer = setTimeout(() => {
      this._refreshLifecycle(model);
    }, POLL_INTERVAL_MS);
  }

  _clearPollTimer() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _invoiceFromLocation() {
    if (typeof window === "undefined") {
      return "";
    }

    try {
      return new URLSearchParams(window.location.search).get("invoice") || "";
    } catch {
      return "";
    }
  }

  _normalizeInvoice(value) {
    return typeof value === "string" ? value.trim() : "";
  }
}
