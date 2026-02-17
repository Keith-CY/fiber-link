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

`PARTIAL`

Demo capture pipeline is documented and scriptable, but latest acceptance-ready demo artifact references still need to be updated in the milestone acceptance path.

## Exit criteria

- A replayable demo evidence bundle is generated with PASS status.
- Bundle contains invoice/tip/settlement/withdrawal IDs and checklist output.
- Milestone index links to the latest accepted demo artifact.
