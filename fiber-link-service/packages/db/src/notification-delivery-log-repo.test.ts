import { describe, expect, it } from "vitest";
import { createInMemoryNotificationDeliveryLogRepo } from "./notification-delivery-log-repo";

describe("notification delivery log repo (in-memory)", () => {
  it("appends attempts and lists them newest first, scoped to the channel", async () => {
    const repo = createInMemoryNotificationDeliveryLogRepo();

    await repo.log({
      channelId: "ch-1",
      event: "TIP_SETTLED",
      payloadHash: "a".repeat(64),
      attempt: 1,
      status: "FAILED",
      error: "HTTP 500",
    });
    await repo.log({
      channelId: "ch-1",
      event: "TIP_SETTLED",
      payloadHash: "a".repeat(64),
      attempt: 2,
      status: "DELIVERED",
    });
    await repo.log({
      channelId: "ch-2",
      event: "WITHDRAWAL_COMPLETED",
      payloadHash: "b".repeat(64),
      attempt: 1,
      status: "DELIVERED",
    });

    const rows = await repo.listRecentByChannel("ch-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].attempt).toBe(2);
    expect(rows[0].status).toBe("DELIVERED");
    expect(rows[0].error).toBeNull();
    expect(rows[1].attempt).toBe(1);
    expect(rows[1].error).toBe("HTTP 500");
  });

  it("caps the listing at the requested limit", async () => {
    const repo = createInMemoryNotificationDeliveryLogRepo();
    for (let i = 1; i <= 5; i += 1) {
      await repo.log({
        channelId: "ch-1",
        event: "TIP_SETTLED",
        payloadHash: "c".repeat(64),
        attempt: i,
        status: "DELIVERED",
      });
    }
    const rows = await repo.listRecentByChannel("ch-1", 3);
    expect(rows.map((r) => r.attempt)).toEqual([5, 4, 3]);
  });
});
