# Admin Installation Guide

This guide provides an operator-ready workflow for bringing up the Fiber Link stack and
registering the Discourse plugin for basic admin verification.

## 1) Prerequisites

- Linux/macOS host with Docker + Docker Compose available.
- Git + bash.
- Discourse admin account for plugin installation.
- Access to a fresh clone of the repo:

```bash
git clone https://github.com/Keith-CY/fiber-link.git
cd fiber-link
```

## 2) Stand up RPC / worker / FNN services

From repo root:

```bash
cd deploy/compose
cp .env.example .env
```

Edit `deploy/compose/.env` (minimum required values are marked ✅, optional/tunable are ✅/⚪):

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | ✅ | Database password used by postgres container |
| `FIBER_SECRET_KEY_PASSWORD` | ✅ | Secret consumed by FNN startup path |
| `FIBER_LINK_HMAC_SECRET` | ✅ | Default shared secret for RPC request auth |
| `FNN_ASSET_SHA256` | ✅ | Asset checksum for FNN binary/fingerprint |
| `POSTGRES_DB` | ⚪ | DB name (default from compose defaults if unset) |
| `POSTGRES_USER` | ⚪ | DB user (defaults to `.env.example`) |
| `POSTGRES_PORT` | ⚪ | Host postgres port mapping |
| `REDIS_PORT` | ⚪ | Host redis port mapping |
| `RPC_PORT` | ⚪ | Service exposed RPC port for local checks |
| `FNN_RPC_PORT` | ⚪ | FNN host RPC port mapping |
| `FNN_P2P_PORT` | ⚪ | FNN host P2P port mapping |
| `FIBER_LINK_HMAC_SECRET_MAP` | ⚪ | Per-app secret overrides (JSON-style map) |
| `FIBER_RPC_URL` | ⚪ | RPC endpoint override for service-to-FNN calls (compose default: `http://fnn:8227`) |
| `RPC_HEALTHCHECK_TIMEOUT_MS` | ⚪ | RPC readiness timeout |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | ⚪ | Worker shutdown timeout |
| `WORKER_SETTLEMENT_INTERVAL_MS` | ⚪ | Polling loop interval |
| `WORKER_SETTLEMENT_BATCH_SIZE` | ⚪ | Settlement batch size |
| `WORKER_READINESS_TIMEOUT_MS` | ⚪ | Worker readiness timeout |

Start services:

```bash
docker compose up -d --build
```

Check basic health:

```bash
docker compose ps
docker compose logs -f rpc worker fnn
```

You should see each service running and RPC/worker startup logs without immediate restart loops.

Shut down cleanly:

```bash
docker compose down
```

## 3) Install and enable the Discourse plugin

The plugin directory is `fiber-link-discourse-plugin/`.

### Install path

From your Discourse app directory:

```bash
cd /path/to/discourse
ln -sfn /path/to/fiber-link/fiber-link-discourse-plugin plugins/fiber-link
```

Restart/discover your Discourse app and then configure:

- `Admin > Settings > Plugins > fiber_link_enabled` = `true`
- `fiber_link_service_url` = reachable RPC URL (example: `http://127.0.0.1:3000`)
- `fiber_link_app_id` = app id (example: `demo-app`)
- `fiber_link_app_secret` = shared secret (must match RPC expectations)

### Discourse + RPC auth pairing

`fiber_link_app_id` + `fiber_link_app_secret` must match the auth source used by RPC:

- If app exists in DB (`apps` table), RPC validates against persisted app secret.
- If not, fallback checks `FIBER_LINK_HMAC_SECRET_MAP[app_id]` when present.
- Otherwise fallback to `FIBER_LINK_HMAC_SECRET`.

## 4) Admin smoke test checklist

From repo root, run:

```bash
scripts/testnet-smoke.sh
```

Expected minimum:

- script exits with `CODE=0` and `RESULT=PASS`
- compose stack starts and tears down cleanly
- invoice/settlement proof path logs a success signal

Additional checks:

- `docker compose ps`
- `docker inspect --format '{{json .State.Health}}' fiber-link-rpc`
- plugin smoke checks (optional, if you have Discourse dev env):
  - `scripts/plugin-smoke.sh`

## 5) Quick rollback

If setup breaks or secrets are suspected leaked:

```bash
cd deploy/compose
docker compose down --remove-orphans --volumes
```

Then:

- Revoke/reset `FIBER_LINK_HMAC_SECRET`, `FIBER_SECRET_KEY_PASSWORD`.
- Remove plugin from Discourse:
  - disable plugin setting
  - remove `plugins/fiber-link` symlink if used for testing
- Re-run `.env` creation with a clean minimal configuration and repeat startup steps.

## 6) Verification record

- `Last validated`: 2026-02-17
- `Owner`: 261895902 (`Linn-San`)
- `Status`: Draft runbook for operator onboarding (verification-focused)
