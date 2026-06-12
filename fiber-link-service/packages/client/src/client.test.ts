import { describe, expect, it, vi, beforeEach } from "vitest";
import { FiberLinkClient } from "./client";
import { FiberLinkValidationError, FiberLinkResponseError, FiberLinkNetworkError } from "./errors";

function makeClient(overrides: Partial<ConstructorParameters<typeof FiberLinkClient>[0]> = {}) {
  return new FiberLinkClient({
    endpoint: "http://localhost:3000/rpc",
    mode: "presigned",
    ...overrides,
  });
}

const FAKE_INVOICE = "lnbc1000000n1pj9...fakeinvoice";

describe("FiberLinkClient constructor", () => {
  it("throws when endpoint is missing", () => {
    expect(() => new FiberLinkClient({ endpoint: "", mode: "presigned" })).toThrow(FiberLinkValidationError);
  });

  it("throws when signed mode lacks appId", () => {
    expect(
      () => new FiberLinkClient({ endpoint: "http://x", mode: "signed", hmacSecret: "s" }),
    ).toThrow(FiberLinkValidationError);
  });

  it("throws when signed mode lacks hmacSecret", () => {
    expect(
      () => new FiberLinkClient({ endpoint: "http://x", mode: "signed", appId: "a" }),
    ).toThrow(FiberLinkValidationError);
  });

  it("constructs successfully in presigned mode", () => {
    expect(() => makeClient()).not.toThrow();
  });

  it("constructs successfully in signed mode with all fields", () => {
    expect(
      () => new FiberLinkClient({ endpoint: "http://x", mode: "signed", appId: "a", hmacSecret: "s" }),
    ).not.toThrow();
  });
});

describe("FiberLinkClient#createTip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct RPC payload and returns invoice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { invoice: FAKE_INVOICE } }),
      }),
    );

    const client = makeClient();
    const result = await client.createTip({
      postId: "10",
      fromUserId: "1",
      toUserId: "2",
      amount: "5",
    });

    expect(result.invoice).toBe(FAKE_INVOICE);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.method).toBe("tip.create");
    expect(body.params.amount).toBe("5");
    expect(body.params.asset).toBe("CKB");
  });

  it("throws FiberLinkValidationError on missing postId", async () => {
    const client = makeClient();
    await expect(
      client.createTip({ postId: "", fromUserId: "1", toUserId: "2", amount: "5" }),
    ).rejects.toThrow(FiberLinkValidationError);
  });

  it("throws FiberLinkValidationError on zero amount", async () => {
    const client = makeClient();
    await expect(
      client.createTip({ postId: "1", fromUserId: "1", toUserId: "2", amount: "0" }),
    ).rejects.toThrow(FiberLinkValidationError);
  });

  it("throws FiberLinkResponseError on RPC error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: -32602, message: "Invalid params" } }),
      }),
    );

    const client = makeClient();
    await expect(
      client.createTip({ postId: "1", fromUserId: "1", toUserId: "2", amount: "1" }),
    ).rejects.toThrow(FiberLinkResponseError);
  });

  it("throws FiberLinkNetworkError on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));

    const client = makeClient();
    await expect(
      client.createTip({ postId: "1", fromUserId: "1", toUserId: "2", amount: "1" }),
    ).rejects.toThrow(FiberLinkNetworkError);
  });
});

describe("FiberLinkClient#getTipStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns SETTLED state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { state: "SETTLED" } }),
      }),
    );

    const client = makeClient();
    const result = await client.getTipStatus(FAKE_INVOICE);
    expect(result.state).toBe("SETTLED");
  });

  it("sends tip.status method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { state: "UNPAID" } }),
      }),
    );

    const client = makeClient();
    await client.getTipStatus(FAKE_INVOICE);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.method).toBe("tip.status");
    expect(body.params.invoice).toBe(FAKE_INVOICE);
  });

  it("throws FiberLinkValidationError on empty invoice", async () => {
    const client = makeClient();
    await expect(client.getTipStatus("")).rejects.toThrow(FiberLinkValidationError);
  });
});

describe("FiberLinkClient#streamTipStatus", () => {
  it("returns null when EventSource is not available", () => {
    const originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    delete (globalThis as Record<string, unknown>).EventSource;

    const client = makeClient();
    const handle = client.streamTipStatus(FAKE_INVOICE, vi.fn());
    expect(handle).toBeNull();

    (globalThis as Record<string, unknown>).EventSource = originalEventSource;
  });

  it("throws FiberLinkValidationError on empty invoice", () => {
    const client = makeClient();
    expect(() => client.streamTipStatus("", vi.fn())).toThrow(FiberLinkValidationError);
  });

  it("appends the appId query param in signed mode so the server can check ownership", () => {
    const seenUrls: string[] = [];
    class FakeEventSource {
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor(url: string) {
        seenUrls.push(url);
      }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    try {
      const signedClient = makeClient({ mode: "signed", appId: "app1", hmacSecret: "s" });
      const handle = signedClient.streamTipStatus(FAKE_INVOICE, vi.fn());
      expect(handle).not.toBeNull();
      expect(seenUrls[0]).toBe(
        `http://localhost:3000/rpc/stream?invoice=${encodeURIComponent(FAKE_INVOICE)}&appId=app1`,
      );
      handle?.close();

      const presignedClient = makeClient();
      presignedClient.streamTipStatus(FAKE_INVOICE, vi.fn())?.close();
      expect(seenUrls[1]).toBe(
        `http://localhost:3000/rpc/stream?invoice=${encodeURIComponent(FAKE_INVOICE)}`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("FiberLinkClient signed mode header generation", () => {
  it("includes x-app-id, x-ts, x-nonce, x-signature headers in signed mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { state: "UNPAID" } }),
      }),
    );

    const client = new FiberLinkClient({
      endpoint: "http://localhost:3000/rpc",
      mode: "signed",
      appId: "test-app",
      hmacSecret: "test-secret",
    });

    await client.getTipStatus(FAKE_INVOICE);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["x-app-id"]).toBe("test-app");
    expect(headers["x-ts"]).toMatch(/^\d+$/);
    expect(headers["x-nonce"]).toBeTruthy();
    expect(headers["x-signature"]).toMatch(/^[0-9a-f]+$/);
  });
});
