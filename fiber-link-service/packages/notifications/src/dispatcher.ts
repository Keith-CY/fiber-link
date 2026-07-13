import type { NotificationChannelKind } from "@fiber-link/db";
import type { TipSettledNotificationEvent, WithdrawalNotificationEvent } from "./notification-events";
import type { NotificationDispatchTarget, NotificationRepo } from "./notification-repo";
import { createWebhookChannelHandler } from "./webhook-handler";

export type AnyNotificationEvent = WithdrawalNotificationEvent | TipSettledNotificationEvent;

export type NotificationDispatchInput = {
  target: NotificationDispatchTarget;
  event: AnyNotificationEvent;
};

export type NotificationChannelHandler = (input: NotificationDispatchInput) => Promise<void>;

export type NotificationDispatchSummary = {
  matched: number;
  attempted: number;
  delivered: number;
  failed: number;
};

export type NotificationDispatcher = {
  dispatchWithdrawalEvent(event: WithdrawalNotificationEvent): Promise<NotificationDispatchSummary>;
  dispatchTipSettledEvent(event: TipSettledNotificationEvent): Promise<NotificationDispatchSummary>;
};

export type CreateNotificationDispatcherOptions = {
  repo: Pick<NotificationRepo, "listDispatchTargets">;
  handlers?: Partial<Record<NotificationChannelKind, NotificationChannelHandler>>;
  onDispatchError?: (input: NotificationDispatchInput & { error: unknown }) => void;
};

const DEFAULT_CHANNEL_HANDLERS: Record<NotificationChannelKind, NotificationChannelHandler> = {
  WEBHOOK: createWebhookChannelHandler(),
};

async function dispatchEvent(
  event: AnyNotificationEvent,
  channelHandlers: Record<NotificationChannelKind, NotificationChannelHandler>,
  repo: Pick<NotificationRepo, "listDispatchTargets">,
  onDispatchError?: (input: NotificationDispatchInput & { error: unknown }) => void,
): Promise<NotificationDispatchSummary> {
  const targets = await repo.listDispatchTargets(event.appId, event.type);
  let delivered = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      await channelHandlers[target.kind]({ target, event });
      delivered += 1;
    } catch (error) {
      failed += 1;
      try {
        onDispatchError?.({ target, event, error });
      } catch {
        // Notifications are best-effort; secondary observer failures should not fan out.
      }
    }
  }

  return { matched: targets.length, attempted: targets.length, delivered, failed };
}

export function createNoopNotificationDispatcher(): NotificationDispatcher {
  const empty = { matched: 0, attempted: 0, delivered: 0, failed: 0 };
  return {
    async dispatchWithdrawalEvent() {
      return empty;
    },
    async dispatchTipSettledEvent() {
      return empty;
    },
  };
}

export function createNotificationDispatcher(options: CreateNotificationDispatcherOptions): NotificationDispatcher {
  const channelHandlers: Record<NotificationChannelKind, NotificationChannelHandler> = {
    ...DEFAULT_CHANNEL_HANDLERS,
    ...(options.handlers ?? {}),
  };

  return {
    dispatchWithdrawalEvent: (event) => dispatchEvent(event, channelHandlers, options.repo, options.onDispatchError),
    dispatchTipSettledEvent: (event) => dispatchEvent(event, channelHandlers, options.repo, options.onDispatchError),
  };
}
