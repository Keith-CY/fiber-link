DO $$
BEGIN
  CREATE TYPE notification_channel_kind AS ENUM ('WEBHOOK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE notification_event AS ENUM (
    'WITHDRAWAL_RETRY_PENDING',
    'WITHDRAWAL_FAILED',
    'WITHDRAWAL_COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind notification_channel_kind NOT NULL,
  target TEXT NOT NULL,
  secret TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_app_name_unique ON notification_channels(app_id, name);
CREATE INDEX IF NOT EXISTS notification_channels_app_enabled_idx ON notification_channels(app_id, enabled, id);

CREATE TABLE IF NOT EXISTS notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  channel_id UUID NOT NULL REFERENCES notification_channels(id),
  event notification_event NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_rules_channel_event_unique ON notification_rules(channel_id, event);
CREATE INDEX IF NOT EXISTS notification_rules_app_event_enabled_idx ON notification_rules(app_id, event, enabled, id);
CREATE INDEX IF NOT EXISTS notification_rules_channel_enabled_idx ON notification_rules(channel_id, enabled, id);
