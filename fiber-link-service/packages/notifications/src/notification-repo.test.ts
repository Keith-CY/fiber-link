import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryNotificationRepo } from "./notification-repo";

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
});
