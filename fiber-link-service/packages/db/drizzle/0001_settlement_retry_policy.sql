-- Settlement failure/retry persistence fields for issue #60.
ALTER TABLE "tip_intents"
  ADD COLUMN IF NOT EXISTS "settlement_retry_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settlement_next_retry_at" timestamp,
  ADD COLUMN IF NOT EXISTS "settlement_last_error" text,
  ADD COLUMN IF NOT EXISTS "settlement_failure_reason" text,
  ADD COLUMN IF NOT EXISTS "settlement_last_checked_at" timestamp;
