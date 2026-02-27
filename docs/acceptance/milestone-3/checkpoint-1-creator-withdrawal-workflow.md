# M3 Checkpoint 1: Creator Withdrawal Workflow

## Goal

Provide end-to-end creator withdrawal flow with durable state transitions and execution evidence.

## Collected evidence

- Withdrawal execution baseline status:
  - `docs/06-development-progress.md`
- Lifecycle and transition boundaries:
  - `docs/02-architecture.md`
- Failure/retry and recovery verification:
  - `docs/runbooks/phase2-verification.md`
  - `docs/runbooks/settlement-recovery.md`

## Current status

`DONE`

Creator withdrawal workflow is implemented and verified end-to-end at service/worker level with policy and tx-evidence coverage.

Latest verification evidence (2026-02-27):

- `cd fiber-link-service/apps/rpc && bun run test -- --run --silent src/methods/withdrawal.test.ts src/rpc.test.ts`
- `cd fiber-link-service/apps/worker && bun run test -- --run --silent src/withdrawal-batch.test.ts`
- `docs/runbooks/acceptance-evidence/milestone-3/index.md`

## Exit criteria

- Withdrawal request -> processing -> completion/failure is reproducible in acceptance flow.
- Tx evidence and corresponding ledger debit are auditable for completed withdrawals.
