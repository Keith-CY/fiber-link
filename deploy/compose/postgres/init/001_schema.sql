CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'COMMUNITY_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE ledger_entry_type AS ENUM ('credit', 'debit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE withdrawal_state AS ENUM ('PENDING', 'PROCESSING', 'RETRY_PENDING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL UNIQUE,
  hmac_secret TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tip_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  invoice TEXT NOT NULL UNIQUE,
  invoice_state TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  type ledger_entry_type NOT NULL,
  ref_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  to_address TEXT NOT NULL,
  state withdrawal_state NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  tx_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_tip_intents_invoice_state ON tip_intents(invoice_state);
CREATE INDEX IF NOT EXISTS idx_withdrawals_state ON withdrawals(state);
