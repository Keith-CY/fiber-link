-- Bootstrap only: extensions required by the Fiber Link schema.
--
-- The database schema itself is NOT created here. It is owned by the Drizzle
-- migrations in fiber-link-service/packages/db/drizzle and applied by the
-- one-shot `migrate` compose service (or manually via `bun run db:migrate`).
-- Keeping schema DDL out of this init script avoids drift between the
-- bootstrap copy and the migration history: this file only runs on a fresh
-- Postgres volume, so it can never upgrade an existing deployment.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
