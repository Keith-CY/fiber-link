# Decision: USD Price Feed Policy (Snapshots at Withdrawal Completion)

Date: 2026-02-10 (scheduled)
Owner: Fiber Link
Status: OPEN
Related: `docs/plans/2026-02-09-3-year-strategy-design.md`

## Decision

Define the USD price feed provider strategy, caching, and fallback policy for recording USD snapshots used by KPI and reporting:
- provider choice (primary/secondary)
- caching and staleness rules
- what happens when price is unavailable at completion time

This decision is for auditability and KPI consistency. It must not block money movement.

## Context

The North Star KPI uses:
- `usd_equivalent >= $5` for at least one `withdrawal.COMPLETED` per month, per appId

USD conversion is an off-chain dependency. If the price feed is flaky:
- KPI becomes noisy or incorrect
- debugging becomes expensive ("why does this withdrawal not count?")

We already require snapshots to be stored, not recomputed historically:
- `usd_rate`, `usd_equivalent_cents`, `usd_rate_source`, `usd_rate_fetched_at`
- quote time should be tied to `withdrawal.completedAt`

## Options

### Option A: Single provider + cache

- Use one aggregator as source of truth.
- Cache by asset symbol/id with a short TTL.

Pros:
- simplest
Cons:
- provider outage breaks snapshot recording

### Option B: Primary + secondary fallback (recommended)

- Use a primary aggregator.
- If primary fails, try secondary.
- If both fail, use last-known cached value if not too stale.
- If no acceptable cached value exists, record snapshot as missing and queue a backfill job.

Pros:
- best operational reliability for Year 1
Cons:
- more code and more monitoring

### Option C: On-chain oracle / self-hosted price indexer

Pros:
- full control
Cons:
- large scope; does not align to Year 1 goals

## Recommendation

Adopt Option B.

Key policy decisions:
- Price snapshot is best-effort at completion time and must not block marking a withdrawal as completed.
- If price is unavailable:
  - record USD fields as null and queue a backfill job
  - KPI computation should treat missing snapshots as not-counting until backfilled
- Backfill must not change history:
  - backfill only writes snapshots when USD fields are null (never overwrite an existing snapshot)
  - `usd_rate_quote_at` remains the intended quote time (`withdrawal.completedAt`), while `usd_rate_fetched_at` records when the rate was actually fetched
  - if the chosen provider does not support historical quotes at a timestamp, backfill uses the best available spot price at backfill time and records that fact via `usd_rate_source`

## Required Data Fields

To keep KPI deterministic and auditable:
- `usd_rate_quote_at`: timestamp the rate is intended to represent (set to `withdrawal.completedAt`)
- `usd_rate_fetched_at`: when the system fetched the rate
- `usd_rate_source`: primary / secondary / cached_last_known / static_1p0
- `usd_rate`: numeric rate used
- `usd_equivalent_cents`: rounded USD cents

Stablecoin UDTs:
- use `usd_rate = 1.0`
- `usd_rate_source = static_1p0`

## Caching and Staleness Policy

Suggested defaults (tune after real usage):
- cache TTL: 60 seconds for normal operation
- last-known fallback max staleness: 24 hours
- sanity guard: if a fetched rate differs by > 10x from last-known, treat as suspicious and prefer secondary or fail to backfill queue

## Decision Meeting (30-45 min)

Agenda:
1. Choose primary and secondary providers (and why).
2. Confirm cache TTL and max staleness.
3. Confirm failure behavior:
   - do not block withdrawal completion
   - queue backfill if snapshot missing
4. Confirm audit fields and rounding policy (USD cents).

Outputs:
- provider choices + API contracts (inputs/outputs, rate limits, error cases)
- monitoring checklist:
  - provider error rate
  - snapshot missing count
  - backfill lag

## Follow-Ups (After Decision)

- Implement a small price service with:
  - provider clients (primary + secondary)
  - caching
  - backfill job for missing snapshots
- Add tests:
  - fallback order and staleness rules
  - stablecoin static behavior
- Add runbook:
  - what to do when providers are down (temporarily accept missing snapshots; re-run backfill later)
