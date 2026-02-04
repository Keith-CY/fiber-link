function buildRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function csrfToken() {
  const el = document.querySelector("meta[name=\"csrf-token\"]");
  return el ? el.getAttribute("content") : "";
}

export async function createTip({ amount, asset }) {
  return fetch("/fiber-link/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: buildRequestId(),
      method: "tip.create",
      params: { amount, asset },
    }),
  }).then((r) => r.json());
}
