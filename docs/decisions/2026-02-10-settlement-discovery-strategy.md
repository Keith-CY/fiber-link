# Decision: Settlement Discovery Strategy (Poll vs Subscribe vs Hybrid)

Date: 2026-02-10
Owner: Fiber Link
Status: ACCEPTED (2026-02-11)
Related: `docs/plans/2026-02-09-3-year-strategy-design.md`

Decision outcome: Option C (hybrid) is accepted; Year 1 implementation baseline is polling + periodic backfill, with subscription as an optional latency optimization after stability validation.

## Decision

Choose the canonical settlement discovery strategy for invoice-based tips, and define the failure model:
- how we detect "invoice settled" events
- how we ensure we do not miss events or double-credit
- how we recover after downtime

## Context

For Year 1, "money movement reliability" is the product. Settlement discovery is the first critical step:
- tip intent is created (invoice generated)
- settlement is observed (invoice paid)
- ledger is credited (idempotent)

If settlement discovery is ambiguous or fragile, we cannot scale beyond a small number of communities without constant manual repair.

Constraints:
- settlement entrypoints are invoice-based today
- events can be delayed, duplicated, or missed (process crash, network outage, upstream node issues)
- correctness is more important than low latency in Year 1, but latency still matters for user trust

## Options

### Option A: Polling-only

- Worker polls for settlement status of "pending" invoices on an interval.
- Periodic backfill job scans a time window to catch missed transitions.

Pros:
- simplest surface area
- easy to reason about failure recovery

Cons:
- higher load (polling)
- slower detection latency unless polling is aggressive

### Option B: Subscription-only

- Worker subscribes to settlement events (stream/webhook) and credits as events arrive.

Pros:
- low latency
- lower steady-state load

Cons:
- missed events are hard to recover without a separate backfill mechanism
- subscription semantics are usually not exactly-once

### Option C: Hybrid (subscribe fast path + poll/backfill correctness)

- Subscribe for low latency.
- Poll/backfill is the correctness safety net and the recovery path after downtime.

Pros:
- best of both: low latency + robust recovery
- can start with polling and add subscription later

Cons:
- more moving parts
- needs a clear "source of truth" rule to avoid ambiguity

## Recommendation

Adopt Option C (hybrid) as the canonical strategy, implemented in phases:
- Year 1 baseline: polling + periodic backfill (correctness first)
- Add subscription only when the upstream interface is proven stable, as a latency optimization

## Required Invariants (Regardless of Option)

These are required for scaling correctness:
- invoice -> tip_intent mapping is 1:1:
  - require `tip_intents.invoice` uniqueness (already declared in schema; verify DB migrations enforce it)
- crediting is idempotent:
  - settlement credit is uniquely keyed to the durable intent identity (for example `tip_intent.id`)
  - store the settlement evidence (for example `txHash`) with the credited record
- discovery is replayable:
  - polling/backfill can be re-run without changing final balances

## Failure Model

Define what "correct" behavior means under failures:
- worker crash/restart:
  - pending invoices remain pending and will be re-checked
  - already credited invoices will not be double-credited (idempotency)
- upstream node downtime:
  - polling fails but does not advance state incorrectly
  - backfill catches up after recovery
- duplicate observations:
  - duplicates are ignored via unique constraints + idempotent ledger keys
- invoice expires/unpaid:
  - tip intent transitions to a terminal non-credited state and UI offers retry (new invoice)

## Decision Meeting (30-45 min)

Agenda:
1. Confirm upstream capabilities:
   - do we have a usable settlement subscription API today, or only polling?
2. Choose the Year 1 baseline:
   - polling interval target (and acceptable detection latency)
   - backfill window (for example: last 7 days) and schedule
3. Confirm invariants:
   - unique invoice requirement
   - idempotent credit key scheme
4. Confirm UX contract:
   - how long is "pending" before user sees a retry option

Outputs:
- a one-page "settlement lifecycle" state diagram and timeout policy
- a backfill/runbook procedure for "missed settlement" incidents

## Follow-Ups (After Decision)

- Verify the unique constraint/index for `tip_intents.invoice` is enforced in the DB (migrations applied); add a migration if missing.
- Add monitoring:
  - settlement detection latency p95
  - backlog size of pending invoices
  - backfill credits count (should trend toward 0 for steady state)
- Add a repair tool:
  - "re-run settlement backfill for appId and time window" (safe and idempotent)
