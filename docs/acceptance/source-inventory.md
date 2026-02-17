# Acceptance Source Inventory

Last updated: 2026-02-16

This file records the docs sweep used to collect acceptance content into `docs/acceptance/`.

## Inventory scope

All markdown files currently under `docs/` were reviewed as source inputs for milestone acceptance checkpoints.

## Core docs

- `docs/00-overview.md` (program context)
- `docs/01-scope-mvp.md` (MVP scope and deliverables)
- `docs/02-architecture.md` (architecture and lifecycle boundaries)
- `docs/03-risks-open-questions.md` (open risk register)
- `docs/04-research-plan.md` (milestone/sprint checklist)
- `docs/05-threat-model.md` (threat model and controls)
- `docs/06-development-progress.md` (implementation status baseline)
- `docs/README.md` (docs index)
- `docs/admin-installation.md` (operator setup and smoke flow)

## Decisions

- `docs/decisions/2026-02-07-phase2-decisions.md`
- `docs/decisions/2026-02-10-admin-membership-model.md`
- `docs/decisions/2026-02-10-custody-ops-controls.md`
- `docs/decisions/2026-02-10-settlement-discovery-strategy.md`
- `docs/decisions/2026-02-10-usd-price-feed-policy.md`

## Plans

- `docs/plans/2026-02-03-fiber-link-mvp-design.md`
- `docs/plans/2026-02-03-fiber-link-mvp-plan.md`
- `docs/plans/2026-02-07-phase2-delivery-plan.md`
- `docs/plans/2026-02-09-3-year-strategy-design.md`
- `docs/plans/2026-02-10-year1-community-pipeline.md`
- `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md`
- `docs/plans/2026-02-13-phase3-priority3-balance-debit-design.md`
- `docs/plans/2026-02-13-priority3-balance-debit-implementation-plan.md`

## Runbooks and evidence docs

- `docs/runbooks/acceptance-evidence/README.md`
- `docs/runbooks/acceptance-evidence/milestone-1/compose-logs.md`
- `docs/runbooks/acceptance-evidence/milestone-1/deployment-bundle.md`
- `docs/runbooks/acceptance-evidence/milestone-1/index.md`
- `docs/runbooks/acceptance-evidence/milestone-1/settlement-backfill.md`
- `docs/runbooks/acceptance-evidence/milestone-1/testnet-bootstrap.md`
- `docs/runbooks/compose-reference.md`
- `docs/runbooks/deployment-evidence.md`
- `docs/runbooks/evidence-template/deployment/README.md`
- `docs/runbooks/evidence-template/deployment/checklist.md`
- `docs/runbooks/evidence-template/deployment/retention-policy.md`
- `docs/runbooks/fiber-adapter-e2e.md`
- `docs/runbooks/kanban-project-id.md`
- `docs/runbooks/phase2-verification.md`
- `docs/runbooks/secret-cutover.md`
- `docs/runbooks/security-assumptions.md`
- `docs/runbooks/security-controls-evidence-map.md`
- `docs/runbooks/settlement-recovery.md`
- `docs/runbooks/testnet-bootstrap.md`
- `docs/runbooks/threat-model-evidence-checklist.md`
- `docs/runbooks/w5-demo-evidence.md`

## Mapping method

- Milestone 1 checkpoints are mapped to architecture/threat docs, testnet and integration runbooks, and evidence capture docs.
- Milestone 2 checkpoints are mapped to plugin integration scope, RPC/worker contract docs, and plugin verification docs.
- Milestone 3 checkpoints are mapped to withdrawal/admin hardening docs, security controls, and deployment-readiness runbooks.
