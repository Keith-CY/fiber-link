# Decision: Custody Ops Controls (Hosted Hub)

Date: 2026-02-10 (scheduled)
Owner: Fiber Link
Status: OPEN
Related: `docs/plans/2026-02-09-3-year-strategy-design.md`

## Decision

Define the minimum operational security controls required to run a hosted custodial hub safely in Year 1 (supporting 10 active communities), and what we will explicitly not support.

This decision is about operational posture, not code structure.

## Context

The 3-year plan assumes hosted custodial hub remains the default model. That implies:
- keys and liquidity are our responsibility
- money movement reliability is a product feature
- failures must be diagnosable and recoverable without data loss

Without a clear control baseline, we will either:
- ship too little (risk unacceptable), or
- overbuild too early (delivery stalls)

## Options

### Option A: Minimal viable custodial controls (Year 1 baseline)

Controls are sufficient for a limited beta (10 communities) with strong limits and manual review:
- strict per-app and per-user limits (max balance, max daily withdrawal, max tip amount)
- rate limiting and deny lists at the RPC boundary
- withdrawal holds (cooldown) and manual override for anomalies
- key storage and rotation runbook (documented, tested)
- incident runbook: stop withdrawals, pause credits, backfill/reconcile
- audit logging that links invoice -> intent -> ledger -> withdrawal -> tx hash
- monitoring: withdrawal success rate, settlement credit latency, queue depth, worker retries

### Option B: Enterprise-grade controls from day 1

Add stronger controls immediately:
- HSM or equivalent hardened key storage
- more granular policy engine and approvals
- strong separation of duties and multi-party approvals
- full DR rehearsals and periodic audits

### Option C: Reduce custody surface (still custodial)

Keep the hub custodial, but minimize internal balances:
- smaller balances, faster auto-withdrawals
- tighter thresholds and shorter credit retention
- push complexity to payout execution and reconciliation

## Recommendation

Start with Option A as the Year 1 baseline, with one borrow from Option C:
- avoid large retained balances by setting conservative limits and encouraging smaller, more frequent withdrawals

Escalate from A to stronger controls only after:
- we have 3+ active communities and see real operational failure modes
- we can quantify the risk and justify the complexity

## Decision Criteria

We should approve a baseline that:
- protects keys and limits blast radius
- makes failures recoverable (reconcile/backfill is a first-class operation)
- is operable by a small team (does not require 24/7 human presence initially)
- does not block Year 1 closed-loop delivery

## Pre-Reads / Inputs

- `docs/05-threat-model.md`
- Known wallet/node operational constraints for CKB Fiber hub
- Expected asset set (CKB + stablecoin UDT) and liquidity assumptions

## Decision Meeting (30-45 min)

Agenda:
1. Confirm Year 1 beta constraints (10 communities, hosted multi-tenant, limits)
2. Agree on baseline controls (must-have vs should-have)
3. Pick explicit non-goals (what we will not protect against in Year 1)
4. Assign owners and deadlines for the control checklist and runbook updates

Outputs:
- a control checklist with owners
- a single "kill switch" operational policy for payouts

## Follow-Ups (After Decision)

- Add a control checklist section to the production hardening docs/runbook
- Encode limits in configuration defaults (per-app)
- Add monitoring and alert thresholds aligned to the chosen controls
