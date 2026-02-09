# Fiber Link 3-Year Strategy (Draft)

Date: 2026-02-09
Status: Draft (needs review and iteration)

This document defines a 3-year strategy for Fiber Link that aligns:
- Product direction (Creator payouts) as the primary bet (A = 70%)
- Infrastructure direction (Payments rail) as the enabling foundation (B = 30%)
- A single North Star KPI: monthly active communities

The intent is to set a clear ceiling and sequencing. It is not an implementation plan.

## Strategic Thesis

Fiber Link becomes the "programmable income layer" for online communities and creators:
- Product layer: embedded tipping, balances, payout, and reconciliation that communities can operate with confidence.
- Rail layer: a hardened money state machine (events -> ledger -> balance -> execution) that can be reused by multiple front-ends.

Distribution starts with Discourse (wedge), then expands to a universal embeddable widget + SDK.

We will not try to build a generalized payment processor. We will specialize in:
- Micropayments and community-native monetization flows
- Reliable money movement state machines
- Operational tooling that makes money flows debuggable and correct

Custody boundary (3-year plan):
- Hosted custodial hub remains the default model.
- The plan assumes we invest in operational security (keys, liquidity, limits, monitoring, incident response) rather than pivoting to non-custodial within the 3-year horizon.

## North Star KPI

### Definitions

- community := `appId` (one tenant)
- active community (monthly) := for a given `appId`, in a calendar month:
  - at least 1 `withdrawal` reaches `COMPLETED`
  - that completed withdrawal has `usd_equivalent >= $5` (all assets converted)
  - the completed withdrawal has verifiable execution evidence (for example `txHash`)
  - a corresponding ledger debit exists and is linked to the withdrawal (to prevent "write-only" completion)

### USD Equivalent Policy

USD conversion is computed at `withdrawal.completedAt` and recorded as an audit snapshot at completion time:
- `usd_rate`, `usd_equivalent_cents`, `usd_rate_source`, `usd_rate_fetched_at`
- stablecoin UDTs can use a static 1.0 rate but still record `usd_rate_source = static_1p0`
- non-stable assets (for example CKB) use an off-chain price aggregator and store the chosen price

KPI computation must depend only on stored snapshots, not historical price backfills.

### Year 1 Target

- 10 monthly active communities
- operating model: hosted multi-tenant by default
- initial target segment: Nervos/CKB ecosystem communities
- pipeline tracker: `docs/plans/2026-02-10-year1-community-pipeline.md`

## Year-by-Year Strategy

### Year 1 (2026-2027): Make Money Movement Reliable ("Make It Work, Then Work Every Day")

Goal: ship a production-aligned closed loop from tip -> settlement -> balance -> withdrawal -> reconciliation, and operate it reliably for 10 communities.

Must-win themes:
- Settlement discovery + reconciliation:
  - durable invoice settlement discovery (polling/subscription)
  - reconciliation/backfill loops for missed events
  - idempotent crediting and stable event-to-intent mapping
- Balance + insufficient-funds gate:
  - define balance invariants and a balance read model
  - enforce insufficient-funds rejection on withdrawal requests
  - couple debits to withdrawal completion with idempotency
- Withdrawal execution (real):
  - execute via Fiber/node actions (not stubbed)
  - classify transient vs permanent failures
  - record tx hash and error details; ensure retries are safe
- Operability:
  - SLOs and alerting for settlement latency and withdrawal success rate
  - tracing and audit logs that link invoice/tip_intent/ledger/withdrawal
  - multi-worker safety (claiming, state transitions, retries, re-entrancy)
  - runbooks and repair tools that do not depend on a single machine's paths
- Payouts UX v1 (Discourse):
  - creator dashboard: balance, history, withdrawals, statuses
  - failure UX that is understandable and actionable
  - admin intervention workflow (supportable operations)
- Risk controls v1:
  - limits, rate limiting, deny lists, and scoped admin access
  - clarify custody boundary and the operational security posture

Leading indicators to track weekly:
- time-to-first-withdrawal per community
- withdrawal success rate and retry rate
- manual intervention count (should trend down)
- settlement credit latency p95
- withdrawal completion latency p95

