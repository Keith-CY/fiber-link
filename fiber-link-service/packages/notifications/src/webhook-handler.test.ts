import crypto from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TipSettledNotificationEvent,
  WithdrawalCompletedNotificationEvent,
  WithdrawalFailedNotificationEvent,
  WithdrawalRetryPendingNotificationEvent,
} from "./notification-events";
import type { NotificationDispatchTarget } from "./notification-repo";
import { createWebhookChannelHandler } from "./webhook-handler";

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

    const expected = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(init.body as string)
      .digest("hex")}`;
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
    // maxAttempts: 1 — these cases assert error shaping, not retry policy.
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch, maxAttempts: 1 });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow("HTTP 404");
  });

  it("includes a response body snippet in the non-2xx error message", async () => {
    const mockFetch = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"error":"invalid_token"}', { status: 401 }),
    );
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch, maxAttempts: 1 });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow(/HTTP 401.*invalid_token/);
  });

  it("truncates long response bodies to 200 characters in the error message", async () => {
    const longBody = "x".repeat(500);
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(longBody, { status: 500 }));
    const handler = createWebhookChannelHandler({ fetch: mockFetch as unknown as typeof fetch, maxAttempts: 1 });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow(/HTTP 500.*x{200}$/);
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
      maxAttempts: 1,
      timeoutMs: 1,
    });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow();
  });
});

describe("createWebhookChannelHandler retry and delivery log", () => {
  it("retries with backoff, logs every attempt, and succeeds", async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? new Response("boom", { status: 500 }) : new Response(null, { status: 200 });
    });
    const sleeps: number[] = [];
    const attempts: Array<{ attempt: number; status: string; error?: string; payloadHash: string }> = [];

    const handler = createWebhookChannelHandler({
      fetch: mockFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onAttempt: async (a) => {
        attempts.push({ attempt: a.attempt, status: a.status, error: a.error, payloadHash: a.payloadHash });
      },
    });

    await handler({ target: BASE_TARGET, event: COMPLETED_EVENT });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1_000, 4_000]);
    expect(attempts.map((a) => [a.attempt, a.status])).toEqual([
      [1, "FAILED"],
      [2, "FAILED"],
      [3, "DELIVERED"],
    ]);
    expect(attempts[0].error).toMatch(/HTTP 500/);
    // Same payload across attempts: identical hash correlates the trail.
    expect(new Set(attempts.map((a) => a.payloadHash)).size).toBe(1);
    expect(attempts[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws the last error after exhausting retries", async () => {
    const mockFetch = vi.fn(async () => new Response("nope", { status: 503 }));
    const attempts: string[] = [];

    const handler = createWebhookChannelHandler({
      fetch: mockFetch as unknown as typeof fetch,
      sleep: async () => {},
      onAttempt: (a) => {
        attempts.push(a.status);
      },
    });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).rejects.toThrow("HTTP 503");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(attempts).toEqual(["FAILED", "FAILED", "FAILED"]);
  });

  it("swallows delivery-log observer failures without affecting delivery", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const handler = createWebhookChannelHandler({
      fetch: mockFetch as unknown as typeof fetch,
      onAttempt: () => {
        throw new Error("log db down");
      },
    });

    await expect(handler({ target: BASE_TARGET, event: COMPLETED_EVENT })).resolves.toBeUndefined();
  });
});

describe("createWebhookChannelHandler redirect handling", () => {
  type LocalServer = { url: string; requests: string[]; close: () => Promise<void> };

  async function startServer(respond: (res: ServerResponse) => void): Promise<LocalServer> {
    const requests: string[] = [];
    const server = createServer((req: IncomingMessage, res) => {
      requests.push(`${req.method} ${req.url}`);
      req.resume();
      req.on("end", () => respond(res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      requests,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  const servers: LocalServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("does not follow a redirect to an internal host and fails the delivery", async () => {
    const internal = await startServer((res) => {
      res.writeHead(500).end("internal-secret-data");
    });
    servers.push(internal);
    const redirector = await startServer((res) => {
      res.writeHead(307, { location: `${internal.url}/admin` }).end();
    });
    servers.push(redirector);
    const errors: (string | undefined)[] = [];

    // Real global fetch against real sockets: a mocked fetch cannot prove
    // whether redirects are followed.
    const handler = createWebhookChannelHandler({
      sleep: async () => {},
      onAttempt: (a) => {
        errors.push(a.error);
      },
    });

    await expect(
      handler({
        target: { ...BASE_TARGET, target: `${redirector.url}/hook`, secret: "s3cret" },
        event: COMPLETED_EVENT,
      }),
    ).rejects.toThrow(`HTTP 307 redirect from ${redirector.url}/hook; redirects are not followed`);
    expect(internal.requests).toEqual([]);
    expect(redirector.requests).toEqual(["POST /hook", "POST /hook", "POST /hook"]);
    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(error).not.toContain("internal-secret-data");
      expect(error).not.toContain(internal.url);
    }
  });

  it("still delivers to a target that responds 200", async () => {
    const receiver = await startServer((res) => {
      res.writeHead(200).end("ok");
    });
    servers.push(receiver);

    const handler = createWebhookChannelHandler({ sleep: async () => {} });
    await expect(
      handler({ target: { ...BASE_TARGET, target: `${receiver.url}/hook` }, event: COMPLETED_EVENT }),
    ).resolves.toBeUndefined();
    expect(receiver.requests).toEqual(["POST /hook"]);
  });
});
