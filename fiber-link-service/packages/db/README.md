# Database package

This package owns Drizzle schema definitions and persistence repos.

## Schema workflow

- `src/schema.ts` is the source of truth for DB tables and enum types.
- `tipIntents.invoice_state` is constrained by `tipInvoiceStateEnum` (`UNPAID`, `SETTLED`, `FAILED`).

## Migration workflow

From this package directory:

- Generate SQL from schema changes:
  - `bun run db:generate`
- Apply migrations to the configured database:
  - `bun run db:migrate`
- Apply migrations to local Postgres in idempotent mode (runs twice; second pass should be no-op):
  - `bun run db:migrate:local`

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
