import type { NotificationChannelKind } from "@fiber-link/db";
import type { WithdrawalNotificationEvent } from "./notification-events";
import type { NotificationDispatchTarget, NotificationRepo } from "./notification-repo";

export type NotificationDispatchInput = {
  target: NotificationDispatchTarget;
  event: WithdrawalNotificationEvent;
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
};

export type CreateNotificationDispatcherOptions = {
  repo: Pick<NotificationRepo, "listDispatchTargets">;
  handlers?: Partial<Record<NotificationChannelKind, NotificationChannelHandler>>;
  onDispatchError?: (input: NotificationDispatchInput & { error: unknown }) => void;
};

const NOOP_CHANNEL_HANDLER: NotificationChannelHandler = async () => {
  return;
};

const DEFAULT_CHANNEL_HANDLERS: Record<NotificationChannelKind, NotificationChannelHandler> = {
  WEBHOOK: NOOP_CHANNEL_HANDLER,
};

export function createNoopNotificationDispatcher(): NotificationDispatcher {
  return {
    async dispatchWithdrawalEvent() {
      return {
        matched: 0,
        attempted: 0,
        delivered: 0,
        failed: 0,
      };
    },
  };
}

export function createNotificationDispatcher(options: CreateNotificationDispatcherOptions): NotificationDispatcher {
  const channelHandlers: Record<NotificationChannelKind, NotificationChannelHandler> = {
    ...DEFAULT_CHANNEL_HANDLERS,
    ...(options.handlers ?? {}),
  };

  return {
    async dispatchWithdrawalEvent(event) {
      const targets = await options.repo.listDispatchTargets(event.appId, event.type);
      let delivered = 0;
      let failed = 0;

      for (const target of targets) {
        try {
          await channelHandlers[target.kind]({ target, event });
          delivered += 1;
        } catch (error) {
          failed += 1;
          try {
            options.onDispatchError?.({ target, event, error });
          } catch {
            // Notifications are best-effort; secondary observer failures should not fan out.
          }
        }
      }

      return {
        matched: targets.length,
        attempted: targets.length,
        delivered,
        failed,
      };
    },
  };
}
