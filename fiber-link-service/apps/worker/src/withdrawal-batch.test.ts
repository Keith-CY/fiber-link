import { beforeEach, describe, expect, it } from "vitest";
import { WithdrawalTransitionConflictError, createInMemoryWithdrawalRepo } from "@fiber-link/db";
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
    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:02:00.000Z"),
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

  it("treats unexpected executor exception as permanent failure", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T10:00:00.000Z"),
      executeWithdrawal: async () => {
        throw new Error("invalid withdrawal payload");
      },
      repo,
    });

    expect(res.failed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });

  it("continues processing other items when markProcessing loses race", async () => {
    const first = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q-first",
    });
    const second = await repo.create({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "20",
      toAddress: "ckt1q-second",
    });

    const contentionRepo = {
      ...repo,
      async markProcessing(id: string, now: Date) {
        if (id === first.id) {
          throw new WithdrawalTransitionConflictError("PROCESSING", "PROCESSING", id);
        }
        return repo.markProcessing(id, now);
      },
    };

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T11:00:00.000Z"),
      executeWithdrawal: async () => ({ ok: true }),
      repo: contentionRepo,
    });

    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(1);
    const firstSaved = await repo.findByIdOrThrow(first.id);
    const secondSaved = await repo.findByIdOrThrow(second.id);
    expect(firstSaved.state).toBe("PENDING");
    expect(secondSaved.state).toBe("COMPLETED");
  });
});
