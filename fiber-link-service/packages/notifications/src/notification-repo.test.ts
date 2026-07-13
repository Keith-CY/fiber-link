import type { DbClient } from "@fiber-link/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbNotificationRepo, createInMemoryNotificationRepo } from "./notification-repo";

// Minimal chainable stand-in for the drizzle query builder. Every builder method
// used by the repo returns the same object, and awaiting it resolves to a
// pre-queued result, so we can unit-test the repo's control flow and row→record
// mapping without a live Postgres.
function makeDbMock() {
  const selectResults: unknown[] = [];
  const insertResults: unknown[] = [];
  function chain(result: unknown) {
    const c = {
      from: () => c,
      where: () => c,
      limit: () => c,
      innerJoin: () => c,
      orderBy: () => c,
      values: () => c,
      returning: () => c,
      then: (resolve: (value: unknown) => void) => resolve(result),
    };
    return c;
  }
  const db = {
    select: () => chain(selectResults.shift()),
    insert: () => chain(insertResults.shift()),
  } as unknown as DbClient;
  return {
    db,
    queueSelect(result: unknown) {
      selectResults.push(result);
    },
    queueInsert(result: unknown) {
      insertResults.push(result);
    },
  };
}

function channelRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-03-01T00:00:00.000Z");
  return {
    id: "ch-db-1",
    appId: "app-1",
    name: "db-webhook",
    kind: "WEBHOOK",
    target: "https://example.com/hooks/db",
    secret: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("createInMemoryNotificationRepo", () => {
  const repo = createInMemoryNotificationRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("resolves active dispatch targets for app + event", async () => {
    const channel = await repo.createChannel({
      appId: "app-1",
      name: "primary-webhook",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/withdrawals",
      secret: "top-secret",
    });

    await repo.createRule({
      appId: "app-1",
      channelId: channel.id,
      event: "WITHDRAWAL_COMPLETED",
    });

    const targets = await repo.listDispatchTargets("app-1", "WITHDRAWAL_COMPLETED");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      appId: "app-1",
      event: "WITHDRAWAL_COMPLETED",
      channelId: channel.id,
      channelName: "primary-webhook",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/withdrawals",
      secret: "top-secret",
    });
  });

  it("skips disabled channels and disabled rules", async () => {
    const enabledChannel = await repo.createChannel({
      appId: "app-1",
      name: "enabled-channel",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/enabled",
    });
    const disabledChannel = await repo.createChannel({
      appId: "app-1",
      name: "disabled-channel",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/disabled",
      enabled: false,
    });

    await repo.createRule({
      appId: "app-1",
      channelId: enabledChannel.id,
      event: "WITHDRAWAL_FAILED",
      enabled: false,
    });
    await repo.createRule({
      appId: "app-1",
      channelId: disabledChannel.id,
      event: "WITHDRAWAL_FAILED",
    });

    const targets = await repo.listDispatchTargets("app-1", "WITHDRAWAL_FAILED");
    expect(targets).toEqual([]);
  });

  it("rejects rule creation when channel does not exist in app scope", async () => {
    const channel = await repo.createChannel({
      appId: "app-1",
      name: "app1-channel",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/app1",
    });

    await expect(
      repo.createRule({
        appId: "app-2",
        channelId: channel.id,
        event: "WITHDRAWAL_RETRY_PENDING",
      }),
    ).rejects.toThrow("notification channel not found");
  });

  it("rejects a duplicate channel name within the same app", async () => {
    await repo.createChannel({
      appId: "app-1",
      name: "dupe",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/a",
    });

    await expect(
      repo.createChannel({
        appId: "app-1",
        name: "dupe",
        kind: "WEBHOOK",
        target: "https://example.com/hooks/b",
      }),
    ).rejects.toThrow("duplicate notification channel name");
  });

  it("rejects a duplicate rule for the same channel and event", async () => {
    const channel = await repo.createChannel({
      appId: "app-1",
      name: "rule-dupe",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/rule-dupe",
    });
    await repo.createRule({ appId: "app-1", channelId: channel.id, event: "WITHDRAWAL_FAILED" });

    await expect(
      repo.createRule({ appId: "app-1", channelId: channel.id, event: "WITHDRAWAL_FAILED" }),
    ).rejects.toThrow("duplicate notification rule");
  });

  it("orders dispatch targets by rule creation time", async () => {
    vi.useFakeTimers();
    try {
      const older = await repo.createChannel({
        appId: "app-1",
        name: "older",
        kind: "WEBHOOK",
        target: "https://example.com/hooks/older",
      });
      const newer = await repo.createChannel({
        appId: "app-1",
        name: "newer",
        kind: "WEBHOOK",
        target: "https://example.com/hooks/newer",
      });

      // Create the rules out of chronological order but with distinct
      // createdAt timestamps, so the comparator's non-zero branch decides
      // ordering (not insertion order).
      vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
      await repo.createRule({ appId: "app-1", channelId: newer.id, event: "WITHDRAWAL_COMPLETED" });
      vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
      await repo.createRule({ appId: "app-1", channelId: older.id, event: "WITHDRAWAL_COMPLETED" });

      const targets = await repo.listDispatchTargets("app-1", "WITHDRAWAL_COMPLETED");
      expect(targets.map((t) => t.channelName)).toEqual(["older", "newer"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createDbNotificationRepo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps an inserted channel row to a channel record", async () => {
    const { db, queueInsert } = makeDbMock();
    queueInsert([channelRow({ secret: "s3cr3t" })]);
    const repo = createDbNotificationRepo(db);

    const record = await repo.createChannel({
      appId: "app-1",
      name: "db-webhook",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/db",
      secret: "s3cr3t",
    });

    expect(record).toMatchObject({
      id: "ch-db-1",
      appId: "app-1",
      name: "db-webhook",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/db",
      secret: "s3cr3t",
      enabled: true,
    });
  });

  it("creates a rule after verifying the channel belongs to the app", async () => {
    const { db, queueSelect, queueInsert } = makeDbMock();
    queueSelect([{ id: "ch-db-1", appId: "app-1" }]);
    queueInsert([
      {
        id: "rule-db-1",
        appId: "app-1",
        channelId: "ch-db-1",
        event: "WITHDRAWAL_COMPLETED",
        enabled: true,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);
    const repo = createDbNotificationRepo(db);

    const record = await repo.createRule({
      appId: "app-1",
      channelId: "ch-db-1",
      event: "WITHDRAWAL_COMPLETED",
    });

    expect(record).toMatchObject({
      id: "rule-db-1",
      appId: "app-1",
      channelId: "ch-db-1",
      event: "WITHDRAWAL_COMPLETED",
      enabled: true,
    });
  });

  it("throws when the channel row is missing", async () => {
    const { db, queueSelect } = makeDbMock();
    queueSelect([]);
    const repo = createDbNotificationRepo(db);

    await expect(repo.createRule({ appId: "app-1", channelId: "missing", event: "WITHDRAWAL_FAILED" })).rejects.toThrow(
      "notification channel not found",
    );
  });

  it("throws when the channel belongs to a different app", async () => {
    const { db, queueSelect } = makeDbMock();
    queueSelect([{ id: "ch-db-1", appId: "other-app" }]);
    const repo = createDbNotificationRepo(db);

    await expect(repo.createRule({ appId: "app-1", channelId: "ch-db-1", event: "WITHDRAWAL_FAILED" })).rejects.toThrow(
      "notification channel not found",
    );
  });

  it("maps joined rule+channel rows to dispatch targets", async () => {
    const { db, queueSelect } = makeDbMock();
    queueSelect([
      {
        ruleId: "rule-db-1",
        channelId: "ch-db-1",
        appId: "app-1",
        event: "WITHDRAWAL_COMPLETED",
        channelName: "db-webhook",
        kind: "WEBHOOK",
        target: "https://example.com/hooks/db",
        secret: "s3cr3t",
      },
    ]);
    const repo = createDbNotificationRepo(db);

    const targets = await repo.listDispatchTargets("app-1", "WITHDRAWAL_COMPLETED");
    expect(targets).toEqual([
      {
        ruleId: "rule-db-1",
        channelId: "ch-db-1",
        appId: "app-1",
        event: "WITHDRAWAL_COMPLETED",
        channelName: "db-webhook",
        kind: "WEBHOOK",
        target: "https://example.com/hooks/db",
        secret: "s3cr3t",
      },
    ]);
  });
});
