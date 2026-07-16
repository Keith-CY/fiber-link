import { describe, expect, it } from "vitest";
import { type DashboardFixture, createFixtureAdminServices } from "./fixture-services";
import type { AdminScope } from "./types";

const SUPER: AdminScope = { role: "SUPER_ADMIN", adminUserId: "ops-1" };
const COMMUNITY: AdminScope = { role: "COMMUNITY_ADMIN", adminUserId: "community-1" };

function buildFixture(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
  return {
    apps: [
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
      { appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" },
    ],
    withdrawals: [
      {
        id: "w-1",
        appId: "app-alpha",
        userId: "user-1",
        asset: "CKB",
        amount: "10",
        state: "FAILED",
        createdAt: "2026-03-18T00:10:00.000Z",
        txHash: null,
        toAddress: "ckb1qalpha",
      },
      {
        id: "w-2",
        appId: "app-beta",
        userId: "user-2",
        asset: "USDI",
        amount: "20",
        state: "COMPLETED",
        createdAt: "2026-03-18T00:20:00.000Z",
        txHash: "0xabc",
      },
    ],
    policies: [
      {
        appId: "app-beta",
        allowedAssets: ["CKB"],
        maxPerRequest: "100",
        perUserDailyMax: "1000",
        perAppDailyMax: "10000",
        cooldownSeconds: 60,
        updatedBy: "admin-1",
        createdAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ],
    communityAdminAppIds: ["app-alpha"],
    ...overrides,
  };
}

describe("fixture admin services", () => {
  it("returns all apps for SUPER_ADMIN and only assigned apps for COMMUNITY_ADMIN", async () => {
    const services = createFixtureAdminServices(buildFixture());
    expect((await services.listApps(SUPER)).map((a) => a.appId)).toEqual(["app-alpha", "app-beta"]);
    expect((await services.listApps(COMMUNITY)).map((a) => a.appId)).toEqual(["app-alpha"]);
  });

  it("filters withdrawals by state and app", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const failed = await services.listWithdrawals(SUPER, { state: "FAILED" });
    expect(failed.items.map((w) => w.id)).toEqual(["w-1"]);
    const beta = await services.listWithdrawals(SUPER, { appId: "app-beta" });
    expect(beta.items.map((w) => w.id)).toEqual(["w-2"]);
  });

  it("summarizes withdrawal states per scope in canonical order", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const summary = await services.summarizeWithdrawals(SUPER);
    expect(summary).toHaveLength(7);
    expect(summary[0]?.state).toBe("LIQUIDITY_PENDING");
    const scoped = await services.summarizeWithdrawals(COMMUNITY);
    const scopedTotal = scoped.reduce((sum, s) => sum + s.count, 0);
    expect(scopedTotal).toBe(1);
  });

  it("redacts userId and toAddress for COMMUNITY_ADMIN withdrawals", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const { items: rows } = await services.listWithdrawals(COMMUNITY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appId).toBe("app-alpha");
    expect(rows[0]?.userId).toBe("");
    expect(rows[0]?.toAddress).toBeNull();
  });

  it("keeps userId and toAddress for SUPER_ADMIN withdrawals", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const { items: rows } = await services.listWithdrawals(SUPER, { appId: "app-alpha" });
    expect(rows[0]?.userId).toBe("user-1");
    expect(rows[0]?.toAddress).toBe("ckb1qalpha");
  });

  it("blocks COMMUNITY_ADMIN from editing unmanaged policies", async () => {
    const services = createFixtureAdminServices(buildFixture());
    await expect(
      services.upsertPolicy(COMMUNITY, {
        appId: "app-beta",
        allowedAssets: ["CKB"],
        maxPerRequest: "1",
        perUserDailyMax: "1",
        perAppDailyMax: "1",
        cooldownSeconds: 0,
      }),
    ).rejects.toThrow(/COMMUNITY_ADMIN/);
  });

  it("upserts a policy and reflects it in subsequent reads", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const saved = await services.upsertPolicy(SUPER, {
      appId: "app-alpha",
      allowedAssets: ["CKB", "USDI"],
      maxPerRequest: "5",
      perUserDailyMax: "50",
      perAppDailyMax: "500",
      cooldownSeconds: 30,
    });
    expect(saved.updatedBy).toBe("ops-1");
    const policies = await services.listPolicies(SUPER);
    expect(policies.find((p) => p.appId === "app-alpha")?.maxPerRequest).toBe("5");
  });

  it("rejects a policy upsert for an unknown app", async () => {
    const services = createFixtureAdminServices(buildFixture());
    await expect(
      services.upsertPolicy(SUPER, {
        appId: "ghost",
        allowedAssets: ["CKB"],
        maxPerRequest: "1",
        perUserDailyMax: "1",
        perAppDailyMax: "1",
        cooldownSeconds: 0,
      }),
    ).rejects.toThrow(/unknown app/);
  });

  it("captures a backup that appears at the head of the bundle list", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const result = await services.captureBackup();
    expect(result.backupId).toBe("fixture-backup-001");
    const bundles = await services.listBackupBundles();
    expect(bundles[0]?.id).toBe("fixture-backup-001");
    const plan = await services.buildBackupRestorePlan(result.backupId);
    expect(plan.command).toContain("restore-compose-backup.sh");
  });

  it("rejects a restore plan for an unknown bundle", async () => {
    const services = createFixtureAdminServices(buildFixture());
    await expect(services.buildBackupRestorePlan("missing")).rejects.toThrow(/Unknown backup/);
  });

  it("builds a rate-limit change set from the current config", async () => {
    const services = createFixtureAdminServices(buildFixture());
    const changeSet = await services.createRateLimitChangeSet({ enabled: false, windowMs: "1000", maxRequests: "10" });
    expect(changeSet.envSnippet).toContain("RPC_RATE_LIMIT_ENABLED=false");
    expect(changeSet.changedKeys).toContain("RPC_RATE_LIMIT_ENABLED");
  });

  it("falls back to default monitoring + rate-limit config when omitted", async () => {
    const services = createFixtureAdminServices(
      buildFixture({ monitoringSummary: undefined, rateLimitConfig: undefined }),
    );
    expect((await services.loadMonitoringSummary()).status).toBe("ok");
    expect((await services.loadRateLimitConfig()).sourceLabel).toBe("fixture");
  });
});
