import { ajax } from "discourse/lib/ajax";

const DEFAULT_RPC_PATH = "/fiber-link/rpc";

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

async function rpcCall(method, params = {}) {
  assertInitialized();
  const data = await ajax(runtimeConfig.rpcPath, {
    type: "POST",
    contentType: "application/json",
    dataType: "json",
    data: JSON.stringify({
      jsonrpc: "2.0",
      id: buildRequestId(),
      method,
      params,
    }),
  });
  if (data?.error) throw data.error;
  return data?.result;
}

export async function createTip({ amount, asset, postId }) {
  return rpcCall("tip.create", { amount, asset, postId });
}

export async function getTipStatus({ invoice }) {
  return rpcCall("tip.status", { invoice });
}

export async function getDashboardSummary({ limit = 20, includeAdmin = false, filters = {} } = {}) {
  return rpcCall("dashboard.summary", { limit, includeAdmin, filters });
}
