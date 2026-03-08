DO $$
BEGIN
  CREATE TYPE "invoice_state" AS ENUM (
    'UNPAID',
    'SETTLED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "tip_intent_event_source" AS ENUM (
    'TIP_CREATE',
    'TIP_STATUS',
    'SETTLEMENT_DISCOVERY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "tip_intent_event_type" AS ENUM (
    'TIP_CREATED',
    'TIP_STATUS_UNPAID_OBSERVED',
    'TIP_STATUS_SETTLED',
    'TIP_STATUS_FAILED',
    'SETTLEMENT_NO_CHANGE',
    'SETTLEMENT_SETTLED_CREDIT_APPLIED',
    'SETTLEMENT_SETTLED_DUPLICATE',
    'SETTLEMENT_FAILED_UPSTREAM_REPORTED',
    'SETTLEMENT_RETRY_SCHEDULED',
    'SETTLEMENT_FAILED_PENDING_TIMEOUT',
    'SETTLEMENT_FAILED_CONTRACT_MISMATCH',
    'SETTLEMENT_FAILED_RETRY_EXHAUSTED',
    'SETTLEMENT_FAILED_TERMINAL_ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tip_intent_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tip_intent_id" uuid NOT NULL REFERENCES "tip_intents"("id"),
  "invoice" text NOT NULL,
  "source" "tip_intent_event_source" NOT NULL,
  "type" "tip_intent_event_type" NOT NULL,
  "previous_invoice_state" "invoice_state",
  "next_invoice_state" "invoice_state",
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tip_intent_events_tip_intent_created_at_idx"
  ON "tip_intent_events" ("tip_intent_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "tip_intent_events_invoice_created_at_idx"
  ON "tip_intent_events" ("invoice", "created_at", "id");

CREATE INDEX IF NOT EXISTS "tip_intent_events_source_created_at_idx"
  ON "tip_intent_events" ("source", "created_at", "id");
