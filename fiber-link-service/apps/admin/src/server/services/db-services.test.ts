import { describe, expect, it } from "vitest";
import type { DbClient } from "@fiber-link/db";
import { createDbAdminServices } from "./db-services";

type FakeRows = {
  memberships?: Array<{ appId: string }>;
  apps?: Array<{ appId: string; createdAt: Date }>;
  withdrawals?: Array<Record<string, unknown>>;
  policies?: Array<Record<string, unknown>>;
};

function makeDb(rows: FakeRows = {}): { db: DbClient; inserted: unknown[] } {
  const inserted: unknown[] = [];
  const db = {
    query: {
      appAdmins: { findMany: async () => rows.memberships ?? [] },
      apps: { findMany: async () => rows.apps ?? [] },
      withdrawals: { findMany: async () => rows.withdrawals ?? [] },
      withdrawalPolicies: { findMany: async () => rows.policies ?? [] },
    },
    insert: () => ({
      values: (value: unknown) => ({
        onConflictDoUpdate: async () => {
          inserted.push(value);
        },
      }),
    }),
  } as unknown as DbClient;
  return { db, inserted };
}

const APP_ROWS = [
  { appId: "app-alpha", createdAt: new Date("2026-03-18T00:00:00.000Z") },
  { appId: "app-beta", createdAt: new Date("2026-03-18T00:00:00.000Z") },
];

const WITHDRAWAL_ROW = {
  id: "w-1",
  appId: "app-alpha",
  userId: "user-1",
  asset: "CKB",
  amount: "10",
  toAddress: "ckb1...",
  state: "FAILED",
  retryCount: 2,
  nextRetryAt: null,
  lastError: "boom",
  txHash: null,
  createdAt: new Date("2026-03-18T00:10:00.000Z"),
  updatedAt: new Date("2026-03-18T00:11:00.000Z"),
  completedAt: null,
};

describe("db admin services", () => {
  it("maps apps with ISO timestamps for SUPER_ADMIN", async () => {
    const { db } = makeDb({ apps: APP_ROWS });
    const services = createDbAdminServices(db);
    const apps = await services.listApps({ role: "SUPER_ADMIN" });
    expect(apps).toEqual([
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
      { appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" },
    ]);
  });

  it("returns nothing for a COMMUNITY_ADMIN with no memberships", async () => {
    const { db } = makeDb({ memberships: [], apps: APP_ROWS });
    const services = createDbAdminServices(db);
    expect(await services.listApps({ role: "COMMUNITY_ADMIN", adminUserId: "c" })).toEqual([]);
  });

  it("throws when a COMMUNITY_ADMIN has no admin identity", async () => {
    const { db } = makeDb();
    const services = createDbAdminServices(db);
    await expect(services.listApps({ role: "COMMUNITY_ADMIN" })).rejects.toThrow(/Admin identity/);
  });

  it("maps withdrawal rows and keeps userId for SUPER_ADMIN", async () => {
    const { db } = makeDb({ withdrawals: [WITHDRAWAL_ROW] });
    const services = createDbAdminServices(db);
    const rows = await services.listWithdrawals({ role: "SUPER_ADMIN" });
    expect(rows[0]).toMatchObject({
      id: "w-1",
      userId: "user-1",
      toAddress: "ckb1...",
      retryCount: 2,
      lastError: "boom",
      createdAt: "2026-03-18T00:10:00.000Z",
      updatedAt: "2026-03-18T00:11:00.000Z",
      nextRetryAt: null,
      completedAt: null,
    });
  });

  it("trims userId for COMMUNITY_ADMIN withdrawals", async () => {
    const { db } = makeDb({ memberships: [{ appId: "app-alpha" }], withdrawals: [WITHDRAWAL_ROW] });
    const services = createDbAdminServices(db);
    const rows = await services.listWithdrawals({ role: "COMMUNITY_ADMIN", adminUserId: "c" });
    expect(rows[0]?.userId).toBe("");
    expect(rows[0]?.toAddress).toBeNull();
  });

  it("persists a policy upsert and returns the stored row", async () => {
    const policyRow = {
      appId: "app-alpha",
      allowedAssets: ["CKB"],
      maxPerRequest: "100",
      perUserDailyMax: "1000",
      perAppDailyMax: "10000",
      cooldownSeconds: 60,
      updatedBy: "ops-1",
      createdAt: new Date("2026-03-18T00:00:00.000Z"),
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
    };
    const { db, inserted } = makeDb({ apps: [APP_ROWS[0]], policies: [policyRow] });
    const services = createDbAdminServices(db);
    const saved = await services.upsertPolicy(
      { role: "SUPER_ADMIN", adminUserId: "ops-1" },
      { appId: "app-alpha", allowedAssets: ["CKB"], maxPerRequest: "100", perUserDailyMax: "1000", perAppDailyMax: "10000", cooldownSeconds: 60 },
    );
    expect(saved.appId).toBe("app-alpha");
    expect(saved.createdAt).toBe("2026-03-18T00:00:00.000Z");
    expect(inserted).toHaveLength(1);
  });

  it("rejects a policy upsert for an unknown app", async () => {
    const { db, inserted } = makeDb({ apps: [] });
    const services = createDbAdminServices(db);
    await expect(
      services.upsertPolicy(
        { role: "SUPER_ADMIN", adminUserId: "ops-1" },
        { appId: "ghost", allowedAssets: ["CKB"], maxPerRequest: "1", perUserDailyMax: "1", perAppDailyMax: "1", cooldownSeconds: 0 },
      ),
    ).rejects.toThrow(/unknown app/);
    expect(inserted).toHaveLength(0);
  });

  it("blocks COMMUNITY_ADMIN policy writes outside assigned apps", async () => {
    const { db } = makeDb({ memberships: [{ appId: "app-alpha" }] });
    const services = createDbAdminServices(db);
    await expect(
      services.upsertPolicy(
        { role: "COMMUNITY_ADMIN", adminUserId: "c" },
        { appId: "app-beta", allowedAssets: ["CKB"], maxPerRequest: "1", perUserDailyMax: "1", perAppDailyMax: "1", cooldownSeconds: 0 },
      ),
    ).rejects.toThrow(/COMMUNITY_ADMIN/);
  });

  it("delegates rate-limit and backup helpers", async () => {
    const { db } = makeDb();
    const services = createDbAdminServices(db);
    const changeSet = await services.createRateLimitChangeSet({ enabled: true, windowMs: "1000", maxRequests: "5" });
    expect(changeSet.envSnippet).toContain("RPC_RATE_LIMIT_MAX_REQUESTS=5");
    expect(await services.listBackupBundles()).toEqual([]);
    await expect(services.buildBackupRestorePlan("missing")).rejects.toThrow(/Unknown backup/);
  });
});
