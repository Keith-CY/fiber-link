import { describe, expect, it, vi } from "vitest";
import {
  NotificationChannelNotFoundError,
  handleNotificationChannelDelete,
  handleNotificationChannelTest,
} from "./notification";

type AnyDb = NonNullable<Parameters<typeof handleNotificationChannelDelete>[1]>["db"];

function mockUpdateDb(returningRows: unknown[]) {
  const returning = vi.fn(async () => returningRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update } as unknown as AnyDb, update, set, where, returning };
}

function mockSelectDb(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as unknown as AnyDb, select };
}

describe("handleNotificationChannelDelete", () => {
  it("soft-disables the channel scoped to the app and reports disabled", async () => {
    const { db, set } = mockUpdateDb([{ id: "ch-1", enabled: false }]);

    const result = await handleNotificationChannelDelete({ appId: "app-1", channelId: "ch-1" }, { db });

    expect(result).toEqual({ id: "ch-1", disabled: true });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("throws NotificationChannelNotFoundError when no row matches app + id", async () => {
    const { db } = mockUpdateDb([]);

    await expect(handleNotificationChannelDelete({ appId: "app-1", channelId: "missing" }, { db })).rejects.toThrow(
      NotificationChannelNotFoundError,
    );
  });
});

describe("handleNotificationChannelTest", () => {
  const CHANNEL = {
    id: "ch-1",
    appId: "app-1",
    name: "hook",
    kind: "WEBHOOK" as const,
    target: "https://example.com/hook",
    secret: "s3cret-value",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("sends a synthetic TIP_SETTLED to the channel and reports delivery", async () => {
    const { db } = mockSelectDb([CHANNEL]);
    const handler = vi.fn(async (_input: unknown) => {});

    const result = await handleNotificationChannelTest({ appId: "app-1", channelId: "ch-1" }, { db, handler });

    expect(result).toEqual({ delivered: true, error: null });
    expect(handler).toHaveBeenCalledOnce();
    const input = handler.mock.calls[0][0] as {
      target: { channelId: string; target: string; secret: string | null };
      event: { type: string; invoice: string; amount: string };
    };
    expect(input.target.channelId).toBe("ch-1");
    expect(input.target.target).toBe("https://example.com/hook");
    expect(input.target.secret).toBe("s3cret-value");
    expect(input.event.type).toBe("TIP_SETTLED");
    expect(input.event.invoice).toMatch(/^test-/);
    expect(input.event.amount).toBe("0");
  });

  it("reports failed delivery with a truncated error instead of throwing", async () => {
    const { db } = mockSelectDb([CHANNEL]);
    const handler = vi.fn(async () => {
      throw new Error(`refused ${"x".repeat(400)}`);
    });

    const result = await handleNotificationChannelTest({ appId: "app-1", channelId: "ch-1" }, { db, handler });

    expect(result.delivered).toBe(false);
    expect(result.error).toHaveLength(200);
  });

  it("throws NotificationChannelNotFoundError for a missing or disabled channel", async () => {
    const missing = mockSelectDb([]);
    await expect(
      handleNotificationChannelTest({ appId: "app-1", channelId: "nope" }, { db: missing.db }),
    ).rejects.toThrow(NotificationChannelNotFoundError);

    const disabled = mockSelectDb([{ ...CHANNEL, enabled: false }]);
    await expect(
      handleNotificationChannelTest({ appId: "app-1", channelId: "ch-1" }, { db: disabled.db }),
    ).rejects.toThrow(NotificationChannelNotFoundError);
  });
});
