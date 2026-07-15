import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DbClient } from "./client";
import { type NotificationDeliveryStatus, notificationDeliveryLog } from "./schema";

export type NotificationDeliveryEvent = (typeof notificationDeliveryLog.event.enumValues)[number];

export type LogNotificationDeliveryInput = {
  channelId: string;
  event: NotificationDeliveryEvent;
  payloadHash: string;
  attempt: number;
  status: NotificationDeliveryStatus;
  error?: string | null;
};

export type NotificationDeliveryLogRecord = LogNotificationDeliveryInput & {
  id: string;
  error: string | null;
  createdAt: Date;
};

export type NotificationDeliveryLogRepo = {
  /** Append one delivery attempt. Never throws into the caller's control flow decisions. */
  log(input: LogNotificationDeliveryInput): Promise<NotificationDeliveryLogRecord>;
  /** Most recent attempts for a channel, newest first. */
  listRecentByChannel(channelId: string, limit?: number): Promise<NotificationDeliveryLogRecord[]>;
  __resetForTests?: () => void;
};

type Row = typeof notificationDeliveryLog.$inferSelect;

function toRecord(row: Row): NotificationDeliveryLogRecord {
  return {
    id: row.id,
    channelId: row.channelId,
    event: row.event,
    payloadHash: row.payloadHash,
    attempt: row.attempt,
    status: row.status,
    error: row.error ?? null,
    createdAt: row.createdAt,
  };
}

export function createDbNotificationDeliveryLogRepo(db: DbClient): NotificationDeliveryLogRepo {
  return {
    async log(input) {
      const [row] = await db
        .insert(notificationDeliveryLog)
        .values({
          channelId: input.channelId,
          event: input.event,
          payloadHash: input.payloadHash,
          attempt: input.attempt,
          status: input.status,
          error: input.error ?? null,
        })
        .returning();
      return toRecord(row);
    },

    async listRecentByChannel(channelId, limit = 50) {
      const rows = await db
        .select()
        .from(notificationDeliveryLog)
        .where(eq(notificationDeliveryLog.channelId, channelId))
        .orderBy(desc(notificationDeliveryLog.createdAt), desc(notificationDeliveryLog.id))
        .limit(limit);
      return rows.map(toRecord);
    },
  };
}

export function createInMemoryNotificationDeliveryLogRepo(): NotificationDeliveryLogRepo {
  let records: NotificationDeliveryLogRecord[] = [];

  return {
    async log(input) {
      const record: NotificationDeliveryLogRecord = {
        id: randomUUID(),
        channelId: input.channelId,
        event: input.event,
        payloadHash: input.payloadHash,
        attempt: input.attempt,
        status: input.status,
        error: input.error ?? null,
        createdAt: new Date(),
      };
      records.push(record);
      return { ...record };
    },

    async listRecentByChannel(channelId, limit = 50) {
      return records
        .filter((r) => r.channelId === channelId)
        .slice()
        .reverse()
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },

    __resetForTests() {
      records = [];
    },
  };
}
