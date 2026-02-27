# Withdrawal Reconciliation (Debit vs txHash Parity)

## Purpose

Detect payout accounting drift between:
- withdrawal execution evidence (`withdrawals.tx_hash`)
- ledger debits (`ledger_entries` with idempotency key `withdrawal:debit:<withdrawal_id>`)

## Command

From repo root:

```bash
bun run --cwd fiber-link-service/apps/worker reconcile:withdrawals -- --limit=500
```

Optional filters:

```bash
bun run --cwd fiber-link-service/apps/worker reconcile:withdrawals -- \
  --app-id=<app_id> \
  --from=<ISO-8601> \
  --to=<ISO-8601> \
  --limit=1000
```

## Exit Codes

- `0`: parity healthy (no issues)
- `2`: reconciliation issues detected
- `1`: command/runtime failure

## Output

The command prints JSON with:
- scope (`appId`, `from`, `to`, `limit`)
- totals (withdrawals, completed withdrawals, debit entries, matched debits, issue count)
- issues grouped by kind
- detailed issue list

Primary implementation:
- `fiber-link-service/apps/worker/src/withdrawal-reconciliation.ts`
- `fiber-link-service/apps/worker/src/scripts/reconcile-withdrawal-parity.ts`
