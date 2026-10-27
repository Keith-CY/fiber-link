import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withdrawalDebitIdempotencyKey, withdrawalReversalIdempotencyKey } from "./idempotency";
import { reconcileLedger } from "./ledger-reconciliation";
import { type LedgerRepo, createDbLedgerRepo, createInMemoryLedgerRepo } from "./ledger-repo";
import { type PgliteTestDb, createPgliteTestDb } from "./test-helpers/pglite";
import {
  type WithdrawalRepo,
  WithdrawalTransitionConflictError,
  createDbWithdrawalRepo,
  createInMemoryWithdrawalRepo,
} from "./withdrawal-repo";

const ACCOUNT = { appId: "app-reject", userId: "creator-1", asset: "CKB" as const };

/**
 * Scenario: credit 100, withdraw 60, broadcast (balance 40), then the chain
 * rejects the tx. The funds never left the hot wallet, so the BROADCASTED ->
 * FAILED transition must refund the broadcast debit exactly once.
 */
async function broadcastThenReject(repo: WithdrawalRepo, ledgerRepo: LedgerRepo) {
  await ledgerRepo.creditOnce({
    ...ACCOUNT,
    amount: "100",
    refId: "tip-1",
    idempotencyKey: "settlement:tip_intent:tip-1",
  });
  const created = await repo.createWithBalanceCheck(
    { ...ACCOUNT, amount: "60", toAddress: "ckt1qrejected" },
    { ledgerRepo },
  );
  await repo.markProcessing(created.id, new Date());
  await repo.markBroadcastedWithDebit(created.id, { now: new Date(), txHash: "0xrejected" }, { ledgerRepo });
  expect(await ledgerRepo.getBalance(ACCOUNT)).toBe("40");

  const failed = await repo.markFailedFromBroadcasted(
    created.id,
    { now: new Date(), error: "CKB transaction rejected" },
    { ledgerRepo },
  );
  return failed;
}

async function expectRejectionRefunded(repo: WithdrawalRepo, ledgerRepo: LedgerRepo) {
  const failed = await broadcastThenReject(repo, ledgerRepo);
  expect(failed.state).toBe("FAILED");
  expect(failed.txHash).toBe("0xrejected");
  expect(Number(await ledgerRepo.getBalance(ACCOUNT))).toBe(100);

  // A retried rejection must not credit the reversal a second time.
  await expect(
    repo.markFailedFromBroadcasted(failed.id, { now: new Date(), error: "retry" }, { ledgerRepo }),
  ).rejects.toBeInstanceOf(WithdrawalTransitionConflictError);
  expect(Number(await ledgerRepo.getBalance(ACCOUNT))).toBe(100);

  const entries = await ledgerRepo.listEntries({ appId: ACCOUNT.appId, userId: ACCOUNT.userId });
  const debit = entries.find((entry) => entry.idempotencyKey === withdrawalDebitIdempotencyKey(failed.id));
  const reversals = entries.filter((entry) => entry.idempotencyKey === withdrawalReversalIdempotencyKey(failed.id));
  expect(debit?.type).toBe("debit");
  expect(reversals).toHaveLength(1);
  expect(reversals[0]).toMatchObject({ type: "credit", refId: failed.id });
  expect(Number(reversals[0]?.amount)).toBe(60);

  const report = reconcileLedger({
    tipIntents: [
      {
        id: "tip-1",
        appId: ACCOUNT.appId,
        toUserId: ACCOUNT.userId,
        asset: "CKB",
        amount: "100",
        invoiceState: "SETTLED",
      },
    ],
    withdrawals: [
      {
        id: failed.id,
        appId: failed.appId,
        userId: failed.userId,
        asset: failed.asset,
        amount: failed.amount,
        state: failed.state,
      },
    ],
    entries,
  });
  expect(report.anomalies).toEqual([]);
}

describe("markFailedFromBroadcasted reverses the broadcast debit", () => {
  it("in-memory repo refunds the rejected withdrawal exactly once", async () => {
    await expectRejectionRefunded(createInMemoryWithdrawalRepo(), createInMemoryLedgerRepo());
  });

  describe("db repo (PGlite)", () => {
    let harness: PgliteTestDb;

    beforeAll(async () => {
      harness = await createPgliteTestDb();
    });

    afterAll(async () => {
      await harness.close();
    });

    it("refunds the rejected withdrawal exactly once", async () => {
      await expectRejectionRefunded(createDbWithdrawalRepo(harness.db), createDbLedgerRepo(harness.db));
    });
  });
});
