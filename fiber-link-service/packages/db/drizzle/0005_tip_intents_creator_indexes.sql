CREATE INDEX IF NOT EXISTS "tip_intents_app_to_user_created_at_idx" ON "tip_intents" USING btree ("app_id","to_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_intents_app_to_user_state_settled_at_idx" ON "tip_intents" USING btree ("app_id","to_user_id","invoice_state","settled_at");
