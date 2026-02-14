# Priority 3 Balance + Debit Invariants Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce withdrawal balance gating with pending-withdrawal reservations and ensure ledger debits are written only on successful completion.

**Architecture:** At request time, compute available balance = ledger balance - pending withdrawals inside a DB transaction guarded by `pg_advisory_xact_lock`. On completion, write a debit ledger entry in the same transaction as the withdrawal completion update.

**Tech Stack:** TypeScript, Drizzle ORM (node-postgres), PostgreSQL, Vitest, Bun.

---

### Task 1: Add failing tests for in-memory balance gating

**Files:**
- Modify: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.test.ts`
- Test: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.test.ts`

**Step 1: Write the failing test**

Add a new `describe("createInMemoryWithdrawalRepo balance gating")` with tests:
```ts
it("rejects when pending withdrawals exceed available balance", async () => {
  const ledger = createInMemoryLedgerRepo();
  const repo = createInMemoryWithdrawalRepo();
  await ledger.creditOnce({ appId: "app1", userId: "u1", asset: "USDI", amount: "10", refId: "t1", idempotencyKey: "credit:t1" });
  await repo.create({ appId: "app1", userId: "u1", asset: "USDI", amount: "8", toAddress: "addr" });

  await expect(
    repo.createWithBalanceCheck(
      { appId: "app1", userId: "u1", asset: "USDI", amount: "5", toAddress: "addr2" },
      { ledgerRepo: ledger },
    ),
  ).rejects.toBeInstanceOf(InsufficientFundsError);
});

it("accepts when available balance covers request", async () => {
  const ledger = createInMemoryLedgerRepo();
  const repo = createInMemoryWithdrawalRepo();
  await ledger.creditOnce({ appId: "app1", userId: "u1", asset: "USDI", amount: "10", refId: "t1", idempotencyKey: "credit:t1" });
  await repo.create({ appId: "app1", userId: "u1", asset: "USDI", amount: "8", toAddress: "addr" });

  const created = await repo.createWithBalanceCheck(
    { appId: "app1", userId: "u1", asset: "USDI", amount: "2", toAddress: "addr2" },
    { ledgerRepo: ledger },
  );
  expect(created.state).toBe("PENDING");
});
```

**Step 2: Run test to verify it fails**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db test -- --run withdrawal-repo.test.ts
```
Expected: FAIL because `InsufficientFundsError` and `createWithBalanceCheck` do not exist.

**Step 3: Write minimal implementation**

Modify `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts`:
- Add `InsufficientFundsError`.
- Extend `WithdrawalRepo` with `getPendingTotal` and `createWithBalanceCheck`.
- Implement `getPendingTotal` + `createWithBalanceCheck` in `createInMemoryWithdrawalRepo`.
- Add local decimal helpers (parse/compare/subtract) to compute `available >= amount`.

**Step 4: Run test to verify it passes**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db test -- --run withdrawal-repo.test.ts
```
Expected: PASS.

**Step 5: Commit**

```
git add /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.test.ts
git commit -m "feat(db): add in-memory balance gating for withdrawals"
```

---

### Task 2: Wire balance gating into `requestWithdrawal` (TDD)

**Files:**
- Modify: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`
- Modify: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc/src/methods/withdrawal.ts`

**Step 1: Write the failing test**

Add tests that use `createInMemoryLedgerRepo`:
```ts
it("rejects request when available balance is insufficient", async () => {
  const repo = createInMemoryWithdrawalRepo();
  const ledger = createInMemoryLedgerRepo();
  await ledger.creditOnce({ appId: "app1", userId: "u1", asset: "USDI", amount: "10", refId: "t1", idempotencyKey: "credit:t1" });
  await repo.create({ appId: "app1", userId: "u1", asset: "USDI", amount: "8", toAddress: "addr" });

  await expect(
    requestWithdrawal({ appId: "app1", userId: "u1", asset: "USDI", amount: "5", toAddress: "addr2" }, { repo, ledgerRepo: ledger }),
  ).rejects.toBeInstanceOf(InsufficientFundsError);
});
```

**Step 2: Run test to verify it fails**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc test -- --run withdrawal.test.ts
```
Expected: FAIL (missing `ledgerRepo` support / balance check).

**Step 3: Write minimal implementation**

Update `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc/src/methods/withdrawal.ts`:
- Accept `ledgerRepo` in options.
- Default to `createDbLedgerRepo(createDbClient())`.
- Call `repo.createWithBalanceCheck(input, { ledgerRepo })`.

**Step 4: Run test to verify it passes**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc test -- --run withdrawal.test.ts
```
Expected: PASS.

**Step 5: Commit**

```
git add /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc/src/methods/withdrawal.ts /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts
git commit -m "feat(rpc): enforce balance gating on withdrawals"
```

---

### Task 3: Add failing tests for debit-on-completion in worker

