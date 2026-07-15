import crypto from "node:crypto";
import type { NotificationChannelHandler, NotificationDispatchInput } from "./dispatcher";

export type WebhookDeliveryAttempt = {
  target: NotificationDispatchInput["target"];
  event: NotificationDispatchInput["event"];
  /** 1-based attempt counter. */
  attempt: number;
  status: "DELIVERED" | "FAILED";
  /** SHA-256 hex of the delivered body — correlates attempts without storing payloads. */
  payloadHash: string;
  error?: string;
};

export type WebhookDeliveryOptions = {
  /** Maximum time in milliseconds to wait for the webhook endpoint to respond. */
  timeoutMs?: number;
  /** Custom fetch implementation, defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Total attempts per delivery (default 3). */
  maxAttempts?: number;
  /** Backoff before retry N+1, in ms (default [1s, 4s, 16s]). */
  retryDelaysMs?: number[];
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Observer invoked after every attempt (delivered or failed) — used to
   * persist the notification delivery log. Observer failures are swallowed:
   * logging must never affect delivery semantics.
   */
  onAttempt?: (attempt: WebhookDeliveryAttempt) => void | Promise<void>;
};

const DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sign the payload with the channel secret using HMAC-SHA256 so the receiver
 * can verify the request originated from Fiber Link. The signature is placed
 * in the `X-Fiber-Link-Signature` header as `sha256=<hex>`.
 */
function signPayload(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Build a webhook notification handler that POSTs the event as JSON to the
 * channel's target URL.
 *
 * If the channel has a `secret` configured, every request includes an
 * `X-Fiber-Link-Signature` header containing an HMAC-SHA256 signature of the
 * request body so receivers can authenticate the payload.
 *
 * Non-2xx responses and network errors are treated as delivery failures and
 * will increment the `failed` counter in the dispatch summary.
 */
export function createWebhookChannelHandler(options: WebhookDeliveryOptions = {}): NotificationChannelHandler {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;

  return async function webhookChannelHandler({ target, event }: NotificationDispatchInput): Promise<void> {
    const body = JSON.stringify({
      event: event.type,
      occurredAt: event.occurredAt.toISOString(),
      appId: event.appId,
      ...(event.type === "TIP_SETTLED"
        ? {
            toUserId: event.toUserId,
            fromUserId: event.fromUserId,
            postId: event.postId,
            invoice: event.invoice,
            asset: event.asset,
            amount: event.amount,
          }
        : {
            userId: event.userId,
            withdrawalId: event.withdrawalId,
            asset: event.asset,
            amount: event.amount,
            ...(event.type === "WITHDRAWAL_COMPLETED" && { txHash: event.txHash }),
            ...(event.type === "WITHDRAWAL_RETRY_PENDING" && {
              retryCount: event.retryCount,
              nextRetryAt: event.nextRetryAt.toISOString(),
              error: event.error,
            }),
            ...(event.type === "WITHDRAWAL_FAILED" && {
              retryCount: event.retryCount,
              error: event.error,
            }),
          }),
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-fiber-link-event": event.type,
    };

    if (target.secret) {
      headers["x-fiber-link-signature"] = signPayload(target.secret, body);
    }

    const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

    const recordAttempt = async (attempt: number, status: "DELIVERED" | "FAILED", error?: string) => {
      try {
        await options.onAttempt?.({ target, event, attempt, status, payloadHash, error });
      } catch {
        // The delivery log is an audit trail; its failures never alter delivery.
      }
    };

    const attemptOnce = async (): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(target.target, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          // Read only the first chunk of the error body: a misconfigured
          // endpoint could return an arbitrarily large response, and
          // response.text() would buffer all of it in the worker.
          let snippet = "";
          try {
            const reader = response.body?.getReader();
            if (reader) {
              const { value } = await reader.read();
              if (value) {
                snippet = new TextDecoder().decode(value).slice(0, 200);
              }
              await reader.cancel().catch(() => {});
            }
          } catch {
            // No snippet if the stream is unreadable; the status code stands alone.
          }
          throw new Error(
            `Webhook delivery failed: HTTP ${response.status} from ${target.target}${snippet ? ` — ${snippet}` : ""}`,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await attemptOnce();
        await recordAttempt(attempt, "DELIVERED");
        return;
      } catch (error) {
        lastError = error;
        await recordAttempt(attempt, "FAILED", error instanceof Error ? error.message : String(error));
        if (attempt < maxAttempts) {
          await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0);
        }
      }
    }
    // Exhausted retries: surface the failure so the dispatch summary counts it.
    // Settlement/withdrawal processing never blocks on this (the dispatcher
    // catches per-target errors).
    throw lastError;
  };
}
