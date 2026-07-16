import { randomUUID } from "node:crypto";
import { createDbClient, notificationChannels, notificationRules } from "@fiber-link/db";
import {
  type NotificationChannelHandler,
  type NotificationChannelRecord,
  createDbNotificationRepo,
  createWebhookChannelHandler,
} from "@fiber-link/notifications";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { NotificationChannelCreateParamsSchema } from "../contracts";

export class NotificationChannelNotFoundError extends Error {
  constructor(channelId: string) {
    super(`Notification channel not found: ${channelId}`);
    this.name = "NotificationChannelNotFoundError";
  }
}

type CreateParams = z.infer<typeof NotificationChannelCreateParamsSchema> & { appId: string };

let defaultDb: ReturnType<typeof createDbClient> | null = null;
function getDefaultDb() {
  if (!defaultDb) defaultDb = createDbClient();
  return defaultDb;
}

function serializeChannel(
  channel: Pick<NotificationChannelRecord, "id" | "name" | "kind" | "target" | "enabled" | "createdAt">,
  events: string[],
) {
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    target: channel.target,
    enabled: channel.enabled,
    events,
    createdAt: channel.createdAt.toISOString(),
  };
}

export async function handleNotificationChannelCreate({ appId, name, kind, target, secret, events }: CreateParams) {
  const db = getDefaultDb();

  return db.transaction(async (tx) => {
    const repo = createDbNotificationRepo(tx);
    const channel = await repo.createChannel({ appId, name, kind, target, secret: secret ?? null });

    await Promise.all(events.map((event) => repo.createRule({ appId, channelId: channel.id, event: event as any })));

    return serializeChannel(channel, events);
  });
}

export async function handleNotificationChannelList({ appId }: { appId: string }) {
  const db = getDefaultDb();

  const rows = await db
    .select({
      id: notificationChannels.id,
      name: notificationChannels.name,
      kind: notificationChannels.kind,
      target: notificationChannels.target,
      enabled: notificationChannels.enabled,
      createdAt: notificationChannels.createdAt,
      event: notificationRules.event,
    })
    .from(notificationChannels)
    .leftJoin(notificationRules, eq(notificationRules.channelId, notificationChannels.id))
    .where(eq(notificationChannels.appId, appId))
    .orderBy(asc(notificationChannels.createdAt), asc(notificationChannels.id));

  const channelMap = new Map<string, ReturnType<typeof serializeChannel>>();

  for (const row of rows) {
    if (!channelMap.has(row.id)) {
      channelMap.set(
        row.id,
        serializeChannel(
          {
            id: row.id,
            name: row.name,
            kind: row.kind,
            target: row.target,
            enabled: row.enabled,
            createdAt: row.createdAt,
          },
          [],
        ),
      );
    }
    if (row.event) {
      channelMap.get(row.id)!.events.push(row.event);
    }
  }

  return { channels: Array.from(channelMap.values()) };
}

export async function handleNotificationChannelDelete(
  { appId, channelId }: { appId: string; channelId: string },
  options: { db?: ReturnType<typeof createDbClient> } = {},
) {
  const db = options.db ?? getDefaultDb();

  // Soft-disable rather than hard-delete: the delivery log keeps its FK
  // target and the channel can be re-enabled by support if needed.
  const [row] = await db
    .update(notificationChannels)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.appId, appId)))
    .returning({ id: notificationChannels.id, enabled: notificationChannels.enabled });

  if (!row) {
    throw new NotificationChannelNotFoundError(channelId);
  }

  return { id: row.id, disabled: !row.enabled };
}

export async function handleNotificationChannelTest(
  { appId, channelId }: { appId: string; channelId: string },
  options: { db?: ReturnType<typeof createDbClient>; handler?: NotificationChannelHandler } = {},
) {
  const db = options.db ?? getDefaultDb();

  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.appId, appId)))
    .limit(1);

  if (!channel || !channel.enabled) {
    throw new NotificationChannelNotFoundError(channelId);
  }

  // Single attempt with a short timeout: the caller is waiting on the result.
  const handler = options.handler ?? createWebhookChannelHandler({ maxAttempts: 1, timeoutMs: 5_000 });

  try {
    await handler({
      target: {
        ruleId: "synthetic-test",
        channelId: channel.id,
        appId,
        event: "TIP_SETTLED",
        channelName: channel.name,
        kind: channel.kind,
        target: channel.target,
        secret: channel.secret,
      },
      event: {
        type: "TIP_SETTLED",
        occurredAt: new Date(),
        appId,
        toUserId: "fiber-link-test",
        fromUserId: "fiber-link-test",
        postId: "fiber-link-test",
        invoice: `test-${randomUUID()}`,
        asset: "CKB",
        amount: "0",
      },
    });
    return { delivered: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { delivered: false, error: message.slice(0, 200) };
  }
}
