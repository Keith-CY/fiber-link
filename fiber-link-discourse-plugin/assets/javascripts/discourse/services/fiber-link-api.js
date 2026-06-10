/**
 * Fiber Link API service for the Discourse plugin.
 *
 * Implements the same interface as @fiber-link/client in "presigned" mode:
 * the Discourse Ruby proxy handles HMAC signing server-side; this module
 * only handles request shaping, response parsing, and SSE streaming.
 *
 * For non-Discourse platform integrations use the @fiber-link/client npm
 * package directly (supports both "signed" and "presigned" modes).
 */
import { ajax } from "discourse/lib/ajax";

const DEFAULT_RPC_PATH = "/fiber-link/rpc";
const DEFAULT_RPC_TIMEOUT_MS = 15000;

const runtimeConfig = {
  initialized: false,
  rpcPath: DEFAULT_RPC_PATH,
};

export function configureFiberLinkApi(config = {}) {
  if (typeof config.rpcPath === "string" && config.rpcPath.trim()) {
    runtimeConfig.rpcPath = config.rpcPath.trim();
  } else {
    runtimeConfig.rpcPath = DEFAULT_RPC_PATH;
  }
  runtimeConfig.initialized = true;
  return getFiberLinkApiRuntime();
}

export function getFiberLinkApiRuntime() {
  return { ...runtimeConfig };
}

function assertInitialized() {
  if (runtimeConfig.initialized) {
    return;
  }
  throw new Error("Fiber Link API runtime is not initialized");
}

function buildRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Core RPC call — delegates auth to the Discourse proxy (presigned mode).
// Mirrors FiberLinkClient#rpcCall from @fiber-link/client.
// ---------------------------------------------------------------------------
async function rpcCall(method, params = {}) {
  assertInitialized();
  let data;

  try {
    data = await ajax(runtimeConfig.rpcPath, {
      type: "POST",
      contentType: "application/json",
      dataType: "json",
      timeout: DEFAULT_RPC_TIMEOUT_MS,
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: buildRequestId(),
        method,
        params,
      }),
    });
  } catch (error) {
    const statusText =
      typeof error?.statusText === "string" ? error.statusText : "";
    const responseText =
      typeof error?.responseText === "string" ? error.responseText : "";
    const status = Number(error?.status);

    if (statusText.toLowerCase() === "timeout") {
      throw new Error(
        `Fiber Link request timed out after ${DEFAULT_RPC_TIMEOUT_MS / 1000}s. Please retry.`,
      );
    }
    if (status === 429) {
      throw new Error(
        "Fiber Link is rate limiting requests. Please wait a moment and retry.",
      );
    }
    if (status >= 500) {
      throw new Error(
        "Fiber Link service is temporarily unavailable. Please retry in a moment.",
      );
    }

    throw new Error(
      responseText ||
        error?.message ||
        "Fiber Link request failed. Please retry.",
    );
  }
  if (data?.error) {
    throw data.error;
  }
  return data?.result;
}

// ---------------------------------------------------------------------------
// Public API — mirrors FiberLinkClient methods from @fiber-link/client.
// ---------------------------------------------------------------------------

export async function createTip({
  amount,
  asset,
  postId,
  fromUserId,
  toUserId,
  message,
}) {
  return rpcCall("tip.create", {
    amount,
    asset,
    postId,
    fromUserId,
    toUserId,
    message,
  });
}

export async function getTipStatus({ invoice }) {
  return rpcCall("tip.status", { invoice });
}

export async function getDashboardSummary({
  limit = 20,
  includeAdmin = false,
  filters = {},
} = {}) {
  return rpcCall("dashboard.summary", { limit, includeAdmin, filters });
}

export async function quoteWithdrawal({ amount, asset = "CKB", destination }) {
  return rpcCall("withdrawal.quote", {
    amount,
    asset,
    destination,
  });
}

export async function requestWithdrawal({
  amount,
  asset = "CKB",
  destination,
}) {
  return rpcCall("withdrawal.request", {
    amount,
    asset,
    destination,
  });
}

export async function getDashboardAnalytics({ range = "30d" } = {}) {
  return rpcCall("dashboard.analytics", { range });
}

export function streamTipStatus(invoice, onEvent) {
  assertInitialized();

  if (typeof EventSource === "undefined") {
    return null;
  }

  const streamPath = runtimeConfig.rpcPath + "/stream";
  const url = `${streamPath}?invoice=${encodeURIComponent(invoice)}`;

  let es;
  try {
    es = new EventSource(url, { withCredentials: true });
  } catch {
    return null;
  }

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data && typeof data === "object" && data.status) {
        onEvent(data);
        if (data.status === "SETTLED" || data.status === "TIMEOUT") {
          es.close();
        }
      }
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    es.close();
    onEvent({ invoice, status: "SSE_ERROR" });
  };

  return {
    close() {
      es.close();
    },
  };
}
