import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { createDbWithdrawalPolicyRepo, createInMemoryWithdrawalPolicyRepo } from "./withdrawal-policy-repo";

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

describe("withdrawal policy repo (db)", () => {
  function createDbRow(overrides: Record<string, unknown> = {}) {
    return {
      appId: "app1",
      allowedAssets: ["CKB"],
      maxPerRequest: "5000",
      perUserDailyMax: "20000",
      perAppDailyMax: "200000",
      cooldownSeconds: 300,
      updatedBy: "admin-1",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  function createDbMock({
    policyRows = [],
    upsertRows = [],
    userUsageRows = [{ total: "0", lastRequestedAt: null }],
    appUsageRows = [{ total: "0" }],
  }: {
    policyRows?: unknown[];
    upsertRows?: unknown[];
    userUsageRows?: unknown[];
    appUsageRows?: unknown[];
  }) {
    const selectLimit = vi.fn().mockResolvedValue(policyRows);
    const whereQueue: unknown[][] = [userUsageRows, appUsageRows];
    const selectWhere = vi.fn(() => {
      const query = {
        limit: selectLimit,
        then(onFulfilled: (value: unknown[]) => unknown) {
          return Promise.resolve(whereQueue.shift() ?? []).then(onFulfilled);
        },
      };
      return query;
    });
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const insertReturning = vi.fn().mockResolvedValue(upsertRows);
    const insertOnConflictDoUpdate = vi.fn(() => ({ returning: insertReturning }));
    const insertValues = vi.fn(() => ({ onConflictDoUpdate: insertOnConflictDoUpdate }));
    const insert = vi.fn(() => ({ values: insertValues }));

    const db = { select, insert } as unknown as DbClient;
    return { db };
  }

  it("reads policy row by app id and returns null when missing", async () => {
    const foundMock = createDbMock({ policyRows: [createDbRow()] });
    const foundRepo = createDbWithdrawalPolicyRepo(foundMock.db);
    const found = await foundRepo.getByAppId("app1");
    expect(found?.appId).toBe("app1");
    expect(found?.allowedAssets).toEqual(["CKB"]);

    const missingMock = createDbMock({ policyRows: [] });
    const missingRepo = createDbWithdrawalPolicyRepo(missingMock.db);
    const missing = await missingRepo.getByAppId("missing");
    expect(missing).toBeNull();
  });

  it("validates upsert input constraints", async () => {
    const repo = createDbWithdrawalPolicyRepo(createDbMock({ upsertRows: [createDbRow()] }).db);

    await expect(
      repo.upsert({
        appId: "app1",
        allowedAssets: [] as never,
        maxPerRequest: "10",
        perUserDailyMax: "20",
        perAppDailyMax: "200",
        cooldownSeconds: 0,
      }),
    ).rejects.toThrow("allowedAssets must include at least one supported asset");

    await expect(
      repo.upsert({
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "20",
        perUserDailyMax: "10",
        perAppDailyMax: "200",
        cooldownSeconds: 0,
      }),
    ).rejects.toThrow("maxPerRequest must be <= perUserDailyMax");

    await expect(
      repo.upsert({
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "10",
        perUserDailyMax: "20",
        perAppDailyMax: "200",
        cooldownSeconds: -1,
      }),
    ).rejects.toThrow("cooldownSeconds must be an integer >= 0");
  });

  it("upserts policy with normalized assets/amounts", async () => {
    const row = createDbRow({
      allowedAssets: ["CKB", "USDI"],
      maxPerRequest: "10",
      perUserDailyMax: "20",
      perAppDailyMax: "200",
      cooldownSeconds: 0,
    });
    const mock = createDbMock({ upsertRows: [row] });
    const repo = createDbWithdrawalPolicyRepo(mock.db);

    const saved = await repo.upsert({
      appId: "app1",
      allowedAssets: ["CKB", "CKB", "USDI"],
      maxPerRequest: "10.0",
      perUserDailyMax: "20.00",
      perAppDailyMax: "200.000",
      cooldownSeconds: 0,
      updatedBy: "admin-1",
    });

    expect(saved.allowedAssets).toEqual(["CKB", "USDI"]);
    expect(saved.maxPerRequest).toBe("10");
    expect(saved.perUserDailyMax).toBe("20");
    expect(saved.perAppDailyMax).toBe("200");
  });

  it("aggregates usage totals and last requested timestamp", async () => {
    const mock = createDbMock({
      userUsageRows: [{ total: "30", lastRequestedAt: new Date("2026-02-01T01:00:00.000Z") }],
      appUsageRows: [{ total: "120" }],
    });
    const repo = createDbWithdrawalPolicyRepo(mock.db);

    const usage = await repo.getUsage({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      now: new Date("2026-02-01T02:00:00.000Z"),
    });

    expect(usage).toEqual({
      userDailyTotal: "30",
      appDailyTotal: "120",
      lastRequestedAt: new Date("2026-02-01T01:00:00.000Z"),
    });
  });
});
