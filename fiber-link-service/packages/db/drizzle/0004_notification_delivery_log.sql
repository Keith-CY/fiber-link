DO $$ BEGIN
 CREATE TYPE "public"."notification_delivery_status" AS ENUM('DELIVERED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" "notification_event" NOT NULL,
	"payload_hash" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_delivery_log" ADD CONSTRAINT "notification_delivery_log_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_log_channel_created_at_idx" ON "notification_delivery_log" USING btree ("channel_id","created_at","id");