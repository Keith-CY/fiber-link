# Milestone 1: Settlement Backfill Summary

## Artifact source

- Command: `bun run apps/worker/src/scripts/backfill-settlements.ts`
- Runbook: `docs/runbooks/settlement-recovery.md`
- Required output fields include `errors`, backlog metrics, and duplicate/error summaries.

## Public publication target

- Published copy should be stored at:
  - `docs/runbooks/acceptance-evidence/milestone-1/settlement-backfill.md` (this file)

## Latest local run

- Date: 2026-02-17
- Command:
  - `DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<db> FIBER_RPC_URL=http://127.0.0.1:8227 bun run apps/worker/src/scripts/backfill-settlements.ts -- --limit=20`
- Result: `ok=true`
- Summary:
  - `scanned=1`
  - `errors=0`
  - `stillUnpaid=1`
  - `backlogUnpaidBeforeScan=1`
  - `backlogUnpaidAfterScan=1`
