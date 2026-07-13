-- Remove any notification_rules rows whose channel no longer exists before
-- adding the FK, so the constraint can be applied to databases provisioned
-- from the baseline (which had no FK) and may hold orphans. The FK is
-- ON DELETE CASCADE, so deleting rules for a missing channel matches the
-- intended semantics.
DELETE FROM "notification_rules" nr
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_channels" nc WHERE nc."id" = nr."channel_id"
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
