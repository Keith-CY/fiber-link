import { asc, eq } from "drizzle-orm";
import { createDbClient, notificationChannels, notificationRules } from "@fiber-link/db";
import { createDbNotificationRepo, type NotificationChannelRecord } from "@fiber-link/notifications";
import type { z } from "zod";
import type { NotificationChannelCreateParamsSchema } from "../contracts";

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
  const repo = createDbNotificationRepo(db);

  const channel = await repo.createChannel({ appId, name, kind, target, secret: secret ?? null });

  await Promise.all(
    events.map((event) => repo.createRule({ appId, channelId: channel.id, event: event as any })),
  );

  return serializeChannel(channel, events);
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
          { id: row.id, name: row.name, kind: row.kind, target: row.target, enabled: row.enabled, createdAt: row.createdAt },
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
