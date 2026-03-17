# Compose Ops Monitoring

This runbook defines the production monitoring baseline for the self-hosted compose deployment.

## Purpose

Use one machine-consumable command to answer:

- are worker dependencies ready?
- is settlement backlog within threshold?
- are retry-pending invoices building up?
- did recent settlement failures appear?
- did withdrawal parity checks detect accounting drift?

The command prints JSON and uses exit codes so cron, systemd timers, CI, or external alerting can route incidents without parsing free-form logs.

## Command

From repo root:

```bash
deploy/compose/compose-ops-summary.sh
```

Optional:

```bash
deploy/compose/compose-ops-summary.sh \
  --output=deploy/compose/evidence/ops-summary-$(date -u +%Y%m%dT%H%M%SZ).json
```

## Exit Codes

- `0`: all signals are within configured thresholds
- `2`: alert state; JSON output contains one or more `alerts[]` entries
- `1`: command/runtime failure (for example docker exec failure, missing service, or script exception)

Treat `exit 2` as an actionable monitoring alarm, not as a command error.

## Threshold Configuration

The worker container reads these values from `deploy/compose/.env`:

- `WORKER_OPS_MAX_UNPAID_BACKLOG`
- `WORKER_OPS_MAX_OLDEST_UNPAID_AGE_MS`
- `WORKER_OPS_MAX_RETRY_PENDING`
- `WORKER_OPS_MAX_RECENT_FAILED_SETTLEMENTS`
- `WORKER_OPS_RECENT_FAILURE_LOOKBACK_HOURS`
- `WORKER_OPS_MAX_WITHDRAWAL_PARITY_ISSUES`
- `WORKER_OPS_WITHDRAWAL_LOOKBACK_HOURS`
- `WORKER_OPS_WITHDRAWAL_SAMPLE_LIMIT`

Recommended production rule:

- keep parity threshold at `0`
- keep recent failed settlements threshold at `0`
- set backlog and age thresholds to values that alert before `WORKER_SETTLEMENT_PENDING_TIMEOUT_MS`

## Scheduling

Example cron entry on the deployment host:

```cron
*/5 * * * * cd /srv/fiber-link && deploy/compose/compose-ops-summary.sh --output=deploy/compose/evidence/ops-summary-latest.json
```

Recommended handling:

- page or ticket on `exit 2`
- page immediately on repeated `exit 1`
- attach the JSON output to the incident or release ticket

## Operator Response

If the command alerts:

1. Inspect `alerts[]` in the JSON payload.
2. Check `docker compose logs --tail=200 worker rpc`.
3. Run bounded repair commands as needed:
   - `bun run --cwd fiber-link-service/apps/worker reconcile:withdrawals`
   - `bun run --cwd fiber-link-service/apps/worker backfill:settlements --limit=200`
4. If data safety is in doubt, take a fresh backup with `scripts/capture-compose-backup.sh` before remediation.
