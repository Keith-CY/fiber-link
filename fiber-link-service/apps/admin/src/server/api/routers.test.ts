import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { type DashboardFixture, createFixtureAdminServices } from "../services/fixture-services";
import { appRouter } from "./root";
import { createCallerFactory } from "./trpc";
import type { TrpcContext } from "./trpc";

const createCaller = createCallerFactory(appRouter);

function fixture(): DashboardFixture {
  return {
    apps: [
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
      { appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" },
    ],
    withdrawals: [
      {
        id: "w-1",
        appId: "app-alpha",
        userId: "u1",
        asset: "CKB",
        amount: "1",
        state: "FAILED",
        createdAt: "2026-03-18T00:00:00.000Z",
        txHash: null,
      },
    ],
    policies: [],
    communityAdminAppIds: ["app-alpha"],
    backupBundles: [
      {
        id: "b-1",
        generatedAt: "b-1",
        overallStatus: "PASS",
        retentionDays: 30,
        dryRun: true,
        backupDir: "/tmp/b-1",
        archiveFile: null,
      },
    ],
  };
}

function ctxFor(role: TrpcContext["role"], adminUserId?: string): TrpcContext {
  return { role, adminUserId, services: createFixtureAdminServices(fixture()) };
}

describe("admin tRPC routers", () => {
  it("session.me reports the resolved role and null when absent", async () => {
    expect((await createCaller(ctxFor("SUPER_ADMIN", "ops")).session.me()).role).toBe("SUPER_ADMIN");
    expect((await createCaller(ctxFor(undefined)).session.me()).role).toBeNull();
  });

  it("rejects admin queries when no role is supplied", async () => {
    await expect(createCaller(ctxFor(undefined)).apps.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists apps and withdrawals for SUPER_ADMIN", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    expect((await caller.apps.list()).map((a) => a.appId)).toEqual(["app-alpha", "app-beta"]);
    const failed = await caller.withdrawals.list({ state: "FAILED" });
    expect(failed).toHaveLength(1);
  });

  it("rejects an unknown withdrawal state filter", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    await expect(caller.withdrawals.list({ state: "NOPE" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns a zero-filled per-state summary scoped to the caller", async () => {
    const summary = await createCaller(ctxFor("SUPER_ADMIN", "ops")).withdrawals.stateSummary();
    expect(summary).toHaveLength(7);
    expect(summary.find((s) => s.state === "FAILED")?.count).toBe(1);
    expect(summary.find((s) => s.state === "PENDING")?.count).toBe(0);

    // COMMUNITY_ADMIN scope excludes nothing here (w-1 is in app-alpha), so
    // the count survives; an unassigned role gets FORBIDDEN via adminProcedure.
    const scoped = await createCaller(ctxFor("COMMUNITY_ADMIN", "c1")).withdrawals.stateSummary();
    expect(scoped.find((s) => s.state === "FAILED")?.count).toBe(1);
    await expect(createCaller(ctxFor(undefined)).withdrawals.stateSummary()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects invalid withdrawal-policy input with BAD_REQUEST", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    await expect(caller.withdrawalPolicy.upsert({ appId: "" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("forbids COMMUNITY_ADMIN from editing an unmanaged app policy", async () => {
    const caller = createCaller(ctxFor("COMMUNITY_ADMIN", "community-1"));
    await expect(
      caller.withdrawalPolicy.upsert({
        appId: "app-beta",
        allowedAssets: ["CKB"],
        maxPerRequest: "1",
        perUserDailyMax: "1",
        perAppDailyMax: "1",
        cooldownSeconds: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("scopes ops procedures to SUPER_ADMIN", async () => {
    await expect(createCaller(ctxFor("COMMUNITY_ADMIN", "c")).ops.monitoring()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const summary = await createCaller(ctxFor("SUPER_ADMIN", "ops")).ops.monitoring();
    expect(summary.status).toBeDefined();
  });

  it("captures backups and builds a restore plan over tRPC", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    const captured = await caller.ops.captureBackup();
    expect(captured.backupId).toContain("fixture-backup");
    const plan = await caller.ops.restorePlan({ backupId: captured.backupId });
    expect(plan.command).toContain("restore-compose-backup.sh");
  });

  it("rejects a rate-limit change set with a non-numeric window", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    await expect(
      caller.ops.createRateLimitChangeSet({ enabled: true, windowMs: "abc", maxRequests: "10" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
