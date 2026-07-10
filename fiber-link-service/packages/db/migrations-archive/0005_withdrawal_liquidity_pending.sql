ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "liquidity_request_id" uuid,
  ADD COLUMN IF NOT EXISTS "liquidity_pending_reason" text,
  ADD COLUMN IF NOT EXISTS "liquidity_checked_at" timestamp;

DO $$
BEGIN
  ALTER TABLE "withdrawals"
    ADD CONSTRAINT "withdrawals_liquidity_request_id_liquidity_requests_id_fk"
    FOREIGN KEY ("liquidity_request_id") REFERENCES "liquidity_requests"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "withdrawals"
    ADD CONSTRAINT "withdrawals_liquidity_pending_fields_check"
    CHECK (
      "state" <> 'LIQUIDITY_PENDING'
      OR (
        "liquidity_request_id" IS NOT NULL
        AND "liquidity_pending_reason" IS NOT NULL
        AND "liquidity_checked_at" IS NOT NULL
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
