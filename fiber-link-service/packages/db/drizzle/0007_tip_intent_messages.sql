ALTER TABLE "tip_intents"
  ADD COLUMN IF NOT EXISTS "message" text;

CREATE INDEX IF NOT EXISTS "tip_intents_app_settled_at_idx"
  ON "tip_intents" ("app_id", "settled_at", "id");
