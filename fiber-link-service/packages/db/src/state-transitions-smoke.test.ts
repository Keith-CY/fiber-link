import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryLedgerRepo } from "./ledger-repo";
import {
  WithdrawalTransitionConflictError,
  createInMemoryWithdrawalRepo,
} from "./withdrawal-repo";
import { createInMemoryTipIntentRepo } from "./tip-intent-repo";

describe("db state transitions smoke", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();
  const withdrawalRepo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
    withdrawalRepo.__resetForTests?.();
  });

  it("persists created -> paid -> settling -> recorded flow", async () => {
    const tipIntent = await tipIntentRepo.create({
      appId: "app1",
      postId: "post-1",
      fromUserId: "tipper-1",
      toUserId: "creator-1",
      asset: "USDI",
      amount: "10",
      invoice: "inv-smoke-1",
    });
    expect(tipIntent.invoiceState).toBe("UNPAID");

    const paid = await tipIntentRepo.updateInvoiceState(tipIntent.invoice, "SETTLED");
    expect(paid.invoiceState).toBe("SETTLED");
    expect(paid.settledAt).not.toBeNull();

    await ledgerRepo.creditOnce({
      appId: tipIntent.appId,
      userId: tipIntent.toUserId,
      asset: tipIntent.asset,
      amount: tipIntent.amount,
      refId: tipIntent.id,
      idempotencyKey: `settlement:tip_intent:${tipIntent.id}`,
    });

    const request = await withdrawalRepo.createWithBalanceCheck(
      {
        appId: tipIntent.appId,
        userId: tipIntent.toUserId,
        asset: tipIntent.asset,
        amount: "6",
        toAddress: "fiber:invoice:withdraw-smoke",
      },
      { ledgerRepo },
    );
    expect(request.state).toBe("PENDING");

    const processing = await withdrawalRepo.markProcessing(request.id, new Date("2026-02-15T11:00:00.000Z"));
    expect(processing.state).toBe("PROCESSING");

    const recorded = await withdrawalRepo.markCompletedWithDebit(
      request.id,
      { now: new Date("2026-02-15T11:00:05.000Z"), txHash: "0xsmoke123" },
      { ledgerRepo },
    );
    expect(recorded.state).toBe("COMPLETED");
    expect(recorded.txHash).toBe("0xsmoke123");

    const entries = ledgerRepo.__listForTests?.() ?? [];
    const debit = entries.find((entry) => entry.idempotencyKey === `withdrawal:debit:${request.id}`);
    expect(debit?.type).toBe("debit");
  });

  it("rejects invalid transition writes and keeps persisted state unchanged", async () => {
    const request = await withdrawalRepo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "5",
      toAddress: "fiber:invoice:invalid-transition",
    });

    await expect(
      withdrawalRepo.markCompleted(request.id, {
        now: new Date("2026-02-15T11:10:00.000Z"),
        txHash: "0xshould-not-write",
      }),
    ).rejects.toBeInstanceOf(WithdrawalTransitionConflictError);

    const saved = await withdrawalRepo.findByIdOrThrow(request.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.txHash).toBeNull();
    expect(saved.completedAt).toBeNull();
  });

  it("keeps retry update idempotent under duplicate retry write attempts", async () => {
    const request = await withdrawalRepo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "5",
      toAddress: "fiber:invoice:retry-smoke",
    });

    await withdrawalRepo.markProcessing(request.id, new Date("2026-02-15T11:20:00.000Z"));
    const firstRetry = await withdrawalRepo.markRetryPending(request.id, {
      now: new Date("2026-02-15T11:20:05.000Z"),
      nextRetryAt: new Date("2026-02-15T11:21:05.000Z"),
      error: "transient timeout",
    });
    expect(firstRetry.state).toBe("RETRY_PENDING");
    expect(firstRetry.retryCount).toBe(1);

    await expect(
      withdrawalRepo.markRetryPending(request.id, {
        now: new Date("2026-02-15T11:20:10.000Z"),
        nextRetryAt: new Date("2026-02-15T11:21:10.000Z"),
        error: "duplicate retry write",
      }),
    ).rejects.toBeInstanceOf(WithdrawalTransitionConflictError);

    const saved = await withdrawalRepo.findByIdOrThrow(request.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
    expect(saved.lastError).toBe("transient timeout");
  });
});
