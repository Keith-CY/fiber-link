import crypto from "node:crypto";
import type { NotificationChannelHandler, NotificationDispatchInput } from "./dispatcher";

export type WebhookDeliveryOptions = {
  /** Maximum time in milliseconds to wait for the webhook endpoint to respond. */
  timeoutMs?: number;
  /** Custom fetch implementation, defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Sign the payload with the channel secret using HMAC-SHA256 so the receiver
 * can verify the request originated from Fiber Link. The signature is placed
 * in the `X-Fiber-Link-Signature` header as `sha256=<hex>`.
 */
function signPayload(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
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

  return async function webhookChannelHandler({ target, event }: NotificationDispatchInput): Promise<void> {
    const body = JSON.stringify({
      event: event.type,
      occurredAt: event.occurredAt.toISOString(),
      appId: event.appId,
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
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-fiber-link-event": event.type,
    };

    if (target.secret) {
      headers["x-fiber-link-signature"] = signPayload(target.secret, body);
    }

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
        throw new Error(`Webhook delivery failed: HTTP ${response.status} from ${target.target}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
