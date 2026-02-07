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

## Configuration (service)
Environment variables used by the Fiber Link service:
- `FIBER_LINK_NONCE_REDIS_URL` — Redis URL for shared nonce replay cache. If unset, the RPC service falls back to an in-memory cache (single-instance only).

## Next steps
1) Confirm MVP UX and custody model boundaries.
2) Confirm Fiber node APIs for invoice creation + settlement detection.
3) Draft DB schema and ledger invariants (idempotency, reconciliation).
4) Decide repo split: service vs plugin (separate repos or monorepo).
