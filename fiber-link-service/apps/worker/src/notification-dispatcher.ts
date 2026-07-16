import { createDbClient, createDbNotificationDeliveryLogRepo } from "@fiber-link/db";
import {
  type NotificationDispatcher,
  createDbNotificationRepo,
  createNoopNotificationDispatcher,
  createNotificationDispatcher,
  createWebhookChannelHandler,
} from "@fiber-link/notifications";

let defaultDispatcher: NotificationDispatcher | null = null;

/**
 * Shared default dispatcher for every worker path that emits notification
 * events (tip settlement and withdrawal processing). Webhook deliveries retry
 * with backoff and every attempt is appended to notification_delivery_log so
 * operators and creators can audit what was sent where.
 */
export function getDefaultNotificationDispatcher(): NotificationDispatcher {
  if (defaultDispatcher) {
    return defaultDispatcher;
  }

  if (!process.env.DATABASE_URL) {
    defaultDispatcher = createNoopNotificationDispatcher();
    return defaultDispatcher;
  }

  try {
    const db = createDbClient();
    const repo = createDbNotificationRepo(db);
    const deliveryLog = createDbNotificationDeliveryLogRepo(db);
    defaultDispatcher = createNotificationDispatcher({
      repo,
      handlers: {
        WEBHOOK: createWebhookChannelHandler({
          onAttempt: async (attempt) => {
            await deliveryLog.log({
              channelId: attempt.target.channelId,
              event: attempt.event.type,
              payloadHash: attempt.payloadHash,
              attempt: attempt.attempt,
              status: attempt.status,
              error: attempt.error ?? null,
            });
          },
        }),
      },
    });
  } catch {
    defaultDispatcher = createNoopNotificationDispatcher();
  }
  return defaultDispatcher;
}

export function __resetDefaultNotificationDispatcherForTests(): void {
  defaultDispatcher = null;
}
