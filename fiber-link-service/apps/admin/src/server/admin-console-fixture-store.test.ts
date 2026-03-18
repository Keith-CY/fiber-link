import { describe, expect, it } from "vitest";
import { createFixtureAdminConsoleDependencies, type AdminConsoleFixture } from "./admin-console-fixture-store";

function createFixture(input?: Partial<AdminConsoleFixture>): AdminConsoleFixture {
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
    communityAdminAppIds: input?.communityAdminAppIds,
  };
}

describe("admin console fixture store", () => {
  it("keeps full visibility for SUPER_ADMIN and upserts policies", async () => {
    const { deps, snapshot } = createFixtureAdminConsoleDependencies(createFixture());
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
    const { deps } = createFixtureAdminConsoleDependencies(createFixture());
    const ctx = { role: "COMMUNITY_ADMIN" as const, adminUserId: "admin-1", db: deps.createDb() };

    await expect(deps.listApps(ctx)).resolves.toEqual([
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
    ]);
    await expect(deps.listWithdrawals(ctx)).resolves.toEqual([]);
    await expect(deps.listPolicies(ctx)).resolves.toEqual([
      expect.objectContaining({ appId: "app-alpha" }),
    ]);
  });

  it("rejects COMMUNITY_ADMIN updates outside the managed scope", async () => {
    const { deps } = createFixtureAdminConsoleDependencies(
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
});
