import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryWithdrawalRepo } from "@fiber-link/db";
import { runWithdrawalBatch } from "./withdrawal-batch";

describe("runWithdrawalBatch", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests();
  });

  it("moves transient failure to RETRY_PENDING with nextRetryAt", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const now = new Date("2026-02-07T10:00:00.000Z");
    const res = await runWithdrawalBatch({
      now,
      retryDelayMs: 60_000,
      executeWithdrawal: async () => ({
        ok: false,
        kind: "transient",
        reason: "node busy",
      }),
      repo,
    });

    expect(res.processed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
    expect(saved.nextRetryAt?.toISOString()).toBe("2026-02-07T10:01:00.000Z");
  });

  it("moves transient failure to FAILED after retry budget exhausted", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const executeWithdrawal = async () =>
      ({
        ok: false,
        kind: "transient",
        reason: "temporary network issue",
      }) as const;

    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:00:00.000Z"),
      maxRetries: 2,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });
    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:01:00.000Z"),
      maxRetries: 2,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(2);
    expect(saved.nextRetryAt).toBeNull();
  });
});
