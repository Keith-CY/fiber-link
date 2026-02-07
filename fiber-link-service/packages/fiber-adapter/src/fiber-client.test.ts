import { afterEach, describe, expect, it, vi } from "vitest";
import { FiberRpcError, rpcCall } from "./fiber-client";

describe("rpcCall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws FiberRpcError on non-2xx response even when body is not json", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as Response);

    await expect(rpcCall("http://localhost:8119", "health", {})).rejects.toBeInstanceOf(FiberRpcError);
    await expect(rpcCall("http://localhost:8119", "health", {})).rejects.toThrow("Fiber RPC HTTP 502");
  });
});
