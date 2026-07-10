DO $$ BEGIN
 CREATE TYPE "public"."asset" AS ENUM('CKB', 'USDI');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."invoice_state" AS ENUM('UNPAID', 'SETTLED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ledger_entry_type" AS ENUM('credit', 'debit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."liquidity_request_source_kind" AS ENUM('FIBER_TO_CKB_CHAIN');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."liquidity_request_state" AS ENUM('REQUESTED', 'REBALANCING', 'FUNDED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_channel_kind" AS ENUM('WEBHOOK');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_event" AS ENUM('WITHDRAWAL_RETRY_PENDING', 'WITHDRAWAL_FAILED', 'WITHDRAWAL_COMPLETED', 'TIP_SETTLED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tip_intent_event_source" AS ENUM('TIP_CREATE', 'TIP_STATUS', 'SETTLEMENT_DISCOVERY');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tip_intent_event_type" AS ENUM('TIP_CREATED', 'TIP_STATUS_UNPAID_OBSERVED', 'TIP_STATUS_SETTLED', 'TIP_STATUS_FAILED', 'SETTLEMENT_NO_CHANGE', 'SETTLEMENT_SETTLED_CREDIT_APPLIED', 'SETTLEMENT_SETTLED_DUPLICATE', 'SETTLEMENT_FAILED_UPSTREAM_REPORTED', 'SETTLEMENT_RETRY_SCHEDULED', 'SETTLEMENT_FAILED_PENDING_TIMEOUT', 'SETTLEMENT_FAILED_CONTRACT_MISMATCH', 'SETTLEMENT_FAILED_RETRY_EXHAUSTED', 'SETTLEMENT_FAILED_TERMINAL_ERROR');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'COMMUNITY_ADMIN');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."withdrawal_destination_kind" AS ENUM('CKB_ADDRESS', 'PAYMENT_REQUEST');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."withdrawal_state" AS ENUM('LIQUIDITY_PENDING', 'PENDING', 'PROCESSING', 'BROADCASTED', 'RETRY_PENDING', 'COMPLETED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" "user_role" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"admin_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"hmac_secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset" "asset" NOT NULL,
	"amount" numeric NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"ref_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liquidity_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "notification_channel_kind" NOT NULL,
	"target" text NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" "notification_event" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tip_intent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tip_intent_id" uuid NOT NULL,
	"invoice" text NOT NULL,
	"source" "tip_intent_event_source" NOT NULL,
	"type" "tip_intent_event_type" NOT NULL,
	"previous_invoice_state" "invoice_state",
	"next_invoice_state" "invoice_state",
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tip_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"post_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"asset" "asset" NOT NULL,
	"amount" numeric NOT NULL,
	"invoice" text NOT NULL,
	"message" text,
	"invoice_state" "invoice_state" NOT NULL,
	"settlement_retry_count" integer DEFAULT 0 NOT NULL,
	"settlement_next_retry_at" timestamp,
	"settlement_last_error" text,
	"settlement_failure_reason" text,
	"settlement_last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawal_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"allowed_assets" jsonb NOT NULL,
	"max_per_request" numeric NOT NULL,
	"per_user_daily_max" numeric NOT NULL,
	"per_app_daily_max" numeric NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset" "asset" NOT NULL,
	"amount" numeric NOT NULL,
	"destination_kind" "withdrawal_destination_kind" DEFAULT 'PAYMENT_REQUEST' NOT NULL,
	"to_address" text NOT NULL,
	"state" "withdrawal_state" NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"tx_hash" text,
	"client_request_id" text,
	"liquidity_request_id" uuid,
	"liquidity_pending_reason" text,
	"liquidity_checked_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tip_intent_events" ADD CONSTRAINT "tip_intent_events_tip_intent_id_tip_intents_id_fk" FOREIGN KEY ("tip_intent_id") REFERENCES "public"."tip_intents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_liquidity_request_id_liquidity_requests_id_fk" FOREIGN KEY ("liquidity_request_id") REFERENCES "public"."liquidity_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_events_target_created_at_idx" ON "admin_audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_events_actor_created_at_idx" ON "admin_audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_unique" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apps_app_id_unique" ON "apps" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entries_idempotency_key_unique" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_account_asset_created_at_idx" ON "ledger_entries" USING btree ("app_id","user_id","asset","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_ref_id_idx" ON "ledger_entries" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liquidity_requests_state_created_at_idx" ON "liquidity_requests" USING btree ("state","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liquidity_requests_app_asset_state_idx" ON "liquidity_requests" USING btree ("app_id","asset","state","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "liquidity_requests_open_key_unique" ON "liquidity_requests" USING btree ("app_id","asset","network","source_kind") WHERE "liquidity_requests"."state" IN ('REQUESTED', 'REBALANCING');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_channels_app_name_unique" ON "notification_channels" USING btree ("app_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_app_enabled_idx" ON "notification_channels" USING btree ("app_id","enabled","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_rules_channel_event_unique" ON "notification_rules" USING btree ("channel_id","event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_rules_app_event_enabled_idx" ON "notification_rules" USING btree ("app_id","event","enabled","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_rules_channel_enabled_idx" ON "notification_rules" USING btree ("channel_id","enabled","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intent_events_tip_intent_created_at_idx" ON "tip_intent_events" USING btree ("tip_intent_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intent_events_invoice_created_at_idx" ON "tip_intent_events" USING btree ("invoice","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intent_events_source_created_at_idx" ON "tip_intent_events" USING btree ("source","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tip_intents_invoice_unique" ON "tip_intents" USING btree ("invoice");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intents_state_created_at_idx" ON "tip_intents" USING btree ("invoice_state","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intents_app_state_created_at_idx" ON "tip_intents" USING btree ("app_id","invoice_state","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intents_app_settled_at_idx" ON "tip_intents" USING btree ("app_id","settled_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_policies_app_id_unique" ON "withdrawal_policies" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_app_user_client_request_unique" ON "withdrawals" USING btree ("app_id","user_id","client_request_id") WHERE "withdrawals"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_state_next_retry_at_idx" ON "withdrawals" USING btree ("state","next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_account_asset_state_idx" ON "withdrawals" USING btree ("app_id","user_id","asset","state");DO $$
BEGIN
  -- drizzle-kit 0.23 does not emit check constraints from src/schema.ts, so this
  -- one is maintained by hand; keep it in sync with withdrawals.liquidityPendingFieldsCheck.
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
