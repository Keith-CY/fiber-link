import { describe, expect, it } from "vitest";
import { createInMemoryWithdrawalPolicyRepo } from "./withdrawal-policy-repo";

describe("withdrawal policy repo", () => {
  it("upserts and reads policy by app", async () => {
    const repo = createInMemoryWithdrawalPolicyRepo();

    await repo.upsert({
      appId: "app1",
      allowedAssets: ["CKB"],
      maxPerRequest: "5000",
      perUserDailyMax: "20000",
      perAppDailyMax: "200000",
      cooldownSeconds: 300,
      updatedBy: "admin-1",
    });

    const found = await repo.getByAppId("app1");
    expect(found).toBeTruthy();
    expect(found?.allowedAssets).toEqual(["CKB"]);
    expect(found?.maxPerRequest).toBe("5000");
    expect(found?.cooldownSeconds).toBe(300);
    expect(found?.updatedBy).toBe("admin-1");
  });

  it("returns zero usage when no usage is tracked", async () => {
    const repo = createInMemoryWithdrawalPolicyRepo();

    const usage = await repo.getUsage({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      now: new Date("2026-02-27T00:00:00.000Z"),
    });

    expect(usage).toEqual({
      appDailyTotal: "0",
      userDailyTotal: "0",
      lastRequestedAt: null,
    });
  });

  it("tracks injected usage snapshots for policy checks", async () => {
    const repo = createInMemoryWithdrawalPolicyRepo();
    const now = new Date("2026-02-27T10:00:00.000Z");

    repo.__setUsageForTests?.(
      {
        appId: "app1",
        userId: "u1",
        asset: "CKB",
        now,
      },
      {
        appDailyTotal: "120",
        userDailyTotal: "30",
        lastRequestedAt: new Date("2026-02-27T09:55:00.000Z"),
      },
    );

    const usage = await repo.getUsage({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      now,
    });

    expect(usage.appDailyTotal).toBe("120");
    expect(usage.userDailyTotal).toBe("30");
    expect(usage.lastRequestedAt?.toISOString()).toBe("2026-02-27T09:55:00.000Z");
  });
});
