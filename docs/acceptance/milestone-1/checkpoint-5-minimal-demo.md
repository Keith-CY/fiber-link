# M1 Checkpoint 5: Minimal Demo (CLI or Simple Web)

## Goal

Provide a reproducible minimal demonstration for invoice -> payment -> ledger credit.

## Collected evidence

- W5 demo evidence capture workflow:
  - `docs/runbooks/w5-demo-evidence.md`
- Milestone 1 evidence publication target:
  - `docs/runbooks/acceptance-evidence/milestone-1/index.md`
- MVP deliverable baseline including demo proof:
  - `docs/01-scope-mvp.md`

## Verification commands

- `scripts/capture-w5-demo-evidence.sh --mode dry-run`
- `scripts/capture-w5-demo-evidence.sh --mode live --fixture-file <path>`

## Current status

`DONE`

Demo capture pipeline is documented, scriptable, and linked through acceptance evidence indexes.

Latest verification evidence (2026-02-27):

- Demo/evidence runbook is active: `docs/runbooks/w5-demo-evidence.md`.
- Integration verification command set passed:
  - `cd fiber-link-service && (cd apps/rpc && bun run test -- --run --silent) && (cd apps/worker && bun run test -- --run --silent)`
- Published acceptance index:
  - `docs/runbooks/acceptance-evidence/milestone-1/index.md`

## Exit criteria

- A replayable demo evidence bundle is generated with PASS status.
- Bundle contains invoice/tip/settlement/withdrawal IDs and checklist output.
- Milestone index links to the latest accepted demo artifact.
