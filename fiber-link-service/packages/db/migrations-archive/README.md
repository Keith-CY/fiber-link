# Archived hand-written migrations (pre-baseline)

These SQL files are the original hand-written migration history that predates the
regenerated Drizzle baseline (`../drizzle/0000_baseline.sql`). They are kept for
reference only and are **not** applied by `db:migrate`.

## Why they were archived

- `drizzle/meta/_journal.json` never listed these files, so `drizzle-kit migrate`
  silently applied nothing.
- Two pairs of files shared the same number (`0009_*` and `0010_*`), which made the
  intended ordering ambiguous.
- The compose bootstrap schema (`deploy/compose/postgres/init/001_schema.sql`)
  drifted from these files and from `src/schema.ts`.

The baseline was regenerated from `src/schema.ts` with `drizzle-kit generate` and is
idempotent (guarded `CREATE TYPE`, `CREATE TABLE IF NOT EXISTS`, guarded FK
constraints), so it is safe to run against both fresh databases and databases that
were provisioned from this legacy chain.

## Ordering of the legacy chain

For a database that still needs the legacy chain replayed manually, the intended
order is:

1. `0001_settlement_retry_policy.sql`
2. `0002_withdrawal_policy_controls.sql`
3. `0003_withdrawal_destination_kind.sql`
4. `0004_liquidity_requests.sql`
5. `0005_withdrawal_liquidity_pending.sql`
6. `0006_tip_intent_events.sql`
7. `0007_tip_intent_messages.sql`
8. `0008_withdrawal_broadcasted_state.sql`
9. `0009_liquidity_requests_open_unique.sql`
10. `0009_withdrawal_client_request_id.sql`
11. `0010_notification_channels.sql`
12. `0010_notification_tip_settled_event.sql`
13. `0011_admin_withdrawal_audit_events.sql`

(The duplicated numbers are independent of each other, so either order within each
pair converges to the same schema.)

## Known cosmetic difference for legacy databases

Databases upgraded through the legacy chain added `withdrawal_state` enum values
with `ALTER TYPE ... ADD VALUE`, so the enum's internal ordinal order differs from a
fresh baseline database (`BROADCASTED` sorts last instead of after `PROCESSING`).
No code depends on enum ordinal ordering; this only matters for `ORDER BY` on the
raw enum column.
