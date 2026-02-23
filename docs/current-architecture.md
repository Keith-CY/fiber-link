# Current Architecture (Canonical Index)

Last updated: 2026-02-23

This file is the source-of-truth index for architecture references, current implementation
status, and explicit redirects for superseded planning docs.

## Repository Baseline

- Repository: `Keith-CY/fiber-link`
- Default branch: `main`

## Canonical Document Map

- Product and scope baseline:
  - `docs/00-overview.md`
  - `docs/01-scope-mvp.md`
- System architecture and risk boundaries:
  - `docs/02-architecture.md`
  - `docs/03-risks-open-questions.md`
  - `docs/05-threat-model.md`
- Current implementation status:
  - `docs/06-development-progress.md`
  - `docs/plans/2026-02-21-issue-32-epic-closeout.md`
- Decision records:
  - `docs/decisions/2026-02-10-settlement-discovery-strategy.md`
  - `docs/decisions/2026-02-10-custody-ops-controls.md`
  - `docs/decisions/2026-02-10-usd-price-feed-policy.md`
  - `docs/decisions/2026-02-10-admin-membership-model.md`
- Runbooks and operational evidence:
  - `docs/runbooks/compose-reference.md`
  - `docs/runbooks/phase2-verification.md`
  - `docs/runbooks/w4-integration-status-2026-02-17.md`
  - `docs/runbooks/w5-demo-evidence.md`
  - `docs/runbooks/security-assumptions.md`
  - `docs/runbooks/threat-model-evidence-checklist.md`

## Historical/Superseded Docs

These docs are retained for traceability only. Use the canonical replacements listed below.

- `docs/plans/2026-02-03-fiber-link-mvp-design.md`
  - Status: diverged early-design snapshot.
  - Canonical replacement: `docs/01-scope-mvp.md`, `docs/02-architecture.md`,
    `docs/06-development-progress.md`.
- `docs/plans/2026-02-03-fiber-link-mvp-plan.md`
  - Status: superseded implementation draft.
  - Canonical replacement: `docs/06-development-progress.md`,
    `docs/plans/2026-02-21-issue-32-epic-closeout.md`.
- `docs/plans/2026-02-17-issue-32-epic-execution-status-tracker.md`
  - Status: superseded historical status snapshot.
  - Canonical replacement: `docs/plans/2026-02-21-issue-32-epic-closeout.md`,
    `docs/current-architecture.md`.

## Freshness Snapshot

- Historical/superseded docs tracked with explicit redirect: 3
- docs TODO/TBD/FIXME markers: 0
- core TODO/FIXME markers (excluding docs): 0
- test files discovered: 42

## Open Improvement Tracks

- https://github.com/Keith-CY/fiber-link/issues/241
