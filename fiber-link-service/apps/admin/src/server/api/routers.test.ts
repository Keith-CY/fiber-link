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
    settlements: [
      {
        invoice: "lnfib1unpaidalpha",
        appId: "app-alpha",
        invoiceState: "UNPAID",
        settlementRetryCount: 2,
        settlementNextRetryAt: "2026-03-18T01:00:00.000Z",
        settlementLastError: "upstream timeout",
        settlementFailureReason: "RETRY_TRANSIENT_ERROR",
        createdAt: "2026-03-18T00:05:00.000Z",
        events: [
          { type: "TIP_CREATED", source: "TIP_CREATE", nextInvoiceState: "UNPAID" },
          { type: "SETTLEMENT_RETRY_SCHEDULED", source: "SETTLEMENT_DISCOVERY" },
        ],
      },
      {
        invoice: "lnfib1settledalpha",
        appId: "app-alpha",
        invoiceState: "SETTLED",
        settledAt: "2026-03-18T00:10:00.000Z",
        createdAt: "2026-03-18T00:01:00.000Z",
      },
    ],
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

describe("settlement investigation workflow (#470)", () => {
  it("lists settlements newest-first and filters by state for SUPER_ADMIN", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    const all = await caller.settlements.list({});
    expect(all.map((s) => s.invoice)).toEqual(["lnfib1unpaidalpha", "lnfib1settledalpha"]);

    const settled = await caller.settlements.list({ state: "SETTLED" });
    expect(settled).toHaveLength(1);
    expect(settled[0].invoice).toBe("lnfib1settledalpha");

    await expect(caller.settlements.list({ state: "NOPE" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("denies settlement procedures to COMMUNITY_ADMIN and anonymous callers", async () => {
    const community = createCaller(ctxFor("COMMUNITY_ADMIN", "c1"));
    await expect(community.settlements.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(community.settlements.retryNow({ invoice: "lnfib1unpaidalpha" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(createCaller(ctxFor(undefined)).settlements.timeline({ invoice: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns the lifecycle timeline for one invoice and NOT_FOUND for unknown invoices", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    const timeline = await caller.settlements.timeline({ invoice: "lnfib1unpaidalpha" });
    expect(timeline.intent.invoiceState).toBe("UNPAID");
    expect(timeline.intent.settlementFailureReason).toBe("RETRY_TRANSIENT_ERROR");
    expect(timeline.events.map((e) => e.type)).toEqual(["TIP_CREATED", "SETTLEMENT_RETRY_SCHEDULED"]);
    expect(timeline.adminActions).toEqual([]);

    await expect(caller.settlements.timeline({ invoice: "lnfib1missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("retryNow clears retry state and writes an audit record", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: "SUPER_ADMIN", adminUserId: "ops-user", requestId: "req-retry", services };
    const caller = createCaller(ctx);

    const intent = await caller.settlements.retryNow({ invoice: "lnfib1unpaidalpha" });
    expect(intent.settlementRetryCount).toBe(0);
    expect(intent.settlementNextRetryAt).toBeNull();
    expect(intent.settlementLastError).toBeNull();
    expect(intent.settlementFailureReason).toBeNull();

    const events = services.__listAuditEventsForTests?.() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "settlement.retry_now",
      targetType: "tip_intent",
      targetId: "lnfib1unpaidalpha",
      actorId: "ops-user",
      actorRole: "SUPER_ADMIN",
      requestId: "req-retry",
    });

    const timeline = await caller.settlements.timeline({ invoice: "lnfib1unpaidalpha" });
    expect(timeline.adminActions.map((a) => a.action)).toEqual(["settlement.retry_now"]);
  });

  it("retryNow rejects terminal invoices and audits nothing", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: "SUPER_ADMIN", adminUserId: "ops-user", requestId: "req-x", services };
    const caller = createCaller(ctx);

    await expect(caller.settlements.retryNow({ invoice: "lnfib1settledalpha" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(services.__listAuditEventsForTests?.() ?? []).toHaveLength(0);
  });

  it("addOpsNote records an audited note that shows up in the timeline", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: "SUPER_ADMIN", adminUserId: "ops-user", requestId: "req-note", services };
    const caller = createCaller(ctx);

    await caller.settlements.addOpsNote({ invoice: "lnfib1unpaidalpha", note: "confirmed with payer" });

    const events = services.__listAuditEventsForTests?.() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "settlement.ops_note.add",
      targetType: "tip_intent",
      targetId: "lnfib1unpaidalpha",
      reason: "confirmed with payer",
    });

    const timeline = await caller.settlements.timeline({ invoice: "lnfib1unpaidalpha" });
    expect(timeline.adminActions[0]).toMatchObject({
      action: "settlement.ops_note.add",
      reason: "confirmed with payer",
    });

    await expect(caller.settlements.addOpsNote({ invoice: "lnfib1missing", note: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.settlements.addOpsNote({ invoice: "lnfib1unpaidalpha", note: "  " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("admin mutation audit trail (#468)", () => {
  it("writes an audit event for withdrawal policy upserts with the resolved actor", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: "SUPER_ADMIN", adminUserId: "ops-user", requestId: "req-123", services };
    const caller = createCaller(ctx);

    await caller.withdrawalPolicy.upsert({
      appId: "app-alpha",
      allowedAssets: ["CKB"],
      maxPerRequest: "100",
      perUserDailyMax: "500",
      perAppDailyMax: "5000",
      cooldownSeconds: 60,
    });

    const events = services.__listAuditEventsForTests?.() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "withdrawal_policy.upsert",
      targetType: "withdrawal_policy",
      targetId: "app-alpha",
      actorId: "ops-user",
      actorRole: "SUPER_ADMIN",
      requestId: "req-123",
    });
    expect(events[0].after).toMatchObject({ appId: "app-alpha", cooldownSeconds: 60 });
  });

  it("writes audit events for ops mutations", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: "SUPER_ADMIN", adminUserId: "ops-user", requestId: "req-ops", services };
    const caller = createCaller(ctx);

    await caller.ops.createRateLimitChangeSet({
      enabled: true,
      windowMs: "60000",
      maxRequests: "100",
    });

    const actions = (services.__listAuditEventsForTests?.() ?? []).map((e) => e.action);
    expect(actions).toContain("rate_limit.change_set.create");
  });

  it("does not audit denied mutations", async () => {
    const services = createFixtureAdminServices(fixture());
    const ctx: TrpcContext = { role: undefined, adminUserId: undefined, services };
    const caller = createCaller(ctx);

    await expect(
      caller.ops.createRateLimitChangeSet({ enabled: true, windowMs: "60000", maxRequests: "100" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(services.__listAuditEventsForTests?.() ?? []).toHaveLength(0);
  });
});