**Files:**
- Modify: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker/src/withdrawal-batch.test.ts`

**Step 1: Write the failing test**

Add a test:
```ts
it("writes a ledger debit when withdrawal completes", async () => {
  const repo = createInMemoryWithdrawalRepo();
  const ledger = createInMemoryLedgerRepo();
  const created = await repo.create({ appId: "app1", userId: "u1", asset: "USDI", amount: "10", toAddress: "addr" });

  await runWithdrawalBatch({
    now: new Date("2026-02-07T12:00:00.000Z"),
    executeWithdrawal: async () => ({ ok: true, txHash: "0xabc123" }),
    repo,
    ledgerRepo: ledger,
  });

  const entries = ledger.__listForTests?.() ?? [];
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe("debit");
  expect(entries[0].idempotencyKey).toBe(`withdrawal:debit:${created.id}`);
});
```

**Step 2: Run test to verify it fails**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker test -- --run withdrawal-batch.test.ts
```
Expected: FAIL (no debit written / no `ledgerRepo` option).

**Step 3: Write minimal implementation**

Update `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker/src/withdrawal-batch.ts`:
- Accept `ledgerRepo` option.
- Default to `createDbLedgerRepo(createDbClient())`.
- Replace `repo.markCompleted` with `repo.markCompletedWithDebit` using ledger repo.

Update `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts`:
- Add `markCompletedWithDebit` to the repo interface.
- Implement it in `createInMemoryWithdrawalRepo` (call `markCompleted` + `ledgerRepo.debitOnce`).
- Implement it in `createDbWithdrawalRepo` using a transaction to update withdrawal + insert debit.

**Step 4: Run test to verify it passes**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker test -- --run withdrawal-batch.test.ts
```
Expected: PASS.

**Step 5: Commit**

```
git add /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker/src/withdrawal-batch.ts /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker/src/withdrawal-batch.test.ts /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts
git commit -m "feat(worker): debit ledger on successful withdrawal"
```

---

### Task 4: Implement DB balance gating with advisory lock

**Files:**
- Modify: `/Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts`

**Step 1: Write the failing test**

Add a unit test with a mocked `db.transaction` in `withdrawal-repo.test.ts`:
```ts
it("acquires advisory lock and rejects when insufficient", async () => {
  const tx = { execute: vi.fn(), select: vi.fn(), insert: vi.fn() } as unknown as DbClient;
  const db = { transaction: vi.fn((fn) => fn(tx)) } as unknown as DbClient;
  const repo = createDbWithdrawalRepo(db);
  vi.spyOn(createDbLedgerRepo(tx), "getBalance").mockResolvedValue("1");
  vi.spyOn(repo, "getPendingTotal").mockResolvedValue("0");

  await expect(
    repo.createWithBalanceCheck({ appId: "a", userId: "u", asset: "USDI", amount: "2", toAddress: "addr" }, { ledgerRepo: createDbLedgerRepo(tx) }),
  ).rejects.toBeInstanceOf(InsufficientFundsError);
});
```

**Step 2: Run test to verify it fails**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db test -- --run withdrawal-repo.test.ts
```
Expected: FAIL because `transaction`/advisory lock path doesn’t exist.

**Step 3: Write minimal implementation**

In `createDbWithdrawalRepo`:
- Implement `getPendingTotal` using SQL sum over `PENDING/PROCESSING/RETRY_PENDING`.
- Implement `createWithBalanceCheck`:
  - `db.transaction(async (tx) => { await tx.execute(sql\`select pg_advisory_xact_lock(hashtext(${key}))\`); ... })`
  - Use `createDbLedgerRepo(tx)` to read balance.
  - Use `getPendingTotal` with `tx`.
  - Throw `InsufficientFundsError` if `available < amount`.
  - Insert withdrawal row in `PENDING` using `tx`.

**Step 4: Run test to verify it passes**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db test -- --run withdrawal-repo.test.ts
```
Expected: PASS.

**Step 5: Commit**

```
git add /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.ts /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db/src/withdrawal-repo.test.ts
git commit -m "feat(db): add balance-checking withdrawal creation"
```

---

### Task 5: Verification sweep

**Files:**
- None

**Step 1: Run targeted tests**

Run:
```
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/packages/db test -- --run withdrawal-repo.test.ts
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/rpc test -- --run withdrawal.test.ts
bun run --cwd /Users/ChenYu/Documents/Github/fiber-link/.worktrees/codex/priority3-balance-debit/fiber-link-service/apps/worker test -- --run withdrawal-batch.test.ts
```

**Step 2: Commit (if needed)**

Only if new changes were made during verification fixes.

---

**Plan complete.** Two execution options:

1. **Subagent-Driven (this session)** – Use @superpowers:subagent-driven-development (note: subagents aren’t available in Codex; I’ll execute tasks directly here).
2. **Parallel Session (separate)** – Open a new session and use @superpowers:executing-plans.

Which approach?  
