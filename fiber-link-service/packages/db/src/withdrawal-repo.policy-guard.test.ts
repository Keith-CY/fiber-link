import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareDecimalStrings } from "./amount";
import { createDbLedgerRepo, createInMemoryLedgerRepo } from "./ledger-repo";
import { type PgliteTestDb, createPgliteTestDb } from "./test-helpers/pglite";
import type { WithdrawalPolicyUsage } from "./withdrawal-policy-repo";
import { type WithdrawalPolicyGuard, createDbWithdrawalRepo, createInMemoryWithdrawalRepo } from "./withdrawal-repo";

class PolicyLimitError extends Error {}

function createLimitGuard(limits: { user: string; app: string; cooldown?: boolean }) {
  const seen: WithdrawalPolicyUsage[] = [];
  const guard: WithdrawalPolicyGuard = {
    now: new Date(),
    assertUsage(usage) {
      seen.push(usage);
      if (compareDecimalStrings(usage.userDailyTotal, limits.user) >= 0) throw new PolicyLimitError("user");
      if (compareDecimalStrings(usage.appDailyTotal, limits.app) >= 0) throw new PolicyLimitError("app");
      if (limits.cooldown && usage.lastRequestedAt) throw new PolicyLimitError("cooldown");
    },
  };
  return { guard, seen };
}

describe("withdrawal creation policy guard (PGlite: real SQL over the committed migrations)", () => {
  let harness: PgliteTestDb;

  beforeAll(async () => {
    harness = await createPgliteTestDb();
    const ledgerRepo = createDbLedgerRepo(harness.db);
    for (const userId of ["u1", "u2"]) {
      await ledgerRepo.creditOnce({
        appId: "app1",
        userId,
        asset: "USDI",
        amount: "100",
        refId: `seed-${userId}`,
        idempotencyKey: `seed-${userId}`,
      });
    }
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("checks app-wide usage inside the creation transaction", async () => {
    const repo = createDbWithdrawalRepo(harness.db);
    const ledgerRepo = createDbLedgerRepo(harness.db);
    const { guard, seen } = createLimitGuard({ user: "100", app: "10" });

    const results = await Promise.allSettled(
      ["u1", "u2"].map((userId) =>
        repo.createWithBalanceCheck(
          { appId: "app1", userId, asset: "USDI", amount: "10", toAddress: `fiber:invoice:${userId}` },
          { ledgerRepo, policyGuard: guard },
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { message: "app" },
    });
    expect(seen.map((usage) => usage.appDailyTotal)).toEqual(["0", "10"]);
  });
});

describe("in-memory withdrawal creation policy guard", () => {
  it("reads usage atomically with the insert so concurrent requests cannot skip the cooldown", async () => {
    const repo = createInMemoryWithdrawalRepo();
    const ledgerRepo = createInMemoryLedgerRepo();
    await ledgerRepo.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "100",
      refId: "seed-u1",
      idempotencyKey: "seed-u1",
    });
    const { guard } = createLimitGuard({ user: "100", app: "100", cooldown: true });

    const results = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        repo.createLiquidityPendingWithBalanceCheck(
          {
            appId: "app1",
            userId: "u1",
            asset: "USDI",
            amount: "10",
            toAddress: `fiber:invoice:${suffix}`,
            liquidityRequestId: "lr1",
            liquidityPendingReason: "test",
          },
          { ledgerRepo, policyGuard: guard },
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { message: "cooldown" },
    });
  });
});
