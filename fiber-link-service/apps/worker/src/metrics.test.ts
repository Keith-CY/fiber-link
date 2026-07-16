import { createInMemoryLedgerRepo, createInMemoryTipIntentRepo, createInMemoryWithdrawalRepo } from "@fiber-link/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureWorkerMetricsSources,
  isWorkerMetricsRequestAuthorized,
  parseWorkerMetricsPort,
  parseWorkerMetricsToken,
  recordWebhookDeliveryFailure,
  settlementCreditedTotal,
  startWorkerMetricsServer,
  webhookDeliveryFailuresTotal,
  withdrawalFailuresTotal,
  workerMetricsRegistry,
} from "./metrics";
import { markSettled } from "./settlement";
import { runWithdrawalBatch } from "./withdrawal-batch";

async function counterValue(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = workerMetricsRegistry.getSingleMetric(name);
  if (!metric) return 0;
  const data = await metric.get();
  const match = data.values.find((value) =>
    Object.entries(labels).every(([key, expected]) => (value.labels as Record<string, unknown>)[key] === expected),
  );
  return match?.value ?? 0;
}

afterEach(() => {
  configureWorkerMetricsSources(null);
});

describe("worker metrics config", () => {
  it("parses the optional metrics port and token", () => {
    expect(parseWorkerMetricsPort({} as NodeJS.ProcessEnv)).toBeNull();
    expect(parseWorkerMetricsPort({ WORKER_METRICS_PORT: "9464" } as NodeJS.ProcessEnv)).toBe(9464);
    expect(() => parseWorkerMetricsPort({ WORKER_METRICS_PORT: "not-a-port" } as NodeJS.ProcessEnv)).toThrow(
      /WORKER_METRICS_PORT/,
    );
    expect(parseWorkerMetricsToken({} as NodeJS.ProcessEnv)).toBeNull();
    expect(parseWorkerMetricsToken({ WORKER_METRICS_TOKEN: " s3cret " } as NodeJS.ProcessEnv)).toBe("s3cret");
  });

  it("authorizes scrapes with a matching bearer token only", () => {
    expect(isWorkerMetricsRequestAuthorized(undefined, null)).toBe(true);
    expect(isWorkerMetricsRequestAuthorized(undefined, "tok")).toBe(false);
    expect(isWorkerMetricsRequestAuthorized("Bearer tok", "tok")).toBe(true);
    expect(isWorkerMetricsRequestAuthorized("Bearer wrong", "tok")).toBe(false);
    expect(isWorkerMetricsRequestAuthorized(`Bearer ${"x".repeat(600)}`, "tok")).toBe(false);
  });
});

describe("settlement metrics emission", () => {
  it("counts applied credits once across idempotent replays", async () => {
    const tipIntentRepo = createInMemoryTipIntentRepo();
    const ledgerRepo = createInMemoryLedgerRepo();
    await tipIntentRepo.create({
      appId: "app-1",
      postId: "post-1",
      fromUserId: "tipper",
      toUserId: "author",
      asset: "CKB",
      amount: "100",
      invoice: "inv-metrics-1",
    });

    const before = await counterValue("fiber_link_settlement_credited_total");
    const first = await markSettled({ invoice: "inv-metrics-1" }, { tipIntentRepo, ledgerRepo });
    expect(first.credited).toBe(true);
    const replay = await markSettled({ invoice: "inv-metrics-1" }, { tipIntentRepo, ledgerRepo });
    expect(replay.credited).toBe(false);

    expect(await counterValue("fiber_link_settlement_credited_total")).toBe(before + 1);
    expect(settlementCreditedTotal).toBeDefined();
  });
});

describe("withdrawal metrics emission", () => {
  it("counts permanent execution failures with the failure kind", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const created = await repo.create({
      appId: "app-1",
      userId: "author",
      asset: "CKB",
      amount: "10",
      toAddress: "ckt1qexample",
    });

    const before = await counterValue("fiber_link_withdrawal_failures_total", { kind: "permanent" });
    const summary = await runWithdrawalBatch({
      repo,
      executeWithdrawal: async () => ({ ok: false, kind: "permanent", reason: "invalid destination" }),
    });
    expect(summary.failed).toBe(1);
    expect(await counterValue("fiber_link_withdrawal_failures_total", { kind: "permanent" })).toBe(before + 1);
    expect((await repo.findByIdOrThrow(created.id)).state).toBe("FAILED");
    expect(withdrawalFailuresTotal).toBeDefined();
  });

  it("observes withdrawal batch duration on every run", async () => {
    await runWithdrawalBatch({ repo: createInMemoryWithdrawalRepo() });
    const metric = workerMetricsRegistry.getSingleMetric("fiber_link_withdrawal_batch_duration_seconds");
    expect(metric).toBeDefined();
    const data = await metric?.get();
    const countSample = data?.values.find((value) => (value as { metricName?: string }).metricName?.endsWith("_count"));
    expect(countSample?.value ?? 0).toBeGreaterThan(0);
  });
});

describe("webhook delivery failure recorder", () => {
  it("increments the counter", async () => {
    const before = await counterValue("fiber_link_webhook_delivery_failures_total");
    recordWebhookDeliveryFailure();
    expect(await counterValue("fiber_link_webhook_delivery_failures_total")).toBe(before + 1);
    expect(webhookDeliveryFailuresTotal).toBeDefined();
  });
});

describe("scrape-time gauges and HTTP exposition", () => {
  it("serves gauges from injected sources and enforces the bearer token", async () => {
    configureWorkerMetricsSources({
      countUnpaidBacklog: async () => 7,
      countSettlementRetryPending: async () => 3,
      countWithdrawalsByState: async () => [
        { state: "PENDING", count: 2 },
        { state: "FAILED", count: 1 },
      ],
      countNegativeBalanceAccounts: async () => 1,
    });

    const server = startWorkerMetricsServer({ port: 0, token: "scrape-token" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const unauthorized = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(unauthorized.status).toBe(401);

      const notFound = await fetch(`http://127.0.0.1:${port}/other`, {
        headers: { authorization: "Bearer scrape-token" },
      });
      expect(notFound.status).toBe(404);

      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: "Bearer scrape-token" },
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("fiber_link_settlement_backlog_unpaid 7");
      expect(body).toContain("fiber_link_settlement_retry_pending 3");
      expect(body).toContain('fiber_link_withdrawal_state_count{state="PENDING"} 2');
      expect(body).toContain('fiber_link_withdrawal_state_count{state="FAILED"} 1');
      expect(body).toContain("fiber_link_ledger_negative_balance_accounts 1");
      expect(body).toContain("fiber_link_settlement_failures_total");
    } finally {
      server.close();
    }
  });

  it("skips gauge collection when no sources are configured", async () => {
    configureWorkerMetricsSources(null);
    const body = await workerMetricsRegistry.metrics();
    expect(body).toContain("fiber_link_settlement_backlog_unpaid");
  });
});
