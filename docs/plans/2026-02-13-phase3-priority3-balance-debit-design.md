# Phase 3 Priority 3 Design: Balance + Debit Invariants

Status: Diverged historical design snapshot.
Canonical replacements: `docs/02-architecture.md`, `docs/06-development-progress.md`, `docs/acceptance/milestone-3/checkpoint-1-creator-withdrawal-workflow.md`.
Canonical index: `docs/current-architecture.md`.

Date: 2026-02-13  
Owner: Fiber Link  
Design status at authoring time: Draft (Approved)

## Goal

Enforce withdrawal balance invariants with reservation semantics:
- Withdrawal requests are rejected if available balance is insufficient.
- Pending withdrawals (PENDING/PROCESSING/RETRY_PENDING) reduce availability.
- Ledger debits are written only when a withdrawal completes successfully.
- Debit writes are idempotent and coupled to completion to prevent partial state.

## Decisions

- Use **advisory transaction locks** to serialize concurrent requests for the same `(appId, userId, asset)`.
- Compute available balance as:
  `available = ledger_balance - pending_withdrawal_total`.
- No schema changes. No reservation ledger entries.
- Debit entry idempotency key: `withdrawal:debit:<withdrawalId>`.

## Data Flow

### Request Withdrawal

1. Start DB transaction.
2. Acquire `pg_advisory_xact_lock(hashtext(appId:userId:asset))`.
3. Read ledger balance (credits - debits).
4. Read pending withdrawals total for the same key and states:
   `PENDING`, `PROCESSING`, `RETRY_PENDING`.
5. If `available < amount`, throw `InsufficientFundsError`.
6. Insert withdrawal row with `PENDING`.
7. Commit.

In-memory repos implement the same computation without advisory locks.

### Execute Withdrawal (Worker)

On successful execution:
1. Start DB transaction.
2. Mark withdrawal `COMPLETED`.
3. Insert ledger debit with idempotency key `withdrawal:debit:<id>`.
4. Commit.

If debit already exists, the completion still succeeds; no duplicate debit is written.
Failures do not write debits.

## API / Repo Changes

- `WithdrawalRepo`:
  - `getPendingTotal({ appId, userId, asset }): Promise<string>`
  - `createWithBalanceCheck(input, deps): Promise<WithdrawalRecord>`
  - `markCompletedWithDebit(id, params, ledgerRepo): Promise<WithdrawalRecord>`
- New error: `InsufficientFundsError` (thrown by `createWithBalanceCheck`).
- `requestWithdrawal` uses the balance-checking create path.
- `runWithdrawalBatch` uses the completion-with-debit path on success.

## Testing (TDD)

- `requestWithdrawal` rejects insufficient funds when pending withdrawals consume balance.
- `requestWithdrawal` succeeds when available equals requested amount.
- Successful withdrawal writes a debit entry with `withdrawal:debit:<id>`.
- Failed or retrying withdrawals do not write debits.
- Idempotent debit entry does not block completion.

## Notes / Risks

- Advisory lock collisions are possible with `hashtext`; acceptable because collisions only serialize unrelated requests.
- Transactional paths require DB-backed repos; in-memory repos remain for unit tests.
