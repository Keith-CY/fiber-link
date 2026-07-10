CREATE TABLE IF NOT EXISTS "withdrawal_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_id" text NOT NULL,
  "allowed_assets" jsonb NOT NULL,
  "max_per_request" numeric NOT NULL,
  "per_user_daily_max" numeric NOT NULL,
  "per_app_daily_max" numeric NOT NULL,
  "cooldown_seconds" integer NOT NULL DEFAULT 0,
  "updated_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_policies_app_id_unique"
  ON "withdrawal_policies" ("app_id");
