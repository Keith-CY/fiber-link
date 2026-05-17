import { afterEach, describe, expect, it, vi } from "vitest";
import { FiberRpcError, rpcCall } from "./fiber-client";

describe("rpcCall", () => {
  afterEach(() => {
    vi.useRealTimers();
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

    await expect(rpcCall("http://localhost:8119", "health", {}, { retryCount: 0 })).rejects.toBeInstanceOf(FiberRpcError);
    await expect(rpcCall("http://localhost:8119", "health", {}, { retryCount: 0 })).rejects.toMatchObject({
      code: 502,
      message: "Fiber RPC HTTP 502",
    });
  });

  it("retries transient HTTP failures", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "ok" }) } as Response);

    const pending = rpcCall("http://localhost:8119", "health", {}, { fetchFn, retryCount: 1, retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("aborts a stuck request after the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });

    const pending = expect(
      rpcCall("http://localhost:8119", "health", {}, { fetchFn, timeoutMs: 25, retryCount: 0 }),
    ).rejects.toMatchObject({ name: "FiberRpcTimeoutError" });
    await vi.advanceTimersByTimeAsync(25);

    await pending;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("retries timeouts", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "ok" }) } as Response);

    const pending = rpcCall("http://localhost:8119", "health", {}, { fetchFn, timeoutMs: 25, retryCount: 1, retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("propagates caller abort signals to the active fetch", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });

    const pending = rpcCall("http://localhost:8119", "health", {}, { fetchFn, signal: controller.signal });
    controller.abort(new Error("shutdown"));

    await expect(pending).rejects.toThrow("shutdown");
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("retries retryable network failures with bounded backoff", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "ok" }) } as Response);

    const pending = rpcCall("http://localhost:8119", "health", {}, { fetchFn, retryCount: 1, retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry JSON-RPC application errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: -32602, message: "invalid params" } }),
    } as Response);

    await expect(rpcCall("http://localhost:8119", "health", {}, { fetchFn, retryCount: 2 })).rejects.toMatchObject({
      name: "FiberRpcError",
      code: -32602,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
