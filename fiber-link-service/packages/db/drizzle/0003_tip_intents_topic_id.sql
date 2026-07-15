-- Idempotent ADD COLUMN: the e2e harness replays every migration file via psql
-- on top of an already-migrated database (see scripts/e2e-invoice-payment-
-- accounting.sh), so this must tolerate the column already existing.
ALTER TABLE "tip_intents" ADD COLUMN IF NOT EXISTS "topic_id" text;