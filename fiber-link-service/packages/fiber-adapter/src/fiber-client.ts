export class FiberRpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "FiberRpcError";
  }
}

export async function rpcCall(endpoint: string, method: string, params: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new FiberRpcError(`Fiber RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new FiberRpcError(payload.error.message ?? "Fiber RPC error", payload.error.code, payload.error.data);
  }

  return payload?.result;
}
