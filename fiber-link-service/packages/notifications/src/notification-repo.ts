import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  notificationChannels,
  notificationRules,
  type DbClient,
  type NotificationChannelKind,
  type NotificationEvent,
} from "@fiber-link/db";

export type CreateNotificationChannelInput = {
  appId: string;
  name: string;
  kind: NotificationChannelKind;
  target: string;
  secret?: string | null;
  enabled?: boolean;
};

export type NotificationChannelRecord = {
  id: string;
  appId: string;
  name: string;
  kind: NotificationChannelKind;
  target: string;
  secret: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateNotificationRuleInput = {
  appId: string;
  channelId: string;
  event: NotificationEvent;
  enabled?: boolean;
};

export type NotificationRuleRecord = {
  id: string;
  appId: string;
  channelId: string;
  event: NotificationEvent;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationDispatchTarget = {
  ruleId: string;
  channelId: string;
  appId: string;
  event: NotificationEvent;
  channelName: string;
  kind: NotificationChannelKind;
  target: string;
  secret: string | null;
};

export type NotificationRepo = {
  createChannel(input: CreateNotificationChannelInput): Promise<NotificationChannelRecord>;
  createRule(input: CreateNotificationRuleInput): Promise<NotificationRuleRecord>;
  listDispatchTargets(appId: string, event: NotificationEvent): Promise<NotificationDispatchTarget[]>;
  __resetForTests?: () => void;
};

type NotificationChannelRow = typeof notificationChannels.$inferSelect;
type NotificationRuleRow = typeof notificationRules.$inferSelect;

function toChannelRecord(row: NotificationChannelRow): NotificationChannelRecord {
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    kind: row.kind as NotificationChannelKind,
    target: row.target,
    secret: row.secret,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRuleRecord(row: NotificationRuleRow): NotificationRuleRecord {
  return {
    id: row.id,
    appId: row.appId,
    channelId: row.channelId,
    event: row.event as NotificationEvent,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDbNotificationRepo(db: DbClient): NotificationRepo {
  return {
    async createChannel(input) {
      const now = new Date();
      const [row] = await db
        .insert(notificationChannels)
        .values({
          appId: input.appId,
          name: input.name,
          kind: input.kind,
          target: input.target,
          secret: input.secret ?? null,
          enabled: input.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toChannelRecord(row);
    },

    async createRule(input) {
      const [channel] = await db
        .select({ id: notificationChannels.id, appId: notificationChannels.appId })
        .from(notificationChannels)
        .where(eq(notificationChannels.id, input.channelId))
        .limit(1);
      if (!channel || channel.appId !== input.appId) {
        throw new Error("notification channel not found");
      }

      const now = new Date();
      const [row] = await db
        .insert(notificationRules)
        .values({
          appId: input.appId,
          channelId: input.channelId,
          event: input.event,
          enabled: input.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toRuleRecord(row);
    },

    async listDispatchTargets(appId, event) {
      const rows = await db
        .select({
          ruleId: notificationRules.id,
          channelId: notificationChannels.id,
          appId: notificationRules.appId,
          event: notificationRules.event,
          channelName: notificationChannels.name,
          kind: notificationChannels.kind,
          target: notificationChannels.target,
          secret: notificationChannels.secret,
        })
        .from(notificationRules)
        .innerJoin(
          notificationChannels,
          and(
            eq(notificationChannels.id, notificationRules.channelId),
            eq(notificationChannels.appId, notificationRules.appId),
          ),
        )
        .where(
          and(
            eq(notificationRules.appId, appId),
            eq(notificationRules.event, event),
            eq(notificationRules.enabled, true),
            eq(notificationChannels.enabled, true),
          ),
        )
        .orderBy(asc(notificationRules.createdAt), asc(notificationRules.id));

      return rows.map((row) => ({
        ruleId: row.ruleId,
        channelId: row.channelId,
        appId: row.appId,
        event: row.event as NotificationEvent,
        channelName: row.channelName,
        kind: row.kind as NotificationChannelKind,
        target: row.target,
        secret: row.secret,
      }));
    },
  };
}

export function createInMemoryNotificationRepo(): NotificationRepo {
  const channels: NotificationChannelRecord[] = [];
  const rules: NotificationRuleRecord[] = [];

  function cloneChannel(record: NotificationChannelRecord): NotificationChannelRecord {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  function cloneRule(record: NotificationRuleRecord): NotificationRuleRecord {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  return {
    async createChannel(input) {
      const duplicate = channels.find((channel) => channel.appId === input.appId && channel.name === input.name);
      if (duplicate) {
        throw new Error("duplicate notification channel name");
      }
      const now = new Date();
      const record: NotificationChannelRecord = {
        id: randomUUID(),
        appId: input.appId,
        name: input.name,
        kind: input.kind,
        target: input.target,
        secret: input.secret ?? null,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      channels.push(record);
      return cloneChannel(record);
    },

    async createRule(input) {
      const channel = channels.find((item) => item.id === input.channelId && item.appId === input.appId);
      if (!channel) {
        throw new Error("notification channel not found");
      }
      const duplicate = rules.find((rule) => rule.channelId === input.channelId && rule.event === input.event);
      if (duplicate) {
        throw new Error("duplicate notification rule");
      }

      const now = new Date();
      const record: NotificationRuleRecord = {
        id: randomUUID(),
        appId: input.appId,
        channelId: input.channelId,
        event: input.event,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      rules.push(record);
      return cloneRule(record);
    },

    async listDispatchTargets(appId, event) {
      return rules
        .filter((rule) => rule.appId === appId && rule.event === event && rule.enabled)
        .sort((left, right) => {
          const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
          if (byCreated !== 0) {
            return byCreated;
          }
          return left.id.localeCompare(right.id);
        })
        .flatMap((rule) => {
          const channel = channels.find((item) => item.id === rule.channelId && item.appId === appId);
          if (!channel || !channel.enabled) {
            return [];
          }
          return [
            {
              ruleId: rule.id,
              channelId: channel.id,
              appId,
              event,
              channelName: channel.name,
              kind: channel.kind,
              target: channel.target,
              secret: channel.secret,
            },
          ];
        });
    },

    __resetForTests() {
      channels.length = 0;
      rules.length = 0;
    },
  };
}
