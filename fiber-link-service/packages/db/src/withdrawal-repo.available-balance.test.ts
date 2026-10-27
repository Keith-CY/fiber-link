import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LedgerRepo, createDbLedgerRepo, createInMemoryLedgerRepo } from "./ledger-repo";
import { type PgliteTestDb, createPgliteTestDb } from "./test-helpers/pglite";
import {
  InsufficientFundsError,
  type WithdrawalRepo,
  createDbWithdrawalRepo,
  createInMemoryWithdrawalRepo,
} from "./withdrawal-repo";

const APP = "app-balance";
const ADDRESS = "ckt1qbroadcastedbalance";

// A BROADCASTED withdrawal has already been debited in the ledger
// (markBroadcastedWithDebit), so it must not also be subtracted from the
// creator's spendable balance — but it still reserves hot-wallet liquidity
// until on-chain confirmation.
function describeBroadcastedBalance(name: string, setup: () => Promise<{ repo: WithdrawalRepo; ledger: LedgerRepo }>) {
  describe(name, () => {
    let repo: WithdrawalRepo;
    let ledger: LedgerRepo;
    let userSeq = 0;

    beforeAll(async () => {
      ({ repo, ledger } = await setup());
    }, 60_000);

    async function seedBroadcasted60(): Promise<string> {
      userSeq += 1;
      const userId = `creator-${userSeq}`;
      await ledger.creditOnce({
        appId: APP,
        userId,
        asset: "CKB",
        amount: "100",
        refId: `tip-${userId}`,
        idempotencyKey: `credit:${userId}`,
      });
      const withdrawal = await repo.createWithBalanceCheck(
        { appId: APP, userId, asset: "CKB", amount: "60", toAddress: ADDRESS },
        { ledgerRepo: ledger },
      );
      const now = new Date("2026-10-27T00:00:00.000Z");
      await repo.markProcessing(withdrawal.id, now);
      await repo.markBroadcastedWithDebit(
        withdrawal.id,
        { now, txHash: `0x${userSeq.toString(16).padStart(64, "0")}` },
        { ledgerRepo: ledger },
      );
      return userId;
    }

    it("does not subtract an already-debited BROADCASTED withdrawal twice", async () => {
      const userId = await seedBroadcasted60();

      expect(await ledger.getBalance({ appId: APP, userId, asset: "CKB" })).toBe("40");
      expect(await repo.getPendingTotal({ appId: APP, userId, asset: "CKB" })).toBe("0");

      const next = await repo.createWithBalanceCheck(
        { appId: APP, userId, asset: "CKB", amount: "30", toAddress: ADDRESS },
        { ledgerRepo: ledger },
      );
      expect(next.state).toBe("PENDING");
    });

    it("still rejects a withdrawal exceeding the post-debit balance", async () => {
      const userId = await seedBroadcasted60();

      await expect(
        repo.createWithBalanceCheck(
          { appId: APP, userId, asset: "CKB", amount: "50", toAddress: ADDRESS },
          { ledgerRepo: ledger },
        ),
      ).rejects.toBeInstanceOf(InsufficientFundsError);
    });

    it("keeps BROADCASTED withdrawals in the hot-wallet reservation total", async () => {
      const reservationApp = `${APP}-reservation`;
      await ledger.creditOnce({
        appId: reservationApp,
        userId: "creator-r",
        asset: "CKB",
        amount: "100",
        refId: "tip-r",
        idempotencyKey: "credit:creator-r",
      });
      const withdrawal = await repo.createWithBalanceCheck(
        { appId: reservationApp, userId: "creator-r", asset: "CKB", amount: "60", toAddress: ADDRESS },
        { ledgerRepo: ledger },
      );
      const now = new Date("2026-10-27T00:00:00.000Z");
      await repo.markProcessing(withdrawal.id, now);
      await repo.markBroadcastedWithDebit(
        withdrawal.id,
        { now, txHash: `0x${"ab".repeat(32)}` },
        { ledgerRepo: ledger },
      );

      expect(
        await repo.getActiveCkbAddressReservationTotal({ appId: reservationApp, asset: "CKB", network: "AGGRON4" }),
      ).toBe("60");
    });
  });
}

let harness: PgliteTestDb | undefined;

afterAll(async () => {
  await harness?.close();
});

describeBroadcastedBalance("createDbWithdrawalRepo (pglite) available balance", async () => {
  harness = await createPgliteTestDb();
  return { repo: createDbWithdrawalRepo(harness.db), ledger: createDbLedgerRepo(harness.db) };
});

describeBroadcastedBalance("createInMemoryWithdrawalRepo available balance", async () => ({
  repo: createInMemoryWithdrawalRepo(),
  ledger: createInMemoryLedgerRepo(),
}));
