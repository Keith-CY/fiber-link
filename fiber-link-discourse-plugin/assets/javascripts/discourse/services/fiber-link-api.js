export async function createTip({ amount, asset }) {
  return fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tip.create", params: { amount, asset } })
  }).then((r) => r.json());
}
