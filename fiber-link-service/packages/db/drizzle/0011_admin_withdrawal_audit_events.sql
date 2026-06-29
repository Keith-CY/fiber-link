CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  actor_role user_role NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id text NOT NULL,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_target_created_at_idx
  ON admin_audit_events (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_created_at_idx
  ON admin_audit_events (actor_id, created_at DESC);
