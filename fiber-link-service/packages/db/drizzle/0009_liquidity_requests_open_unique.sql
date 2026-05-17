WITH ranked_open_liquidity_requests AS (
  SELECT
    "id",
    "app_id",
    "asset",
    "network",
    "source_kind",
    "required_amount",
    ROW_NUMBER() OVER (
      PARTITION BY "app_id", "asset", "network", "source_kind"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS "rank"
  FROM "liquidity_requests"
  WHERE "state" IN ('REQUESTED', 'REBALANCING')
), open_liquidity_request_groups AS (
  SELECT
    "app_id",
    "asset",
    "network",
    "source_kind",
    MAX("required_amount") AS "required_amount"
  FROM ranked_open_liquidity_requests
  GROUP BY "app_id", "asset", "network", "source_kind"
)
UPDATE "liquidity_requests" AS keepers
SET
  "required_amount" = groups."required_amount",
  "updated_at" = now()
FROM open_liquidity_request_groups AS groups
WHERE keepers."app_id" = groups."app_id"
  AND keepers."asset" = groups."asset"
  AND keepers."network" = groups."network"
  AND keepers."source_kind" = groups."source_kind"
  AND keepers."state" IN ('REQUESTED', 'REBALANCING')
  AND keepers."id" IN (
    SELECT "id"
    FROM ranked_open_liquidity_requests
    WHERE "rank" = 1
  );

WITH ranked_open_liquidity_requests AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "app_id", "asset", "network", "source_kind"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS "rank"
  FROM "liquidity_requests"
  WHERE "state" IN ('REQUESTED', 'REBALANCING')
)
UPDATE "liquidity_requests"
SET
  "state" = 'FAILED',
  "last_error" = 'deduplicated before adding liquidity_requests_open_key_unique',
  "updated_at" = now(),
  "completed_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM ranked_open_liquidity_requests
  WHERE "rank" > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "liquidity_requests_open_key_unique"
  ON "liquidity_requests" ("app_id", "asset", "network", "source_kind")
  WHERE "state" IN ('REQUESTED', 'REBALANCING');
