# Admin Installation Guide

This guide provides the minimum operator path to stand up a runnable Fiber Link stack and
enable the Discourse plugin for admin testing.

## 1. Bring up RPC / worker / FNN services

From the repo root:

```bash
cd deploy/compose
cp .env.example .env
```

Edit `deploy/compose/.env` and set at least:

- `POSTGRES_PASSWORD` — database password (non-empty).
- `FIBER_SECRET_KEY_PASSWORD` — secret used by FNN container startup path.
- `FIBER_LINK_HMAC_SECRET` — shared HMAC secret for app auth fallback.
- `FNN_ASSET_SHA256` — checksum for `FNN_ASSET`.

Important: keep `.env` out of git. This file is ignored by default.

Optional values you may also set:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PORT`, `REDIS_PORT`
- `RPC_PORT`, `FNN_RPC_PORT`, `FNN_P2P_PORT`
- `FIBER_LINK_HMAC_SECRET_MAP`
- `FIBER_RPC_URL` (defaults to `http://fnn:8227`)
- `RPC_HEALTHCHECK_TIMEOUT_MS`
- `WORKER_*` tuning knobs (`WORKER_SETTLEMENT_INTERVAL_MS`, `WORKER_SETTLEMENT_BATCH_SIZE`, etc.)

Start services:

```bash
docker compose up -d --build
```

Check health:

```bash
docker compose ps
docker compose logs -f rpc worker fnn
```

Stop when finished:

```bash
docker compose down
```

## 2. Install and enable the Discourse plugin

Place the plugin folder under your Discourse `plugins/` directory and mount it into the site runtime.
The plugin code directory is `fiber-link-discourse-plugin` in this repository.

Recommended local/dev flow:

```bash
cd /path/to/discourse
ln -sfn /path/to/fiber-link/fiber-link-discourse-plugin plugins/fiber-link
```

Then restart or boot your Discourse app and enable settings:

- `Admin > Settings > Plugins > fiber_link_enabled` = `true`
- `fiber_link_service_url` = `http://127.0.0.1:3000` (or your reachable RPC host)
- `fiber_link_app_id` = chosen app id (example: `demo-app`)
- `fiber_link_app_secret` = shared secret value sent to RPC

### Discourse + RPC auth pairing

`fiber_link_app_id` and `fiber_link_app_secret` must match values accepted by RPC:

- If app records exist in DB (`apps` table), RPC will read secret from DB for that app id.
- If no app record exists, RPC falls back to:
  - `FIBER_LINK_HMAC_SECRET_MAP["<app_id>"]` when set, else
  - `FIBER_LINK_HMAC_SECRET`.

## 3. Smoke check and verification

From repository root, run:

```bash
scripts/testnet-smoke.sh
```

Expected output (minimum):

```
RESULT=PASS CODE=0 ARTIFACT_DIR=<path>
```

At least one of the following should also be true:

- Script prints invoice creation success line and exits code `0`.
- `compose` stack can be cleanly torn down with `docker compose down`.

Optional quick pre-flight checks:

```bash
cd deploy/compose
docker compose ps
docker inspect --format '{{json .State.Health}}' fiber-link-rpc | jq .
```

## 4. Required/Optional secrets and env vars (quick map)

Service layer (`deploy/compose/.env`):

- Required: `POSTGRES_PASSWORD`, `FIBER_SECRET_KEY_PASSWORD`, `FIBER_LINK_HMAC_SECRET`, `FNN_ASSET_SHA256`.
- Recommended: `FIBER_LINK_HMAC_SECRET_MAP`, `RPC_HEALTHCHECK_TIMEOUT_MS`,
  `WORKER_SHUTDOWN_TIMEOUT_MS`, `WORKER_SETTLEMENT_INTERVAL_MS`.

Discourse settings:

- Required: `fiber_link_service_url`, `fiber_link_app_id`, `fiber_link_app_secret`, `fiber_link_enabled`.
- Optional: app-specific host/port/security adjustments in your Discourse environment.

## 5. Initial verification record

- `Last validated`: 2026-02-16
- `Owner`: To be filled by operator
