# Withdrawal Reconciliation (Debit vs txHash Parity)

## Purpose

Detect payout accounting drift between:
- withdrawal execution evidence (`withdrawals.tx_hash`)
- ledger debits (`ledger_entries` with idempotency key `withdrawal:debit:<withdrawal_id>`)
- reversal credits (`ledger_entries` with idempotency key `withdrawal:reversal:<withdrawal_id>`) that refund the debit of a broadcast the chain rejected; a `FAILED` withdrawal with both a debit and a matching reversal is healthy, while a reversal without a debit, on a non-`FAILED` withdrawal, or with a mismatched amount/account is reported as `INVALID_WITHDRAWAL_REVERSAL`

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
