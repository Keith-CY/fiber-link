ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "liquidity_request_id" uuid,
  ADD COLUMN IF NOT EXISTS "liquidity_pending_reason" text,
  ADD COLUMN IF NOT EXISTS "liquidity_checked_at" timestamp;
