ALTER TYPE "withdrawal_state"
  ADD VALUE IF NOT EXISTS 'LIQUIDITY_PENDING' BEFORE 'PENDING';

DO $$
BEGIN
  CREATE TYPE "liquidity_request_state" AS ENUM ('REQUESTED', 'REBALANCING', 'FUNDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "asset" AS ENUM ('CKB', 'USDI');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "liquidity_request_source_kind" AS ENUM ('FIBER_TO_CKB_CHAIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "liquidity_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_id" text NOT NULL,
  "asset" "asset" NOT NULL,
  "network" text NOT NULL,
  "state" "liquidity_request_state" NOT NULL,
  "source_kind" "liquidity_request_source_kind" NOT NULL,
  "required_amount" numeric NOT NULL,
  "funded_amount" numeric NOT NULL,
  "metadata" jsonb,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "liquidity_requests_state_created_at_idx"
  ON "liquidity_requests" ("state", "created_at", "id");

CREATE INDEX IF NOT EXISTS "liquidity_requests_app_asset_state_idx"
  ON "liquidity_requests" ("app_id", "asset", "state", "created_at", "id");
