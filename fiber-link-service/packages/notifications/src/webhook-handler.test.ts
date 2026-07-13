import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { createWebhookChannelHandler } from "./webhook-handler";
import type { NotificationDispatchTarget } from "./notification-repo";
import type { TipSettledNotificationEvent, WithdrawalCompletedNotificationEvent, WithdrawalFailedNotificationEvent, WithdrawalRetryPendingNotificationEvent } from "./notification-events";

const BASE_TARGET: NotificationDispatchTarget = {
  ruleId: "rule-1",
  channelId: "ch-1",
  appId: "app-1",
  event: "WITHDRAWAL_COMPLETED",
  channelName: "my-hook",
  kind: "WEBHOOK",
  target: "https://example.com/hooks/test",
  secret: null,
};

const COMPLETED_EVENT: WithdrawalCompletedNotificationEvent = {
  type: "WITHDRAWAL_COMPLETED",
  occurredAt: new Date("2026-02-07T13:00:00.000Z"),
  appId: "app-1",
  userId: "user-1",
  withdrawalId: "wd-1",
  asset: "USDI",
  amount: "10.5",
  txHash: "0xdeadbeef",
};

describe("createWebhookChannelHandler", () => {
  it("POSTs JSON payload to the target URL", async () => {
    const requests: Request[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      requests.push(input as Request);
      return new Response(null, { status: 200 });
    });

    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });
    await handler({ target: BASE_TARGET, event: COMPLETED_EVENT });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hooks/test");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["x-fiber-link-event"]).toBe("WITHDRAWAL_COMPLETED");

    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("WITHDRAWAL_COMPLETED");
    expect(body.txHash).toBe("0xdeadbeef");
    expect(body.amount).toBe("10.5");
  });

  it("adds HMAC-SHA256 signature header when channel has a secret", async () => {
    const secret = "super-secret";
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));

    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });
    await handler({
      target: { ...BASE_TARGET, secret },
      event: COMPLETED_EVENT,
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sig = (init.headers as Record<string, string>)["x-fiber-link-signature"];
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(init.body as string).digest("hex");
    expect(sig).toBe(expected);
  });

  it("omits signature header when channel has no secret", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });
    await handler({ target: BASE_TARGET, event: COMPLETED_EVENT });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-fiber-link-signature"]).toBeUndefined();
  });

  it("throws when endpoint returns a non-2xx status", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("Not Found", { status: 404 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow("HTTP 404");
  });

  it("includes a response body snippet in the non-2xx error message", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"error":"invalid_token"}', { status: 401 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow(
      /HTTP 401.*invalid_token/,
    );
  });

  it("truncates long response bodies to 200 characters in the error message", async () => {
    const longBody = "x".repeat(500);
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(longBody, { status: 500 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow(
      /HTTP 500.*x{200}$/,
    );
  });

  it("includes retry-pending fields for WITHDRAWAL_RETRY_PENDING events", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    const event: WithdrawalRetryPendingNotificationEvent = {
      type: "WITHDRAWAL_RETRY_PENDING",
      occurredAt: new Date("2026-02-07T13:05:00.000Z"),
      appId: "app-1",
      userId: "user-1",
      withdrawalId: "wd-2",
      asset: "CKB",
      amount: "5",
      retryCount: 2,
      nextRetryAt: new Date("2026-02-07T13:10:00.000Z"),
      error: "node unreachable",
    };

    await handler({ target: { ...BASE_TARGET, event: "WITHDRAWAL_RETRY_PENDING" }, event });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.retryCount).toBe(2);
    expect(body.nextRetryAt).toBe("2026-02-07T13:10:00.000Z");
    expect(body.error).toBe("node unreachable");
  });

  it("includes error and retryCount for WITHDRAWAL_FAILED events", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    const event: WithdrawalFailedNotificationEvent = {
      type: "WITHDRAWAL_FAILED",
      occurredAt: new Date("2026-02-07T14:00:00.000Z"),
      appId: "app-1",
      userId: "user-1",
      withdrawalId: "wd-3",
      asset: "USDI",
      amount: "20",
      retryCount: 5,
      error: "max retries exceeded",
    };

    await handler({ target: { ...BASE_TARGET, event: "WITHDRAWAL_FAILED" }, event });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.retryCount).toBe(5);
    expect(body.error).toBe("max retries exceeded");
    expect(body.txHash).toBeUndefined();
  });

  it("serializes TIP_SETTLED events with tip fields and omits withdrawal fields", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch });

    const event: TipSettledNotificationEvent = {
      type: "TIP_SETTLED",
      occurredAt: new Date("2026-02-07T15:00:00.000Z"),
      appId: "app-1",
      toUserId: "author-1",
      fromUserId: "tipper-1",
      postId: "post-42",
      invoice: "fibt1qxyz",
      asset: "CKB",
      amount: "7",
    };

    await handler({ target: { ...BASE_TARGET, event: "TIP_SETTLED" }, event });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-fiber-link-event"]).toBe("TIP_SETTLED");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: "TIP_SETTLED",
      occurredAt: "2026-02-07T15:00:00.000Z",
      appId: "app-1",
      toUserId: "author-1",
      fromUserId: "tipper-1",
      postId: "post-42",
      invoice: "fibt1qxyz",
      asset: "CKB",
      amount: "7",
    });
    // Withdrawal-only fields must not leak into a tip payload.
    expect(body.withdrawalId).toBeUndefined();
    expect(body.userId).toBeUndefined();
    expect(body.txHash).toBeUndefined();
  });

  it("aborts and throws when the endpoint does not respond within timeoutMs", async () => {
    const mockFetch = vi.fn(
      (_, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );

    const handler = createWebhookChannelHandler({
      fetch: mockFetch as unknown as typeof fetch,
      timeoutMs: 1,
    });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow();
  });
});
