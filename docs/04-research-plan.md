# Research & Planning Checklist

Last updated: 2026-02-11

This checklist is now a live TODO board after Phase 2 completion.

References:
- Phase 2 status: `docs/06-development-progress.md`
- Phase 3 Sprint 1 plan: `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md`
- 3-year strategy: `docs/plans/2026-02-09-3-year-strategy-design.md`

## Completed Baseline (Done)

- [x] Architecture + threat model baseline (`docs/02-architecture.md`, `docs/05-threat-model.md`)
- [x] Phase 2 implementation (Task 1 to Task 10) merged to `main`
- [x] Admin role gating in service (`SUPER_ADMIN` + app-scoped `COMMUNITY_ADMIN`)
- [x] Discourse tip UI + hardened RPC proxy
- [x] CI verification gate and runbook baseline
- [x] Service + FNN Docker Compose reference baseline (`docs/runbooks/compose-reference.md`)
- [x] Scaling decision set locked:
  - settlement discovery strategy
  - custody ops controls
  - USD price feed policy
  - admin membership model

## Active TODO (Phase 3)

### Priority 1: Settlement Discovery + Reconciliation (Sprint 1)

Owner: `@Keith-CY`  
Target: 2026-02-18

- [ ] Implement polling-based settlement discovery worker loop
- [ ] Add reconciliation/backfill command (idempotent replay by app/time window)
- [ ] Add settlement observability metrics (pending backlog, detection latency, replay count)
- [ ] Add incident/repair runbook for missed settlement events
- [ ] Add tests for crash-recovery, duplicate observations, and missed-event backfill

### Priority 2: Withdrawal Execution (Sprint 2)

Owner: `@Keith-CY`  
Target: 2026-02-25

- [ ] Replace withdrawal executor stub with real node action
- [ ] Persist execution evidence (for example tx hash) and structured error details
- [ ] Confirm transient/permanent failure classification with retry contract

### Priority 3: Balance + Debit Invariants (Sprint 3)

Owner: `@Keith-CY`  
Target: 2026-03-03

- [ ] Implement balance read model: credits - debits by user/app/asset
- [ ] Enforce insufficient-funds rejection on withdrawal request
- [ ] Couple debit idempotency to successful withdrawal completion

### Cross-Cutting Ops/Docs

Owner: `@Keith-CY`  
Target: 2026-02-20

- [ ] Align `docs/runbooks/phase2-verification.md` with CI request-spec scope (`plugins/fiber-link/spec/requests`)
- [ ] Decide whether plugin system specs are part of CI default gate
- [ ] Document Year 1 admin membership SOP (`app_admins` grant/revoke + audit trail)
