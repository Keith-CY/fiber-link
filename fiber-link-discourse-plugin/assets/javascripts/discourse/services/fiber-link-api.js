import { ajax } from "discourse/lib/ajax";

function buildRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createTip({ amount, asset, postId }) {
  const data = await ajax("/fiber-link/rpc", {
    type: "POST",
    contentType: "application/json",
    dataType: "json",
    data: JSON.stringify({
      jsonrpc: "2.0",
      id: buildRequestId(),
      method: "tip.create",
      params: { amount, asset, postId },
    }),
  });
  if (data?.error) throw data.error;
  return data?.result;
}

export async function getTipStatus({ invoice }) {
  const data = await ajax("/fiber-link/rpc", {
    type: "POST",
    contentType: "application/json",
    dataType: "json",
    data: JSON.stringify({
      jsonrpc: "2.0",
      id: buildRequestId(),
      method: "tip.status",
      params: { invoice },
    }),
  });
  if (data?.error) throw data.error;
  return data?.result;
}
