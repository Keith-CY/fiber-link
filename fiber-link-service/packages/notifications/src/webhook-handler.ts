import crypto from "node:crypto";
import type { NotificationChannelHandler, NotificationDispatchInput } from "./dispatcher";

export type WebhookDeliveryOptions = {
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

function signPayload(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function createWebhookChannelHandler(options: WebhookDeliveryOptions = {}): NotificationChannelHandler {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

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
        const snippet = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
        throw new Error(
          `Webhook delivery failed: HTTP ${response.status}${snippet ? ` — ${snippet}` : ""}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