## Appendix: Year 1 Go-To-Market (First 10 Communities)

This plan assumes we target Nervos/CKB ecosystem communities first to reduce adoption friction and to accelerate feedback loops.

### Target Profile

Prefer communities that:
- run Discourse (or are willing to) and have active posting behavior
- have an existing "support the creator" culture (even off-chain today)
- can identify 1-3 creators/moderators who will test payouts end-to-end
- will commit to a weekly feedback loop for the first month

### Rollout Model

- 2-3 design partners:
  - high-touch onboarding and co-debugging
  - optimize the money loop and operability until withdrawals are boring
- 7-8 fast followers:
  - reuse the hardened onboarding/runbook from design partners
  - measure how repeatable the install and activation process is

### Success Funnel (Per Community)

Track these milestones per `appId`:
- app created
- first tip intent created
- first settlement credited
- first withdrawal requested
- first withdrawal completed (>= $5 USD-equivalent)

Core time metric:
- time-to-first-completed-withdrawal

### Support Expectations (Year 1)

To reach 10 active communities without stalling on ops, we should time-box support:
- onboarding window (for example: 30-60 minutes per community)
- a standard "verification gate" and a standard rollback procedure
- a defined incident response path for payout-impacting failures

The goal is to reduce manual intervention per community over time, not to scale support linearly.

### Year 2 (2027-2028): Self-Serve Payouts + Widget/SDK ("Make It Repeatable")

Goal: turn the closed loop into a self-serve multi-tenant product and expand distribution beyond Discourse via widget + SDK.

Must-win themes:
- Self-serve multi-tenant:
  - community onboarding, admin membership management, key rotation
  - quotas, limits, and risk policies configurable per tenant
  - audit queries and exports (operators can answer "what happened" quickly)
- Payouts product 2.0:
  - revenue splits (creator/moderator/community fund)
  - scheduled/automatic payouts with clear policy and guardrails
  - reconciliation exports and dispute/adjustment primitives (at least internal tooling)
- Widget + SDK v1:
  - embeddable UI for tipping and payout status surfaces
  - TS SDK for tip creation/status, withdrawals, and webhooks
  - identity mapping guidance and reference integrations
- Rail contract v1:
  - versioned API surface (JSON-RPC + webhooks)
  - strict error semantics and idempotency contracts
  - sandbox/devnet workflows for integration testing
- Trust/risk:
  - anomaly detection (basic heuristics at first)
  - stronger rate/amount controls that protect liquidity and keys

### Year 3 (2028-2029): Programmable Income Layer ("Make It Composable")

Goal: make Fiber Link a composable revenue layer that third parties embed, with a mature rail and partner ecosystem.

Must-win themes:
- Programmable flows:
  - a policy/strategy layer for money flows (tips, splits, payouts, refunds/adjustments)
  - every balance-affecting action is auditable and replayable
- Rail maturity:
  - multi-tenant isolation, SLA, capacity planning, and disaster recovery
  - event replay and deterministic rebuilds (ledger is source of truth)
  - hardened secret management and key operational playbooks
- Ecosystem partnerships:
  - payout partners, risk partners, and optional compliance/KYC providers (if required)
  - plugin ecosystem around community platforms and creator tools
- Business model:
  - community SaaS tiers (risk, exports, SLA, support)
  - developer usage-based pricing (API/events/webhooks, within reasonable bounds)

## Non-Goals (To Protect Focus)

- Becoming a generalized fiat payment processor
- A non-custodial pivot within the 3-year horizon (the focus is custodial operations done safely)
- Complex multi-chain asset routing in Year 1
- Heavy rule engines before the core state machine is stable

## Open Questions That Block Scaling

This section is tracked as 4 short decision records (1 page each):

- Custody ops controls (hosted hub): `docs/decisions/2026-02-10-custody-ops-controls.md`
- Admin membership model (BetterAuth identity -> app_admins): `docs/decisions/2026-02-10-admin-membership-model.md`
- Settlement discovery strategy (poll vs subscribe vs hybrid): `docs/decisions/2026-02-10-settlement-discovery-strategy.md`
- USD price feed policy (provider, caching, fallback): `docs/decisions/2026-02-10-usd-price-feed-policy.md`
