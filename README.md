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
- `docs/runbooks/compose-reference.md` — Docker Compose reference (service + FNN)
- `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md` — next implementation plan (Phase 3 Sprint 1)

## Configuration (service)
Environment variables used by the Fiber Link service:
- `FIBER_LINK_NONCE_REDIS_URL` — Redis URL for shared nonce replay cache. If unset, the RPC service falls back to an in-memory cache (single-instance only).

## Next steps
1) Phase 3 Sprint 1: implement settlement detection + reconciliation/backfill loop (worker).
2) Implement withdrawal execution with real node actions + tx evidence persistence.
3) Implement balance/debit invariants + insufficient-funds gate.
4) Align CI and runbooks (plugin requests scope + optional system-spec coverage).
