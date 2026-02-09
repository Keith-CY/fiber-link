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

## Configuration (service)
Environment variables used by the Fiber Link service:
- `FIBER_LINK_NONCE_REDIS_URL` — Redis URL for shared nonce replay cache. If unset, the RPC service falls back to an in-memory cache (single-instance only).

## Next steps
1) Close open Phase 2 decisions (asset set, custody boundary, timeouts).
2) Implement settlement detection and reconciliation loop (worker).
3) Implement withdrawal execution + insufficient-funds rejection.
4) Tighten admin scoping (if required) and expand verification coverage.
