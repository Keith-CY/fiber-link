import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationDispatcher } from "./dispatcher";
import { createInMemoryNotificationRepo } from "./notification-repo";

describe("createNotificationDispatcher", () => {
  const repo = createInMemoryNotificationRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("dispatches withdrawal event to matched channel handlers", async () => {
    const firstChannel = await repo.createChannel({
      appId: "app-1",
      name: "first",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/first",
    });
    const secondChannel = await repo.createChannel({
      appId: "app-1",
      name: "second",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/second",
    });

    await repo.createRule({
      appId: "app-1",
      channelId: firstChannel.id,
      event: "WITHDRAWAL_COMPLETED",
    });
    await repo.createRule({
      appId: "app-1",
      channelId: secondChannel.id,
      event: "WITHDRAWAL_COMPLETED",
    });

    const webhookHandler = vi.fn(async () => {
      return;
    });
    const dispatcher = createNotificationDispatcher({
      repo,
      handlers: { WEBHOOK: webhookHandler },
    });

    const summary = await dispatcher.dispatchWithdrawalEvent({
      type: "WITHDRAWAL_COMPLETED",
      occurredAt: new Date("2026-02-07T13:00:00.000Z"),
      appId: "app-1",
      userId: "user-1",
      withdrawalId: "wd-1",
      asset: "USDI",
      amount: "12.5",
      txHash: "0xabc",
    });

    expect(summary).toEqual({ matched: 2, attempted: 2, delivered: 2, failed: 0 });
    expect(webhookHandler).toHaveBeenCalledTimes(2);
  });

  it("isolates handler failures and reports failed attempts", async () => {
    const channel = await repo.createChannel({
      appId: "app-1",
      name: "only",
      kind: "WEBHOOK",
      target: "https://example.com/hooks/fail",
    });
    await repo.createRule({
      appId: "app-1",
      channelId: channel.id,
      event: "WITHDRAWAL_FAILED",
    });

    const onDispatchError = vi.fn();
    const dispatcher = createNotificationDispatcher({
      repo,
      handlers: {
        WEBHOOK: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
      onDispatchError,
    });

    const summary = await dispatcher.dispatchWithdrawalEvent({
      type: "WITHDRAWAL_FAILED",
      occurredAt: new Date("2026-02-07T13:10:00.000Z"),
      appId: "app-1",
      userId: "user-1",
      withdrawalId: "wd-2",
      asset: "USDI",
      amount: "5",
      retryCount: 3,
      error: "exhausted retries",
    });

    expect(summary).toEqual({ matched: 1, attempted: 1, delivered: 0, failed: 1 });
    expect(onDispatchError).toHaveBeenCalledTimes(1);
  });

  it("returns an empty summary when no rules match", async () => {
    const webhookHandler = vi.fn(async () => {
      return;
    });
    const dispatcher = createNotificationDispatcher({
      repo,
      handlers: { WEBHOOK: webhookHandler },
    });

    const summary = await dispatcher.dispatchWithdrawalEvent({
      type: "WITHDRAWAL_RETRY_PENDING",
      occurredAt: new Date("2026-02-07T13:20:00.000Z"),
      appId: "app-empty",
      userId: "user-1",
      withdrawalId: "wd-empty",
      asset: "USDI",
      amount: "2",
      retryCount: 1,
      nextRetryAt: new Date("2026-02-07T13:21:00.000Z"),
      error: "temporary node error",
    });

    expect(summary).toEqual({ matched: 0, attempted: 0, delivered: 0, failed: 0 });
    expect(webhookHandler).not.toHaveBeenCalled();
  });
});
