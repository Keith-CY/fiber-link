# Database package

This package owns Drizzle schema definitions and persistence repos.

## Schema workflow

- `src/schema.ts` is the source of truth for DB tables and enum types.
- `tipIntents.invoice_state` is currently a text column in schema (`invoiceState: text("invoice_state")`).

## Migration workflow

From this package directory:

- Generate SQL from schema changes:
  - `bun run db:generate`
- Apply migrations to the configured database:
  - `bun run db:migrate`
- Apply migrations to local Postgres in idempotent mode (runs twice; second pass should be no-op):
  - `bun run db:migrate:local`

### Idempotency requirement

Every migration file must be safe to apply **twice**. The visual-acceptance
e2e harness (`scripts/e2e-invoice-payment-accounting.sh`) replays every
`drizzle/*.sql` file with `psql -v ON_ERROR_STOP=1` on top of a database the
compose `migrate` service has already migrated, so a bare `CREATE TABLE` /
`ADD COLUMN` / `ADD CONSTRAINT` / `CREATE TYPE` aborts the whole run with a
duplicate-object error.

Conventions (drizzle-kit generates the first two by default; hand-adjust the
rest after `db:generate`):

- `CREATE TABLE IF NOT EXISTS ...`
- `CREATE [UNIQUE] INDEX IF NOT EXISTS ...`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- `CREATE TYPE` and `ADD CONSTRAINT` wrapped in
  `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`
- Data statements (`DELETE`/`UPDATE`/`INSERT`) written to be re-runnable
  (see `0002_notification_rules_channel_fk.sql` for an example).

`src/migration-idempotency.test.ts` enforces the DDL rules in the regular
test suite, and `db:migrate:local` (apply twice; second pass must be a no-op)
exercises the same property against a live database.

Also note: `drizzle/meta/` snapshots are gitignored — only `_journal.json` is
tracked. After `db:generate`, rename the generated SQL file to a descriptive
`NNNN_snake_case_name.sql` and update the matching `tag` in
`drizzle/meta/_journal.json`.

Set `DATABASE_URL` for non-local migration commands:

```bash
export DATABASE_URL=postgres://.../fiber_link
```

`db:migrate:local` defaults to `postgres://postgres:postgres@127.0.0.1:5432/fiber_link` when `DATABASE_URL` is not set.

## Migration validation

- Check migration metadata drift:
  - `bun run db:drift:check`
- CI entrypoint for migration validation:
  - `bun run db:validate`

## Development check

Use schema and transition tests as smoke checks:

- `bun test`
