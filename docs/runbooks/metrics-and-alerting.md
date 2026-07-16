# Metrics and Alerting

This runbook documents the Prometheus-style metrics exposed by the Fiber Link
service, how to scrape them, a baseline alert-rule set, and the **alert drill**
procedure that proves alerts actually reach a responsible person.

It complements [compose-ops-monitoring.md](./compose-ops-monitoring.md) (the
JSON/exit-code ops summary): the ops summary is a pull-style one-shot check,
while the metrics endpoints below feed a continuously scraping Prometheus (or
any OpenMetrics-compatible collector).

## Endpoints

| Service | Endpoint | Enable | Auth |
| --- | --- | --- | --- |
| RPC (`apps/rpc`) | `GET /metrics` on the RPC port | always on | optional `RPC_METRICS_TOKEN` bearer token |
| Worker (`apps/worker`) | `GET /metrics` on `WORKER_METRICS_PORT` | only when `WORKER_METRICS_PORT` is set | optional `WORKER_METRICS_TOKEN` bearer token |

When a token is configured, scrapes must send `Authorization: Bearer <token>`;
without it the endpoint returns `401`. Leave the token unset only when the port
is network-isolated.

Example scrape config:

```yaml
scrape_configs:
  - job_name: fiber-link-rpc
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <RPC_METRICS_TOKEN>
    static_configs:
      - targets: ["rpc:3000"]
  - job_name: fiber-link-worker
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <WORKER_METRICS_TOKEN>
    static_configs:
      - targets: ["worker:9464"]
```

## Metric catalog

### RPC

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `fiber_link_rpc_requests_total` | counter | `method` | RPC requests dispatched (unknown methods bucketed as `unknown`) |
| `fiber_link_rpc_hmac_secret_source_total` | counter | `source` | Auth attempts by HMAC secret source; rising `env_fallback` means per-app secrets are missing |

### Worker — settlement

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `fiber_link_settlement_backlog_unpaid` | gauge | — | Tip intents currently UNPAID (scrape-time DB count) |
| `fiber_link_settlement_retry_pending` | gauge | — | UNPAID intents waiting on a scheduled settlement retry |
| `fiber_link_settlement_credited_total` | counter | — | Settlements that applied a ledger credit (idempotent replays not counted) |
| `fiber_link_settlement_failures_total` | counter | `reason` | Terminal settlement failures (`FAILED_UPSTREAM_REPORTED`, `FAILED_PENDING_TIMEOUT`, `FAILED_RETRY_EXHAUSTED`, `FAILED_CONTRACT_MISMATCH`, `FAILED_TERMINAL_ERROR`) |

### Worker — withdrawals

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `fiber_link_withdrawal_state_count` | gauge | `state` | Current withdrawals per state (scrape-time DB count) |
| `fiber_link_withdrawal_batch_duration_seconds` | histogram | — | Wall-clock duration of each withdrawal batch run |
| `fiber_link_withdrawal_failures_total` | counter | `kind` | Failed withdrawals by classification (`transient_exhausted`, `permanent`, `broadcast_rejected`) |

### Worker — notifications and accounting

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `fiber_link_webhook_delivery_failures_total` | counter | — | Webhook deliveries that exhausted all attempts without a 2xx |
| `fiber_link_ledger_negative_balance_accounts` | gauge | — | Accounts whose ledger balance sums below zero; **any value above 0 is an accounting anomaly** |

Both endpoints also expose the standard `prom-client` process/runtime metrics
(`process_*`, `nodejs_*`).

## Baseline alert rules

Tune thresholds per deployment; these are conservative starting points.

```yaml
groups:
  - name: fiber-link
    rules:
      - alert: FiberLinkSettlementBacklogHigh
        expr: fiber_link_settlement_backlog_unpaid > 50
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: "Settlement backlog above 50 for 15m"

      - alert: FiberLinkSettlementTerminalFailures
        expr: increase(fiber_link_settlement_failures_total[30m]) > 0
        labels: { severity: warning }
        annotations:
          summary: "Terminal settlement failures in the last 30m"

      - alert: FiberLinkWithdrawalFailures
        expr: increase(fiber_link_withdrawal_failures_total[30m]) > 0
        labels: { severity: warning }
        annotations:
          summary: "Withdrawal failures in the last 30m"

      - alert: FiberLinkWebhookDeliveryFailures
        expr: increase(fiber_link_webhook_delivery_failures_total[30m]) > 3
        labels: { severity: warning }
        annotations:
          summary: "Webhook deliveries repeatedly exhausting retries"

      - alert: FiberLinkLedgerNegativeBalance
        expr: fiber_link_ledger_negative_balance_accounts > 0
        labels: { severity: critical }
        annotations:
          summary: "Negative-balance ledger account detected (accounting anomaly)"

      - alert: FiberLinkMetricsDown
        expr: up{job=~"fiber-link-.*"} == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "Fiber Link metrics endpoint unreachable"
```

## Alert drill

Run this drill after wiring alert delivery (e.g. Alertmanager → email/IM/pager)
and repeat it quarterly or after routing changes. The goal is written evidence
that a forced warning/critical condition reached a responsible person and was
acknowledged.

### Procedure

1. **Announce** the drill in the ops channel (so a real response is not
   confused with the drill) and record the start time.
2. **Force a warning condition** — pick one:
   - Stop the worker container (`docker compose stop worker`) and wait for
     `FiberLinkMetricsDown` (5m `for` window), or
   - Temporarily lower `FiberLinkSettlementBacklogHigh`'s threshold to `-1` in
     a drill-only rules file so it fires on the next evaluation.
3. **Capture delivery evidence**: screenshot or export the alert notification
   as it arrived (email header with timestamp, chat message link, pager
   incident id).
4. **Acknowledge**: the on-call responder acknowledges through the normal
   channel; record the ack timestamp.
5. **Restore**: restart the worker / revert the drill threshold; confirm the
   alert resolves and record the resolve timestamp.
6. **File the evidence** under `docs/runbooks/acceptance-evidence/` (or your
   deployment's evidence store) using the template below.

### Evidence template

```markdown
## Alert drill — <YYYY-MM-DD>

- Drill operator: <name>
- Forced condition: <e.g. worker stopped → FiberLinkMetricsDown>
- Alert fired at: <UTC timestamp> (rule: <name>, severity: <level>)
- Delivered via: <channel> — evidence: <link/screenshot path>
- Acknowledged by: <name> at <UTC timestamp> (ack latency: <mm:ss>)
- Condition restored at: <UTC timestamp>; alert resolved at: <UTC timestamp>
- Follow-ups: <routing gaps, threshold tuning, none>
```

A drill **passes** when the alert was delivered, acknowledged by a person
within the on-call SLA, and resolved after restoration — all three timestamps
captured.
