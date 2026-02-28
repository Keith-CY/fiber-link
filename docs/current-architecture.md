# Current Architecture (Canonical Index)

Last updated: 2026-02-28

This file is the source-of-truth index for architecture, operational boundaries, and active
implementation references.

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
  - `docs/audit-snapshot.md` (generated operational snapshot, non-canonical)
- Milestone acceptance checkpoints:
  - `docs/acceptance/README.md`
  - `docs/acceptance/milestone-1/index.md`
  - `docs/acceptance/milestone-2/index.md`
  - `docs/acceptance/milestone-3/index.md`
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

## Historical/Superseded/Diverged Docs

These docs remain for historical traceability but should not be treated as current implementation
guidance.

- `docs/plans/2026-02-17-issue-32-epic-execution-status-tracker.md`
  - Status: superseded historical snapshot.
  - Canonical replacement: `docs/plans/2026-02-21-issue-32-epic-closeout.md`.
  - Canonical index: `docs/current-architecture.md`.
- `docs/plans/2026-02-03-fiber-link-mvp-design.md`
  - Status: superseded design snapshot.
  - Canonical replacements: `docs/00-overview.md`, `docs/01-scope-mvp.md`, `docs/02-architecture.md`.
  - Canonical index: `docs/current-architecture.md`.
- `docs/plans/2026-02-03-fiber-link-mvp-plan.md`
  - Status: superseded implementation-plan snapshot.
  - Canonical replacements: `docs/02-architecture.md`, `docs/06-development-progress.md`.
  - Canonical index: `docs/current-architecture.md`.
- `docs/plans/2026-02-07-phase2-delivery-plan.md`
  - Status: diverged historical delivery-plan snapshot.
  - Canonical replacements: `docs/02-architecture.md`, `docs/06-development-progress.md`, `docs/plans/2026-02-21-issue-32-epic-closeout.md`.
  - Canonical index: `docs/current-architecture.md`.
- `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md`
  - Status: diverged historical sprint-plan snapshot.
  - Canonical replacements: `docs/decisions/2026-02-10-settlement-discovery-strategy.md`, `docs/02-architecture.md`, `docs/06-development-progress.md`.
  - Canonical index: `docs/current-architecture.md`.
- `docs/plans/2026-02-13-phase3-priority3-balance-debit-design.md`
  - Status: diverged historical design snapshot.
  - Canonical replacements: `docs/02-architecture.md`, `docs/06-development-progress.md`, `docs/acceptance/milestone-3/checkpoint-1-creator-withdrawal-workflow.md`.
  - Canonical index: `docs/current-architecture.md`.

## Audit Generator Contract

- The hourly architecture-audit generator may update only:
  - `docs/audit-snapshot.md`
  - `.github/architecture-audit-state.json`
- Any generator mutation of `docs/current-architecture.md` is invalid and CI-blocked.

## Freshness Snapshot

- Historical/superseded/diverged docs tracked with explicit redirect: 6
- Planning placeholder marker count in `docs/`: 0
- Audit snapshot path (non-canonical): `docs/audit-snapshot.md`

## Open Improvement Tracks

- https://github.com/Keith-CY/fiber-link/issues/255
- https://github.com/Keith-CY/fiber-link/issues/256
