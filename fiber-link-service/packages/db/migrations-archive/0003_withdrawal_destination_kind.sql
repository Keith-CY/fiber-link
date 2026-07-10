DO $$
BEGIN
  CREATE TYPE "withdrawal_destination_kind" AS ENUM ('CKB_ADDRESS', 'PAYMENT_REQUEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "destination_kind" "withdrawal_destination_kind";

UPDATE "withdrawals"
SET "destination_kind" = CASE
  WHEN lower("to_address") LIKE 'ckt1%' OR lower("to_address") LIKE 'ckb1%' THEN 'CKB_ADDRESS'::withdrawal_destination_kind
  ELSE 'PAYMENT_REQUEST'::withdrawal_destination_kind
END
WHERE "destination_kind" IS NULL;

ALTER TABLE "withdrawals"
  ALTER COLUMN "destination_kind" SET DEFAULT 'PAYMENT_REQUEST'::withdrawal_destination_kind;

ALTER TABLE "withdrawals"
  ALTER COLUMN "destination_kind" SET NOT NULL;
