# Phase 2 Decisions

Date: 2026-02-07
Owner: @Keith-CY
Reference plan: `docs/plans/2026-02-07-phase2-delivery-plan.md`

Note (2026-02-11): this file is a historical Phase 2 draft register.  
Current decision source-of-truth is the accepted one-page records:
- `docs/decisions/2026-02-10-settlement-discovery-strategy.md`
- `docs/decisions/2026-02-10-custody-ops-controls.md`
- `docs/decisions/2026-02-10-usd-price-feed-policy.md`
- `docs/decisions/2026-02-10-admin-membership-model.md`

## Decision register

### Asset set
- Decision: CKB + TBD stablecoin UDT (candidate: USDI).
- Status: OPEN
- Target date: 2026-02-10
- Linked Task(s): Phase2 Task 1, Phase2 Task 4, Phase2 Task 6

### Custody boundary
- Decision: MVP runs with hosted Fiber hub custody and explicit risk controls.
- Status: OPEN
- Target date: 2026-02-10
- Linked Task(s): Phase2 Task 1, Phase2 Task 10

### Invoice timeout/retry policy
- Decision: define timeout window, poll/subscribe fallback, and user-facing retry contract.
- Status: OPEN
- Target date: 2026-02-11
- Linked Task(s): Phase2 Task 3, Phase2 Task 5, Phase2 Task 9

### Withdrawal batching target
- Decision: define batch cadence and maximum queue size before forced flush.
- Status: OPEN
- Target date: 2026-02-12
- Linked Task(s): Phase2 Task 6, Phase2 Task 10

### JSON-RPC error envelope semantics
- Decision: keep JSON-RPC envelope stable for plugin/service contracts.
- Status: LOCKED
- Locked date: 2026-02-07
- Linked Task(s): Phase2 Task 3, Phase2 Task 7, Phase2 Task 9

### App secret source of truth
- Decision: apps table in DB is source of truth, with phased dual-read cutover.
- Status: LOCKED
- Locked date: 2026-02-07
- Linked Task(s): Phase2 Task 7

## Open decision blockers
- Fiber node API surface confirmation for settlement status and retries.
- Stablecoin UDT selection and testnet liquidity assumptions.
- Compliance disclaimers required for hosted custody MVP.
