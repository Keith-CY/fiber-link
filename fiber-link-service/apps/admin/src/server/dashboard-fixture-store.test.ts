import { describe, expect, it } from "vitest";
import { createDashboardFixtureDependencies, type DashboardFixture } from "./dashboard-fixture-store";

function createFixture(input?: Partial<DashboardFixture>): DashboardFixture {
  return {
    apps: input?.apps ?? [
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
      { appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" },
    ],
    withdrawals: input?.withdrawals ?? [
      {
        id: "wd-1",
        appId: "app-beta",
        userId: "user-1",
        asset: "USDI",
        amount: "25",
        state: "PENDING",
        createdAt: "2026-03-18T00:00:00.000Z",
        txHash: null,
      },
    ],
    policies: input?.policies ?? [
      {
        appId: "app-alpha",
        allowedAssets: ["CKB"],
        maxPerRequest: "10",
        perUserDailyMax: "20",
        perAppDailyMax: "30",
        cooldownSeconds: 60,
        updatedBy: "admin-1",
        createdAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ],
    monitoringSummary: input?.monitoringSummary,
    rateLimitConfig: input?.rateLimitConfig,
    backupBundles: input?.backupBundles,
    communityAdminAppIds: input?.communityAdminAppIds,
  };
}

describe("dashboard fixture store", () => {
  it("keeps full visibility for SUPER_ADMIN and upserts policies", async () => {
    const { deps, snapshot } = createDashboardFixtureDependencies(createFixture());
    const ctx = { role: "SUPER_ADMIN" as const, adminUserId: "admin-2", db: deps.createDb() };

    expect(await deps.listApps(ctx)).toHaveLength(2);
    expect(await deps.listWithdrawals(ctx)).toHaveLength(1);
    expect(await deps.listPolicies(ctx)).toHaveLength(1);

    await deps.upsertPolicy({
      ctx,
      input: {
        appId: "app-beta",
        allowedAssets: ["USDI"],
        maxPerRequest: "15",
        perUserDailyMax: "45",
        perAppDailyMax: "90",
        cooldownSeconds: 30,
      },
    });

    expect(snapshot.policies.get("app-beta")).toMatchObject({
      appId: "app-beta",
      allowedAssets: ["USDI"],
      updatedBy: "admin-2",
    });
  });

  it("defaults COMMUNITY_ADMIN scope to the first app", async () => {
    const { deps } = createDashboardFixtureDependencies(createFixture());
    const ctx = { role: "COMMUNITY_ADMIN" as const, adminUserId: "admin-1", db: deps.createDb() };

    await expect(deps.listApps(ctx)).resolves.toEqual([{ appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" }]);
    await expect(deps.listWithdrawals(ctx)).resolves.toEqual([]);
    await expect(deps.listPolicies(ctx)).resolves.toEqual([expect.objectContaining({ appId: "app-alpha" })]);
  });

  it("rejects COMMUNITY_ADMIN updates outside the managed scope", async () => {
    const { deps } = createDashboardFixtureDependencies(
      createFixture({
        communityAdminAppIds: ["app-beta"],
      }),
    );
    const ctx = { role: "COMMUNITY_ADMIN" as const, adminUserId: "admin-3", db: deps.createDb() };

    await expect(
      deps.upsertPolicy({
        ctx,
        input: {
          appId: "app-alpha",
          allowedAssets: ["CKB"],
          maxPerRequest: "10",
          perUserDailyMax: "20",
          perAppDailyMax: "30",
          cooldownSeconds: 10,
        },
      }),
    ).rejects.toThrow("COMMUNITY_ADMIN can only update policies for managed apps");
  });

  it("exposes monitoring, rate-limit, and backup fixture capabilities for SUPER_ADMIN flows", async () => {
    const { deps, snapshot } = createDashboardFixtureDependencies(
      createFixture({
        monitoringSummary: {
          status: "alert",
          generatedAt: "2026-03-21T08:00:00.000Z",
          readinessStatus: "ready",
          unpaidBacklog: 8,
          retryPendingCount: 1,
          withdrawalParityIssueCount: 0,
          alertCount: 1,
        },
        rateLimitConfig: {
          enabled: true,
          windowMs: "60000",
          maxRequests: "300",
          redisUrl: "redis://redis:6379/1",
          sourceLabel: "fixture",
        },
        backupBundles: [
          {
            id: "bundle-1",
            generatedAt: "bundle-1",
            overallStatus: "PASS",
            retentionDays: 30,
            dryRun: true,
            backupDir: "/tmp/bundle-1",
            archiveFile: "/tmp/bundle-1.tar.gz",
          },
        ],
      }),
    );

    await expect(deps.loadMonitoringSummary?.()).resolves.toMatchObject({
      status: "alert",
      unpaidBacklog: 8,
    });
    await expect(deps.loadRateLimitConfig?.()).resolves.toMatchObject({
      windowMs: "60000",
      maxRequests: "300",
    });
    await expect(deps.createRateLimitChangeSet({ enabled: true, windowMs: "90000", maxRequests: "500" })).resolves.toEqual({
      changedKeys: ["RPC_RATE_LIMIT_WINDOW_MS", "RPC_RATE_LIMIT_MAX_REQUESTS"],
      envSnippet: "RPC_RATE_LIMIT_WINDOW_MS=90000\nRPC_RATE_LIMIT_MAX_REQUESTS=500",
      rollbackSnippet: "RPC_RATE_LIMIT_WINDOW_MS=60000\nRPC_RATE_LIMIT_MAX_REQUESTS=300",
    });

    const capture = await deps.captureBackup();
    expect(capture.backupId).toBe("fixture-backup-001");
    expect(snapshot.backupBundles[0]?.id).toBe("fixture-backup-001");

    await expect(deps.buildBackupRestorePlan("fixture-backup-001")).resolves.toMatchObject({
      backupId: "fixture-backup-001",
      command: 'scripts/restore-compose-backup.sh --backup "/tmp/fixture-backup-001.tar.gz" --yes',
    });
  });
});
