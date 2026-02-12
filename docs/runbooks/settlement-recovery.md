# Settlement Recovery Runbook (Polling + Backfill)

Use this runbook when settlement credits are delayed or missed (for example worker outage, Fiber RPC instability).

## Preconditions

- Worker code with settlement discovery is deployed.
- You have:
  - `DATABASE_URL` pointing to target environment
  - `FIBER_RPC_URL` for the Fiber node RPC endpoint

## 1) Run settlement replay/backfill

From repository root:

```bash
cd fiber-link-service

# Optional filters:
# --app-id=<appId>
# --from=<ISO timestamp>
# --to=<ISO timestamp>
# --limit=<positive integer, default 500>
DATABASE_URL="$DATABASE_URL" \
FIBER_RPC_URL="$FIBER_RPC_URL" \
bun run apps/worker/src/scripts/backfill-settlements.ts -- \
  --app-id=your-app-id \
  --from=2026-02-01T00:00:00Z \
  --to=2026-02-12T00:00:00Z \
  --limit=1000
```

Expected output shape:

```json
{
  "ok": true,
  "appId": "your-app-id",
  "summary": {
    "scanned": 42,
    "settledCredits": 3,
    "settledDuplicates": 1,
    "failed": 2,
    "stillUnpaid": 36,
    "errors": 0,
    "backlogUnpaidBeforeScan": 42,
    "backlogUnpaidAfterScan": 38,
    "detectionLatencyMs": {
      "count": 4,
      "p50": 84500,
      "p95": 126000,
      "max": 126000
    }
  }
}
```

Notes:
- `settledDuplicates > 0` is expected during replays; this indicates idempotent no-op credits.
- `backlogUnpaidBeforeScan - backlogUnpaidAfterScan` shows how much backlog was cleared in the run.
- `detectionLatencyMs` is computed from tip-intent creation time to discovery time for settled invoices in this run.
- Command is safe to re-run for the same window.

## 2) Verify repaired state

- Ensure `errors == 0` in output.
- Re-run the same command once; counts should converge and no duplicate credits should appear.
- Confirm target invoices moved from `UNPAID` to `SETTLED`/`FAILED` as appropriate.

## 3) If errors persist

- Check worker/service logs for invoice-level errors (`[worker] settlement discovery item failed`).
- Validate `FIBER_RPC_URL` reachability and RPC response correctness.
- Narrow replay window (`--from/--to`) and retry by smaller batches (`--limit`).
