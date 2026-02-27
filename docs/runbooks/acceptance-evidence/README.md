# Public Acceptance Evidence

This directory stores published, review-visible acceptance proof artifacts that are linked from
runbooks and the root docs index.

Canonical milestone checkpoint tracker:
- `docs/acceptance/README.md`

## Milestone 1 Evidence Bundle

Issue coverage: `#100` (`Milestone 1: add published acceptance evidence artifacts for public verification`)

- Public evidence index: [`milestone-1/index.md`](./milestone-1/index.md)
- Storage root for published proofs: this folder.
- Raw generated command/run artifacts remain in `deploy/compose/evidence/` and can be copied into this
  public directory when sign-off is ready.
- Recommended minimum retention: **30 days** for both raw and published copies, unless policy requires longer.

## Milestone 2 Evidence Bundle

- Public evidence index: [`milestone-2/index.md`](./milestone-2/index.md)
- Focus: payment-state integration and recipient dashboard verification evidence.

## Milestone 3 Evidence Bundle

- Public evidence index: [`milestone-3/index.md`](./milestone-3/index.md)
- Focus: withdrawal workflow, admin policy controls, and mainnet readiness checklist evidence.

## Evidence update rules

- Keep this folder immutable during the retention window.
- Record all required proof links before release/merge signoff.
- If an artifact is regenerated, preserve previous entries for audit traceability.
