import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryLedgerRepo, createInMemoryTipIntentRepo } from "@fiber-link/db";
import { FiberRpcError } from "@fiber-link/fiber-adapter";
import { runSettlementDiscovery } from "./settlement-discovery";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";

describe("runSettlementDiscovery", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
  });

  it("processes UNPAID intents and applies state transitions from invoice status", async () => {
    const settled = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-scan-settled",
    });
    const failed = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-scan-failed",
    });
    await tipIntentRepo.create({
      appId: "app-a",
      postId: "p3",
      fromUserId: "u5",
      toUserId: "u6",
      asset: "USDI",
      amount: "30",
      invoice: "inv-scan-unpaid",
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus({ invoice }: { invoice: string }) {
          if (invoice === settled.invoice) return { state: "SETTLED" as const };
          if (invoice === failed.invoice) return { state: "FAILED" as const };
          return { state: "UNPAID" as const };
        },
      },
    });

    expect(summary.scanned).toBe(3);
    expect(summary.settledCredits).toBe(1);
    expect(summary.settledDuplicates).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.stillUnpaid).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.events).toHaveLength(3);
    expect(summary.events.map((event) => event.outcome).sort()).toEqual([
      "FAILED_UPSTREAM_REPORTED",
      "NO_CHANGE",
      "SETTLED_CREDIT_APPLIED",
    ]);
  });

  it("is idempotent for replays and marks settled when credit already exists", async () => {
    const intent = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-replay",
    });

    await ledgerRepo.creditOnce({
      appId: intent.appId,
      userId: intent.toUserId,
      asset: intent.asset,
      amount: intent.amount,
      refId: intent.id,
      idempotencyKey: `settlement:tip_intent:${intent.id}`,
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus() {
          return { state: "SETTLED" as const };
        },
      },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.settledCredits).toBe(0);
    expect(summary.settledDuplicates).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]).toMatchObject({
      type: "settlement.update",
      invoice: "inv-replay",
      previousState: "UNPAID",
      observedState: "SETTLED",
      nextState: "SETTLED",
      outcome: "SETTLED_DUPLICATE",
      ledgerCreditApplied: false,
    });

    const saved = await tipIntentRepo.findByInvoiceOrThrow(intent.invoice);
    expect(saved.invoiceState).toBe("SETTLED");
  });

  it("marks invalid adapter contract state as terminal mismatch and persists failure evidence", async () => {
    await tipIntentRepo.create({
      appId: "app-a",
      postId: "p-invalid",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-invalid",
    });

    const auditContexts: Record<string, unknown>[] = [];
    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      logger: {
        info(_message, context) {
          if (context?.invoice === "inv-invalid") {
            auditContexts.push(context);
          }
        },
        error() {},
      },
      adapter: {
        async getInvoiceStatus() {
          return { state: "UNKNOWN_STATE" };
        },
      },
    });

    expect(summary.errors).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.terminalFailures).toBe(1);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]).toMatchObject({
      invoice: "inv-invalid",
      outcome: "FAILED_CONTRACT_MISMATCH",
      nextState: "FAILED",
      failureClass: "TERMINAL",
    });

    const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-invalid");
    expect(saved.invoiceState).toBe("FAILED");
    expect(saved.settledAt).toBeNull();
    expect(saved.settlementFailureReason).toBe("FAILED_CONTRACT_MISMATCH");
    expect(saved.settlementLastError).toContain("UNKNOWN_STATE");
    expect(saved.settlementRetryCount).toBe(0);
    expect(saved.settlementNextRetryAt).toBeNull();
    expect(summary.scanned).toBe(1);
    expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
    expect(auditContexts).toEqual(
      expect.arrayContaining([expect.objectContaining({ invoice: "inv-invalid", failureClass: "TERMINAL" })]),
    );
  });

  it("schedules transient settlement errors and eventually marks terminal after retry budget exhaustion", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T14:00:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p-retry-budget",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-retry-budget",
      });
    } finally {
      vi.useRealTimers();
    }

    const adapter = {
      getInvoiceStatus: vi.fn(async () => {
        throw new FiberRpcError("internal error", -32603);
      }),
    };

    const now = new Date("2026-02-11T14:05:00.000Z").getTime();
    const first = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter,
      maxRetries: 1,
      retryDelayMs: 60_000,
      pendingTimeoutMs: 30 * 60_000,
      nowMsFn: () => now,
    });
    expect(first.retryScheduled).toBe(1);
    expect(first.terminalFailures).toBe(0);
    expect(adapter.getInvoiceStatus).toHaveBeenCalledTimes(1);

    const afterFirst = await tipIntentRepo.findByInvoiceOrThrow("inv-retry-budget");
    expect(afterFirst.invoiceState).toBe("UNPAID");
    expect(afterFirst.settlementRetryCount).toBe(1);
    expect(afterFirst.settlementNextRetryAt?.toISOString()).toBe("2026-02-11T14:06:00.000Z");
    expect(afterFirst.settlementLastError).toContain("internal error");

    const second = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter,
      maxRetries: 1,
      retryDelayMs: 60_000,
      pendingTimeoutMs: 30 * 60_000,
      nowMsFn: () => new Date("2026-02-11T14:06:01.000Z").getTime(),
    });
    expect(second.retryScheduled).toBe(0);
    expect(second.terminalFailures).toBe(1);
    expect(second.failed).toBe(1);
    expect(second.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcome: "FAILED_RETRY_EXHAUSTED", invoice: "inv-retry-budget" })]),
    );

    const afterSecond = await tipIntentRepo.findByInvoiceOrThrow("inv-retry-budget");
    expect(afterSecond.invoiceState).toBe("FAILED");
    expect(afterSecond.settlementFailureReason).toBe("FAILED_RETRY_EXHAUSTED");
    expect(afterSecond.settlementNextRetryAt).toBeNull();
  });

  it("recovers transient settlement errors within retry policy once upstream responds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T15:00:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p-retry-recover",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-retry-recover",
      });
    } finally {
      vi.useRealTimers();
    }

    let attempts = 0;
    const adapter = {
      async getInvoiceStatus() {
        attempts += 1;
        if (attempts === 1) {
          throw new FiberRpcError("internal error", -32603);
        }
        return { state: "SETTLED" as const };
      },
    };

    const first = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter,
      maxRetries: 3,
      retryDelayMs: 60_000,
      pendingTimeoutMs: 30 * 60_000,
      nowMsFn: () => new Date("2026-02-11T15:05:00.000Z").getTime(),
    });
    expect(first.retryScheduled).toBe(1);

    const second = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter,
      maxRetries: 3,
      retryDelayMs: 60_000,
      pendingTimeoutMs: 30 * 60_000,
      nowMsFn: () => new Date("2026-02-11T15:06:00.000Z").getTime(),
    });
    expect(second.settledCredits).toBe(1);
    expect(second.retryScheduled).toBe(0);
    expect(second.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcome: "SETTLED_CREDIT_APPLIED", invoice: "inv-retry-recover" })]),
    );

    const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-retry-recover");
    expect(saved.invoiceState).toBe("SETTLED");
    expect(saved.settlementRetryCount).toBe(0);
    expect(saved.settlementNextRetryAt).toBeNull();
    expect(saved.settlementLastError).toBeNull();
    expect(saved.settlementFailureReason).toBeNull();
  });

  it("marks long-pending unpaid settlements as terminal timeout failures", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T16:00:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p-timeout",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-timeout",
      });
    } finally {
      vi.useRealTimers();
    }

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      pendingTimeoutMs: 5 * 60_000,
      nowMsFn: () => new Date("2026-02-11T16:10:00.000Z").getTime(),
      adapter: {
        async getInvoiceStatus() {
          return { state: "UNPAID" as const };
        },
      },
    });

    expect(summary.failed).toBe(1);
    expect(summary.terminalFailures).toBe(1);
    expect(summary.stillUnpaid).toBe(0);
    expect(summary.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcome: "FAILED_PENDING_TIMEOUT", invoice: "inv-timeout" })]),
    );

    const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-timeout");
    expect(saved.invoiceState).toBe("FAILED");
    expect(saved.settlementFailureReason).toBe("FAILED_PENDING_TIMEOUT");
  });

  it("supports app and time-window filters for backfill", async () => {
    const inWindow = await tipIntentRepo.create({
      appId: "app-a",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-window-1",
    });
    await tipIntentRepo.create({
      appId: "app-b",
      postId: "p2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "20",
      invoice: "inv-window-2",
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      appId: "app-a",
      createdAtFrom: new Date(inWindow.createdAt.getTime() - 1),
      createdAtTo: new Date(inWindow.createdAt.getTime() + 1),
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus() {
          return { state: "UNPAID" as const };
        },
      },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.stillUnpaid).toBe(1);
  });


  it("skips intents whose retry delay is in the future", async () => {
    const now = new Date("2026-02-11T10:00:00.000Z");
    await tipIntentRepo.create({
      appId: "app-a",
      postId: "p-skip",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-skip-retry",
    });

    await tipIntentRepo.markSettlementRetryPending("inv-skip-retry", {
      now,
      nextRetryAt: new Date("2026-02-11T10:10:00.000Z"),
      error: "transient; retry later",
    });

    const adapter = {
      getInvoiceStatus: async () => {
        throw new Error("should not be called");
      },
    };

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter,
      nowMsFn: () => now.getTime(),
    });

    expect(summary.scanned).toBe(1);
    expect(summary.skippedRetryPending).toBe(1);
    expect(summary.events).toHaveLength(0);
    expect(summary.retryScheduled).toBe(0);
  });

  it("maps terminal-like rpc errors to terminal failure", async () => {
    await tipIntentRepo.create({
      appId: "app-a",
      postId: "p-terminal-rpc",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
      invoice: "inv-terminal-rpc",
    });

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus() {
          throw new FiberRpcError("invalid request payload", -32600);
        },
      },
    });

    expect(summary.failed).toBe(1);
    expect(summary.terminalFailures).toBe(1);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]).toMatchObject({
      invoice: "inv-terminal-rpc",
      outcome: "FAILED_TERMINAL_ERROR",
      failureClass: "TERMINAL",
    });

    const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-terminal-rpc");
    expect(saved.invoiceState).toBe("FAILED");
    expect(saved.settlementFailureReason).toBe("FAILED_TERMINAL_ERROR");
  });

  it("supports cursor pagination and wraps to avoid fixed-limit starvation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T12:00:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-cursor-1",
      });
      vi.setSystemTime(new Date("2026-02-11T12:00:01.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-cursor-2",
      });
      vi.setSystemTime(new Date("2026-02-11T12:00:02.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p3",
        fromUserId: "u5",
        toUserId: "u6",
        asset: "USDI",
        amount: "30",
        invoice: "inv-cursor-3",
      });
    } finally {
      vi.useRealTimers();
    }

    const seenInvoices: string[] = [];
    let cursor:
      | {
          createdAt: Date;
          id: string;
        }
      | undefined;

    for (let i = 0; i < 4; i += 1) {
      const summary = await runSettlementDiscovery({
        limit: 1,
        cursor,
        pendingTimeoutMs: 24 * 60 * 60_000,
        nowMsFn: () => new Date("2026-02-11T12:00:03.000Z").getTime(),
        tipIntentRepo,
        ledgerRepo,
        adapter: {
          async getInvoiceStatus({ invoice }) {
            seenInvoices.push(invoice);
            return { state: "UNPAID" as const };
          },
        },
      });
      cursor = summary.nextCursor ?? undefined;
    }

    expect(seenInvoices).toEqual(["inv-cursor-1", "inv-cursor-2", "inv-cursor-3", "inv-cursor-1"]);
  });

  it("persists cursor across restarts and resumes without skipping invoices", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T12:30:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-restart-1",
      });
      vi.setSystemTime(new Date("2026-02-11T12:30:01.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-restart-2",
      });
      vi.setSystemTime(new Date("2026-02-11T12:30:02.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p3",
        fromUserId: "u5",
        toUserId: "u6",
        asset: "USDI",
        amount: "30",
        invoice: "inv-restart-3",
      });
    } finally {
      vi.useRealTimers();
    }

    const root = await mkdtemp(join(tmpdir(), "fiber-link-settlement-restart-"));
    const cursorFilePath = join(root, "cursor.json");
    let cursorStore = createFileSettlementCursorStore(cursorFilePath);

    const seenInvoices: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const cursor = await cursorStore.load();
      const summary = await runSettlementDiscovery({
        limit: 1,
        cursor,
        pendingTimeoutMs: 24 * 60 * 60_000,
        nowMsFn: () => new Date("2026-02-11T12:30:03.000Z").getTime(),
        tipIntentRepo,
        ledgerRepo,
        adapter: {
          async getInvoiceStatus({ invoice }) {
            seenInvoices.push(invoice);
            return { state: "UNPAID" as const };
          },
        },
      });

      await cursorStore.save(summary.nextCursor ?? undefined);

      // Simulate process restart by creating a new store instance for each scan.
      cursorStore = createFileSettlementCursorStore(cursorFilePath);
    }

    expect(seenInvoices).toEqual(["inv-restart-1", "inv-restart-2", "inv-restart-3"]);
  });

  it("emits backlog and detection latency metrics in summary", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-11T13:00:00.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        invoice: "inv-metric-old",
      });
      vi.setSystemTime(new Date("2026-02-11T13:00:05.000Z"));
      await tipIntentRepo.create({
        appId: "app-a",
        postId: "p2",
        fromUserId: "u3",
        toUserId: "u4",
        asset: "USDI",
        amount: "20",
        invoice: "inv-metric-new",
      });
      vi.setSystemTime(new Date("2026-02-11T13:00:20.000Z"));
    } finally {
      vi.useRealTimers();
    }

    const summary = await runSettlementDiscovery({
      limit: 100,
      tipIntentRepo,
      ledgerRepo,
      adapter: {
        async getInvoiceStatus({ invoice }) {
          if (invoice === "inv-metric-old") {
            return { state: "SETTLED" as const };
          }
          return { state: "UNPAID" as const };
        },
      },
      nowMsFn: () => new Date("2026-02-11T13:00:20.000Z").getTime(),
    });

    expect(summary.backlogUnpaidBeforeScan).toBe(2);
    expect(summary.backlogUnpaidAfterScan).toBe(1);
    expect(summary.detectionLatencyMs.count).toBe(1);
    expect(summary.detectionLatencyMs.p50).toBe(20_000);
    expect(summary.detectionLatencyMs.p95).toBe(20_000);
  });
});
