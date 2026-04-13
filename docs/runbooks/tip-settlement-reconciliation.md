# Tip Settlement Reconciliation (Settlement vs Ledger Credit Parity)

## Purpose

Detect payout/accounting drift between:
- tip settlement evidence (`tip_intents.invoice_state = SETTLED`, plus `settled_at`)
- ledger credits (`ledger_entries` with idempotency key `settlement:tip_intent:<tip_intent_id>`)

## Command

From repo root:

```bash
bun run --cwd fiber-link-service/apps/worker reconcile:tips -- --limit=500
```

Optional filters:

```bash
bun run --cwd fiber-link-service/apps/worker reconcile:tips -- \
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
- totals (tip intents, settled tip intents, credit entries, matched credits, issue count)
- issues grouped by kind
- detailed issue list

## Issue classes

- `MALFORMED_CREDIT_IDEMPOTENCY_KEY`
- `ORPHAN_CREDIT_ENTRY`
- `SETTLED_TIP_MISSING_SETTLED_AT`
- `SETTLED_TIP_MISSING_CREDIT`
- `NON_SETTLED_TIP_HAS_CREDIT`
- `DUPLICATE_CREDIT_ENTRIES`
- `CREDIT_ACCOUNT_MISMATCH`
- `CREDIT_AMOUNT_MISMATCH`

## Operational use

This is the correct backend source to cross-check external/demo automation records.
A tip should only be counted as truly successful when:
1. the business record is settled (`tip_intents.invoice_state = SETTLED`)
2. settlement evidence exists (`settled_at` present)
3. the recipient ledger credit exists and matches app/user/asset/amount

Primary implementation:
- `fiber-link-service/apps/worker/src/tip-settlement-reconciliation.ts`
- `fiber-link-service/apps/worker/src/scripts/reconcile-tip-settlement-parity.ts`
