import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  type InvoiceState,
} from "@fiber-link/db";
import { runSettlementDiscovery } from "./settlement-discovery";
import { startSettlementSubscriptionRunner } from "./settlement-subscription-runner";
import { createWorkerRuntime } from "./worker-runtime";
import { createComponentLogger } from "./logger";

describe("worker structured logging contract", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured startup/shutdown payloads", async () => {
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args[0]);
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args[0]);
    });
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args[0]);
    });

    const runtime = createWorkerRuntime({
      intervalMs: 1000,
      maxRetries: 3,
      retryDelayMs: 100,
      shutdownTimeoutMs: 100,
      runWithdrawalBatch: async () => undefined,
      exitFn: () => undefined,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await runtime.start();
    await runtime.shutdown("manual");

    const started = logs.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).event === "worker.runtime.started",
    ) as Record<string, unknown> | undefined;
    const shutdown = logs.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).event === "worker.runtime.shutdown",
    ) as Record<string, unknown> | undefined;

    expect(started).toMatchObject({
      component: "worker-runtime",
      event: "worker.runtime.started",
      severity: "info",
    });
    expect(shutdown).toMatchObject({
      component: "worker-runtime",
      event: "worker.runtime.shutdown",
      severity: "info",
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("emits structured subscription event payload with settlement correlation id", async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args[0]);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const intent = await tipIntentRepo.create({
      appId: "app-log",
      postId: "post-log",
      fromUserId: "from-log",
      toUserId: "to-log",
      asset: "USDI",
      amount: "7",
      invoice: "inv-log-1",
    });
    let emit: ((invoice: string) => void | Promise<void>) | null = null;
    const runner = await startSettlementSubscriptionRunner({
      adapter: {
        async subscribeSettlements(args) {
          emit = args.onSettled;
          return { close: () => undefined };
        },
      },
      tipIntentRepo,
      ledgerRepo,
    });

    await emit?.(intent.invoice);
    await runner.close();

    const payload = logs.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).event === "settlement.subscription.processed",
    ) as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      component: "settlement-subscription-runner",
      event: "settlement.subscription.processed",
      severity: "info",
      invoice: intent.invoice,
      requestId: `settlement:${intent.invoice}`,
    });
  });

  it("emits structured fallback scan summary payload", async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args[0]);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const invoiceStates = new Map<string, InvoiceState>();
    const intent = await tipIntentRepo.create({
      appId: "app-fallback-log",
      postId: "post-fallback-log",
      fromUserId: "from-fallback-log",
      toUserId: "to-fallback-log",
      asset: "USDI",
      amount: "6",
      invoice: "inv-fallback-log",
    });
    invoiceStates.set(intent.invoice, "SETTLED");

    await runSettlementDiscovery({
      limit: 10,
      adapter: {
        async getInvoiceStatus({ invoice }) {
          return { state: invoiceStates.get(invoice) ?? "UNPAID" };
        },
      },
      tipIntentRepo,
      ledgerRepo,
    });

    const summary = logs.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).event === "settlement.discovery.summary",
    ) as Record<string, unknown> | undefined;

    expect(summary).toMatchObject({
      component: "settlement-discovery",
      event: "settlement.discovery.summary",
      severity: "info",
    });
    expect(summary?.scanned).toBe(1);
    expect(summary?.settledCredits).toBe(1);
  });

  it("serializes bigint/error context and supports warn/error severities", () => {
    const logs: unknown[] = [];
    const warns: unknown[] = [];
    const errors: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args[0]));
    vi.spyOn(console, "warn").mockImplementation((...args) => warns.push(args[0]));
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args[0]));

    const logger = createComponentLogger("logger-contract");
    logger.info("info.event", {
      count: 1n as unknown as number,
      error: new Error("boom"),
    } as Record<string, unknown>);
    logger.warn("warn.event", { reason: "slow-path" });
    logger.error("error.event", { reason: "failed-path" });

    expect(logs[0]).toMatchObject({
      component: "logger-contract",
      event: "info.event",
      severity: "info",
      count: "1",
      error: {
        message: "boom",
      },
    });
    expect(warns[0]).toMatchObject({
      component: "logger-contract",
      event: "warn.event",
      severity: "warn",
      reason: "slow-path",
    });
    expect(errors[0]).toMatchObject({
      component: "logger-contract",
      event: "error.event",
      severity: "error",
      reason: "failed-path",
    });
  });

  it("falls back to details string when context cannot be JSON-serialized", () => {
    const logs: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args[0]));

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const logger = createComponentLogger("logger-contract");
    logger.info("circular.event", circular as unknown as Record<string, unknown>);

    expect(logs[0]).toMatchObject({
      component: "logger-contract",
      event: "circular.event",
      severity: "info",
      details: "[object Object]",
    });
  });
});
