import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { createInMemoryLedgerRepo } from "./ledger-repo";
import {
  WithdrawalRevivalBlockedError,
  WithdrawalTransitionConflictError,
  createDbWithdrawalRepo,
  createInMemoryWithdrawalRepo,
} from "./withdrawal-repo";

/** Minimal db mock where the guarded UPDATE matches nothing and the follow-up
 * SELECT returns the supplied anomalous row, so the guard branch can be tested
 * for states the public state machine never produces on its own. */
function guardProbeDb(existing: Record<string, unknown>): DbClient {
  const updateReturning = vi.fn().mockResolvedValue([]);
  const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning: updateReturning }) }) }));
  const selectLimit = vi.fn().mockResolvedValue([existing]);
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }));
  return { update, select } as unknown as DbClient;
}

function baseInput() {
  return { appId: "app1", userId: "u1", asset: "CKB" as const, amount: "10", toAddress: "ckt1qexample" };
}

/** Drives a withdrawal to FAILED while keeping its broadcast tx_hash, mirroring
 * the worker's markFailedFromBroadcasted path (debit already happened). */
async function broadcastThenFail(repo: ReturnType<typeof createInMemoryWithdrawalRepo>) {
  const ledgerRepo = createInMemoryLedgerRepo();
  const w = await repo.create(baseInput());
  await repo.markProcessing(w.id, new Date());
  await repo.markBroadcastedWithDebit(w.id, { now: new Date(), txHash: "0xdeadbeef" }, { ledgerRepo });
  await repo.markFailedFromBroadcasted(w.id, { now: new Date(), error: "stuck after broadcast" });
  return w.id;
}

describe("withdrawal repo admin interventions", () => {
  it("revives a FAILED withdrawal with no tx_hash back to PENDING and resets retries", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const w = await repo.create(baseInput());
    await repo.markProcessing(w.id, new Date());
    await repo.markFailed(w.id, { now: new Date(), error: "pre-broadcast failure", incrementRetryCount: true });

    const revived = await repo.adminReviveFromFailed(w.id, { now: new Date() });
    expect(revived.state).toBe("PENDING");
    expect(revived.retryCount).toBe(0);
    expect(revived.lastError).toBeNull();
    expect(revived.txHash).toBeNull();
  });

  // The load-bearing invariant: a FAILED row that still carries a broadcast
  // tx_hash must never be re-queued, or the hot wallet broadcasts a second
  // on-chain payout against a single ledger debit.
  it("refuses to revive a FAILED withdrawal that already has a broadcast tx_hash", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const id = await broadcastThenFail(repo);

    const failed = await repo.findByIdOrThrow(id);
    expect(failed.state).toBe("FAILED");
    expect(failed.txHash).toBe("0xdeadbeef");

    await expect(repo.adminReviveFromFailed(id, { now: new Date() })).rejects.toBeInstanceOf(
      WithdrawalRevivalBlockedError,
    );
    // The row must stay FAILED — not silently re-queued.
    expect((await repo.findByIdOrThrow(id)).state).toBe("FAILED");
  });

  it("rejects revival of a withdrawal that is not in FAILED", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const w = await repo.create(baseInput());
    await expect(repo.adminReviveFromFailed(w.id, { now: new Date() })).rejects.toBeInstanceOf(
      WithdrawalTransitionConflictError,
    );
  });

  it("expedites a RETRY_PENDING withdrawal via adminRetryNow", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const w = await repo.create(baseInput());
    await repo.markProcessing(w.id, new Date());
    await repo.markRetryPending(w.id, {
      now: new Date(),
      nextRetryAt: new Date(Date.now() + 600_000),
      error: "transient",
    });

    const now = new Date();
    const out = await repo.adminRetryNow(w.id, { now });
    expect(out.state).toBe("RETRY_PENDING");
    expect(out.nextRetryAt?.getTime()).toBe(now.getTime());
  });

  it("rejects adminRetryNow when not in RETRY_PENDING", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const w = await repo.create(baseInput());
    await expect(repo.adminRetryNow(w.id, { now: new Date() })).rejects.toBeInstanceOf(
      WithdrawalTransitionConflictError,
    );
  });

  // A RETRY_PENDING row that retained a tx_hash must not be expedited — same
  // double-broadcast guard as revive (db path, via a constructed row).
  it("refuses adminRetryNow on a RETRY_PENDING row that still has a tx_hash", async () => {
    const repo = createDbWithdrawalRepo(guardProbeDb({ id: "w1", state: "RETRY_PENDING", txHash: "0xbeef" }));
    await expect(repo.adminRetryNow("w1", { now: new Date() })).rejects.toBeInstanceOf(WithdrawalRevivalBlockedError);
  });

  it("terminalizes a PENDING withdrawal to FAILED with a standard reason", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const w = await repo.create(baseInput());
    const out = await repo.adminTerminalize(w.id, { now: new Date(), reason: "ADMIN_CANCELLED" });
    expect(out.state).toBe("FAILED");
    expect(out.lastError).toBe("ADMIN_CANCELLED");
  });

  it("refuses to terminalize an already-broadcast withdrawal", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const ledgerRepo = createInMemoryLedgerRepo();
    const w = await repo.create(baseInput());
    await repo.markProcessing(w.id, new Date());
    await repo.markBroadcastedWithDebit(w.id, { now: new Date(), txHash: "0xabc" }, { ledgerRepo });
    await expect(repo.adminTerminalize(w.id, { now: new Date(), reason: "x" })).rejects.toBeInstanceOf(
      WithdrawalTransitionConflictError,
    );
  });
});
