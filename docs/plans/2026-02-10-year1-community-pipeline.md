# Year 1 Community Pipeline (First 10 Communities)

Date: 2026-02-10
Owner: Fiber Link
Status: Draft

This document tracks the first 10 communities for the Year 1 goal and the activation funnel per tenant.

## North Star KPI (Reference)

- community := `appId`
- active community (monthly) := for a given `appId`, in a calendar month:
  - at least 1 `withdrawal` reaches `COMPLETED`
  - that completed withdrawal has `usd_equivalent >= $5` (all assets converted)
  - the completed withdrawal has execution evidence (for example `txHash`)
  - a corresponding ledger debit exists and is linked to the withdrawal
- `usd_equivalent` is computed at `withdrawal.completedAt` and stored as an audit snapshot.

## Funnel (Per Community)

Milestones to reach "active":
1. App created (`appId`)
2. First tip intent created
3. First settlement credited
4. First withdrawal requested
5. First withdrawal completed (>= $5 USD-equivalent)

Primary time metric:
- time-to-first-completed-withdrawal

## Pipeline Tracker

Legend:
- Stage: `prospect` | `design_partner` | `fast_follower` | `active`
- Platform: `discourse_existing` | `discourse_new` | `other`

| Slot | Community | Stage | Platform | Primary Contact | appId | App Created | 1st Tip Intent | 1st Credit | 1st WD Requested | 1st WD Completed | 1st WD USD (>=5) | Notes / Blockers |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Nervos Talk (talk.nervos.org) | design_partner | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Seed community; confirm willingness to run weekly feedback loop. |
| 2 | Pending | design_partner | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 3 | Pending | design_partner | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 4 | Pending | fast_follower | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 5 | Pending | fast_follower | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 6 | Pending | fast_follower | discourse_existing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 7 | Pending | fast_follower | discourse_new | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 8 | Pending | fast_follower | discourse_new | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 9 | Pending | fast_follower | discourse_new | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 10 | Pending | fast_follower | discourse_new | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

## Weekly Operating Cadence (Year 1)

Weekly review (30 minutes):
- Count: communities at each stage
- Funnel conversion: step-to-step drop-off
- Top blockers across all communities
- Reliability scorecard:
  - withdrawal success rate
  - settlement credit latency p95
  - withdrawal completion latency p95
  - manual intervention count

## Candidate Sourcing (CKB Ecosystem)

Primary channels to find the remaining 9:
- Existing CKB/Nervos Discourse instances (ideal)
- CKB ecosystem project teams that already run a community (can pilot a Discourse if needed)
- Nervos community moderators who can nominate 1-3 creators to test payouts end-to-end

