# M2 Checkpoint 3: Payment State Subscription/Polling Integration

## Goal

Ensure payment state can be consumed by user-facing flow using reliable synchronization path.

## Collected evidence

- Status flow and settlement discovery architecture:
  - `docs/02-architecture.md`
- Polling + replay strategy and runbook:
  - `docs/06-development-progress.md`
  - `docs/runbooks/settlement-recovery.md`
- W4 integration status sync (issue + PR evidence):
  - `docs/runbooks/w4-integration-status-2026-02-17.md`
- Verification gate for worker replay behavior:
  - `docs/runbooks/phase2-verification.md`

## Current status

`PARTIAL`

Polling and replay path are implemented and documented. Event-subscription path is explicitly marked as later optimization.
Status synchronized on 2026-02-17: W4 child tasks are closed except legacy event-subscription scope tracked as open in issue `#24`.

## Exit criteria

- Polling path remains production baseline and convergence proof is available.
- If subscription path is introduced, acceptance docs must capture its correctness and fallback behavior.
