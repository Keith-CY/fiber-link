# Fiber Link

A CKB Fiber-based pay layer for community tipping & micropayments (starting with a Discourse plugin).

## What this repo is
This repository is the *research + planning* starting point.

Primary reference thread:
- https://talk.nervos.org/t/dis-fiber-link-a-ckb-fiber-based-pay-layer-tipping-micropayments-for-communities/9845

## Documents
- `docs/00-overview.md` — project overview (what/why)
- `docs/01-scope-mvp.md` — MVP scope + non-goals
- `docs/02-architecture.md` — proposed architecture + components
- `docs/03-risks-open-questions.md` — risks, assumptions, open questions
- `docs/04-research-plan.md` — research checklist + milestones
- `docs/05-threat-model.md` — threat model + risk controls (MVP)
- `docs/06-development-progress.md` — development progress + post-Phase 2 roadmap
- `docs/runbooks/phase2-verification.md` — Phase 2 verification gate (happy path + failure path)
- `docs/README.md` — testing docs index and plugin smoke-entry troubleshooting
- `docs/runbooks/compose-reference.md` — Docker Compose reference (service + FNN)
- `docs/runbooks/settlement-recovery.md` — settlement replay/backfill recovery operations
- `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md` — historical Sprint 1 implementation plan (settlement v1 baseline)

## Milestone 1 proof
- Public Discourse demo and short video proof: [docs/runbooks/milestone-1-public-demo.md](docs/runbooks/milestone-1-public-demo.md)

## Configuration (service)
Environment variables used by the Fiber Link service:
- `FIBER_LINK_NONCE_REDIS_URL` — Redis URL for shared nonce replay cache. If unset, the RPC service falls back to an in-memory cache (single-instance only).

## Next steps
1) Phase 3 Sprint 3: implement balance/debit invariants + insufficient-funds gate.
2) Align CI and runbooks (plugin requests scope + optional system-spec coverage).
3) Define Year 1 admin membership SOP (`app_admins` grant/revoke + audit trail).
4) Confirm MVP asset tuple in code/config (CKB + selected stablecoin UDT).
