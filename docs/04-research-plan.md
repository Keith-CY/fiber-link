# Research & Planning Checklist

## Phase 0: Confirm product boundaries
- [ ] Confirm MVP assets: CKB + which stablecoin UDT (USDI?)
- [ ] Confirm custody model for MVP (hosted hub) and risk controls
- [ ] Confirm target Discourse version and plugin distribution approach

## Phase 1: Fiber technical research
- [ ] Identify Fiber node RPC/API surface for invoice lifecycle
- [ ] Determine best settlement detection method (subscribe vs poll)
- [ ] Document required operational actions:
  - liquidity management
  - node monitoring
  - failure/restart recovery

## Phase 2: Service design
- [ ] API spec (`/tips`, `/tips/{id}`, `/withdrawals`, admin endpoints)
- [ ] DB schema + invariants
- [ ] Idempotency + reconciliation plan
- [ ] Security plan (keys, secrets, rate limiting, auth between plugin and service)

## Phase 3: Discourse plugin design
- [ ] UI/UX mock flow (tip modal, status, dashboard)
- [ ] Auth model: plugin-to-service credentialing
- [ ] Deployment steps for a demo Discourse instance

## Phase 4: Delivery plan (8 weeks per proposal)
### Milestone 1 (Weeks 1–2): Design + Fiber prototype
- [ ] Architecture + threat model
- [ ] Hub node on testnet
- [ ] Backend skeleton + DB schema
- [ ] Demo: invoice → payment → ledger credit

### Milestone 2 (Weeks 3–5): Discourse plugin + end-to-end tipping
- [ ] Tip UI + modal
- [ ] Endpoints for plugin integration
- [ ] Payment state updates
- [ ] Creator dashboard

### Milestone 3 (Weeks 6–8): Withdrawals + mainnet readiness
- [ ] Withdrawal flow + admin controls
- [ ] Production hardening checklist
- [ ] Full docs + demo

## Outputs (what we will produce)
- Architecture diagram(s)
- API spec draft
- DB schema draft
- Risk register + mitigations
- Repo structure proposal
