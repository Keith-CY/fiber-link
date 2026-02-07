# Research & Planning Checklist

Reference plan: `docs/plans/2026-02-07-phase2-delivery-plan.md`

## Phase 0: Confirm product boundaries
- [ ] Confirm MVP assets: CKB + which stablecoin UDT (USDI?) (Owner: @Keith-CY, Target: 2026-02-10, Linked Task: Phase2 Task 1)
- [ ] Confirm custody model for MVP (hosted hub) and risk controls (Owner: @Keith-CY, Target: 2026-02-10, Linked Task: Phase2 Task 1)
- [ ] Confirm target Discourse version and plugin distribution approach (Owner: @Keith-CY, Target: 2026-02-11, Linked Task: Phase2 Task 9)

## Phase 1: Fiber technical research
- [ ] Identify Fiber node RPC/API surface for invoice lifecycle (Owner: @Keith-CY, Target: 2026-02-11, Linked Task: Phase2 Task 3)
- [ ] Determine best settlement detection method (subscribe vs poll) (Owner: @Keith-CY, Target: 2026-02-11, Linked Task: Phase2 Task 5)
- [ ] Document required operational actions: liquidity management, node monitoring, failure/restart recovery (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 10)

## Phase 2: Service design
- [ ] API spec (`tip.create`, `tip.status`, `withdrawal.request`, admin endpoints) (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 1)
- [ ] DB schema + invariants (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 2)
- [ ] Idempotency + reconciliation plan (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 5)
- [ ] Security plan (keys, secrets, rate limiting, auth between plugin and service) (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 7)

## Phase 3: Discourse plugin design
- [ ] UI/UX mock flow (tip modal, status, dashboard) (Owner: @Keith-CY, Target: 2026-02-13, Linked Task: Phase2 Task 9)
- [ ] Auth model: plugin-to-service credentialing (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 7)
- [ ] Deployment steps for a demo Discourse instance (Owner: @Keith-CY, Target: 2026-02-13, Linked Task: Phase2 Task 9)

## Phase 4: Delivery plan (8 weeks per proposal)
### Milestone 1 (Weeks 1-2): Design + Fiber prototype
- [x] Architecture + threat model (Completed: 2026-02-03, Evidence: `docs/02-architecture.md`, `docs/05-threat-model.md`)
- [ ] Hub node on testnet (Owner: @Keith-CY, Target: 2026-02-14, Linked Task: Phase2 Task 3)
- [x] Backend skeleton + DB schema baseline (Completed: 2026-02-07, Evidence: PR #1)
- [ ] Demo: invoice -> payment -> ledger credit (Owner: @Keith-CY, Target: 2026-02-16, Linked Task: Phase2 Task 5)

### Milestone 2 (Weeks 3-5): Discourse plugin + end-to-end tipping
- [ ] Tip UI + modal (Owner: @Keith-CY, Target: 2026-02-18, Linked Task: Phase2 Task 9)
- [ ] Endpoints for plugin integration (Owner: @Keith-CY, Target: 2026-02-17, Linked Task: Phase2 Task 3)
- [ ] Payment state updates (Owner: @Keith-CY, Target: 2026-02-18, Linked Task: Phase2 Task 5)
- [ ] Creator dashboard (Owner: @Keith-CY, Target: 2026-02-19, Linked Task: Phase2 Task 9)

### Milestone 3 (Weeks 6-8): Withdrawals + mainnet readiness
- [ ] Withdrawal flow + admin controls (Owner: @Keith-CY, Target: 2026-02-21, Linked Task: Phase2 Task 6)
- [ ] Production hardening checklist (Owner: @Keith-CY, Target: 2026-02-22, Linked Task: Phase2 Task 10)
- [ ] Full docs + demo (Owner: @Keith-CY, Target: 2026-02-23, Linked Task: Phase2 Task 10)

## Outputs (what we will produce)
- [x] Architecture diagram(s) (Completed: 2026-02-03, Evidence: `docs/02-architecture.md`)
- [ ] API spec draft (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 1)
- [x] DB schema draft (Completed: 2026-02-07, Evidence: `fiber-link-service/packages/db/src/schema.ts`)
- [ ] Risk register + mitigations (Owner: @Keith-CY, Target: 2026-02-12, Linked Task: Phase2 Task 1)
- [x] Repo structure proposal (Completed: 2026-02-03, Evidence: `docs/02-architecture.md`)
