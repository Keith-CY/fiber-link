ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "client_request_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_app_user_client_request_unique"
  ON "withdrawals" ("app_id", "user_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
