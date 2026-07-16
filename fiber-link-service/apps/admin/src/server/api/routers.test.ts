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
    ledgerEntries: [
      {
        id: "le-1",
        appId: "app-alpha",
        userId: "author-1",
        amount: "100",
        type: "credit",
        refId: "lnfib1settledalpha",
        createdAt: "2026-03-18T00:11:00.000Z",
      },
      {
        id: "le-2",
        appId: "app-alpha",
        userId: "author-1",
        amount: "30",
        type: "debit",
        refId: "w-orphan",
        createdAt: "2026-03-18T00:12:00.000Z",
      },
      {
        id: "le-3",
        appId: "app-beta",
        userId: "author-9",
        amount: "5",
        type: "credit",
        refId: "tip-unknown",
        createdAt: "2026-03-18T00:13:00.000Z",
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
    expect(failed.items).toHaveLength(1);
    expect(failed.nextCursor).toBeNull();
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
    expect(all.items.map((s) => s.invoice)).toEqual(["lnfib1unpaidalpha", "lnfib1settledalpha"]);
    expect(all.nextCursor).toBeNull();

    const settled = await caller.settlements.list({ state: "SETTLED" });
    expect(settled.items).toHaveLength(1);
    expect(settled.items[0].invoice).toBe("lnfib1settledalpha");

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

describe("ledger reconciliation and balance explanation (#471)", () => {
  it("pages the ledger statement with an opaque keyset cursor", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));

    const firstPage = await caller.ledger.entries({ appId: "app-alpha", userId: "author-1", limit: 1 });
    expect(firstPage.entries.map((entry) => entry.id)).toEqual(["le-2"]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await caller.ledger.entries({
      appId: "app-alpha",
      userId: "author-1",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.entries.map((entry) => entry.id)).toEqual(["le-1"]);
    expect(secondPage.nextCursor).toBeNull();

    const credits = await caller.ledger.entries({ appId: "app-alpha", type: "credit" });
    expect(credits.entries).toHaveLength(1);

    await expect(caller.ledger.entries({ appId: "app-alpha", asset: "DOGE" } as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.ledger.entries({ appId: "app-alpha", cursor: "not-a-cursor" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("explains a balance from source credits and debits", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    const breakdown = await caller.ledger.balanceBreakdown({ appId: "app-alpha", userId: "author-1", asset: "CKB" });
    expect(breakdown).toMatchObject({
      balance: "70",
      creditTotal: "100",
      debitTotal: "30",
      creditCount: 1,
      debitCount: 1,
    });
    expect(breakdown.firstEntryAt).toBe("2026-03-18T00:11:00.000Z");
  });

  it("reports anomaly counts and example entry ids from reconciliation", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));
    const report = await caller.ledger.reconcile({});

    expect(report.countsByKind.DEBIT_WITHOUT_COMPLETED_WITHDRAWAL).toBe(1);
    expect(report.countsByKind.CREDIT_WITHOUT_SETTLED_TIP).toBe(1);
    expect(report.countsByKind.SETTLED_TIP_MISSING_CREDIT).toBe(0);
    expect(report.anomalies).toHaveLength(2);

    const orphanDebit = report.anomalies.find((anomaly) => anomaly.kind === "DEBIT_WITHOUT_COMPLETED_WITHDRAWAL");
    expect(orphanDebit?.entryIds).toEqual(["le-2"]);

    // The settled tip (with its matching credit) and the FAILED withdrawal are clean.
    expect(report.checked.tipIntents).toBe(2);
    expect(report.checked.withdrawals).toBe(1);

    const scopedToAlpha = await caller.ledger.reconcile({ appId: "app-alpha" });
    expect(scopedToAlpha.anomalies).toHaveLength(1);
    expect(scopedToAlpha.anomalies[0]?.kind).toBe("DEBIT_WITHOUT_COMPLETED_WITHDRAWAL");

    await expect(
      caller.ledger.reconcile({ from: "2026-03-19T00:00:00.000Z", to: "2026-03-18T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("denies ledger procedures to COMMUNITY_ADMIN and anonymous callers", async () => {
    await expect(
      createCaller(ctxFor("COMMUNITY_ADMIN", "c1")).ledger.entries({ appId: "app-alpha" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createCaller(ctxFor(undefined)).ledger.reconcile({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin list pagination and exact search (#473)", () => {
  it("supports exact search on withdrawals by id, user id, and tx hash", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));

    const byId = await caller.withdrawals.list({ id: "w-1" });
    expect(byId.items.map((row) => row.id)).toEqual(["w-1"]);

    const byUser = await caller.withdrawals.list({ userId: "u1" });
    expect(byUser.items).toHaveLength(1);

    const byTx = await caller.withdrawals.list({ txHash: "0xmissing" });
    expect(byTx.items).toEqual([]);

    await expect(caller.withdrawals.list({ asset: "DOGE" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.withdrawals.list({ cursor: "junk" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.withdrawals.list({ createdFrom: "not-a-date" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("pages settlements newest-first through the keyset cursor", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));

    const firstPage = await caller.settlements.list({ limit: 1 });
    expect(firstPage.items.map((row) => row.invoice)).toEqual(["lnfib1unpaidalpha"]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await caller.settlements.list({ limit: 1, cursor: firstPage.nextCursor ?? undefined });
    expect(secondPage.items.map((row) => row.invoice)).toEqual(["lnfib1settledalpha"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("supports exact settlement search by invoice and user", async () => {
    const caller = createCaller(ctxFor("SUPER_ADMIN", "ops"));

    const byInvoice = await caller.settlements.list({ invoice: "lnfib1settledalpha" });
    expect(byInvoice.items.map((row) => row.invoice)).toEqual(["lnfib1settledalpha"]);

    const byUser = await caller.settlements.list({ userId: "author-1" });
    expect(byUser.items).toHaveLength(2);

    const byUnknownUser = await caller.settlements.list({ userId: "nobody" });
    expect(byUnknownUser.items).toEqual([]);
  });

  it("keeps community-admin scoping and PII redaction on paged withdrawals", async () => {
    const caller = createCaller(ctxFor("COMMUNITY_ADMIN", "c1"));
    const page = await caller.withdrawals.list({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].appId).toBe("app-alpha");
    expect(page.items[0].userId).toBe("");
    expect(page.items[0].toAddress).toBeNull();
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
