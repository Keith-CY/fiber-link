# Fiber Link + FNN Docker Compose Reference

## Scope
This reference deployment starts:
- `postgres` (schema bootstrap via SQL init script)
- `redis` (nonce replay cache for RPC)
- `fnn` (Hub Fiber Node from official release binary)
- `rpc` (`/rpc` JSON-RPC service)
- `worker` (withdrawal batch loop)

It is intended for local/staging bring-up, not production hardening.

## Prerequisites
- Docker and Docker Compose v2
- Outbound network access to:
  - GitHub release download (for FNN image build)
  - CKB testnet RPC endpoint (`https://testnet.ckbapp.dev/`)

## Quick Start
From repo root:

```bash
cd deploy/compose
cp .env.example .env
```

`deploy/compose/.env` is gitignored in this repository; keep secrets only in that local file (or your secret manager in non-local environments).

Edit `.env` minimally:
- Set `POSTGRES_PASSWORD` to a strong value.
- Set `FIBER_SECRET_KEY_PASSWORD` to a strong value.
- Set `FIBER_LINK_HMAC_SECRET` to a strong value.
- Set `FNN_ASSET_SHA256` to the SHA256 digest for `${FNN_ASSET}` from the corresponding Fiber release page.
- Optional: tune `WORKER_SHUTDOWN_TIMEOUT_MS` (graceful drain timeout for in-flight withdrawal batch).
- Optional: tune settlement polling knobs:
  - `WORKER_SETTLEMENT_INTERVAL_MS`
  - `WORKER_SETTLEMENT_BATCH_SIZE`

Start:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f rpc worker fnn
```

Stop:

```bash
docker compose down
```

## RPC Smoke Check
From host:

```bash
curl -sS http://127.0.0.1:3000/rpc \
  -H 'content-type: application/json' \
  -H 'x-app-id: local-dev' \
  -H "x-ts: $(date +%s)" \
  -H 'x-nonce: local-dev-nonce-1' \
  -H 'x-signature: invalid' \
  -d '{"jsonrpc":"2.0","id":1,"method":"health.ping"}'
```

Expected: JSON-RPC unauthorized error (this confirms endpoint is up and signature gate is active).

## FNN Data and Config
- FNN persistent data volume: `fnn-data`
- On first start, entrypoint behavior:
  - Creates `/data/ckb/key` if missing (random dev key)
  - Copies bundled config template to `/data/config.yml` if missing
  - Starts FNN with:
    - `./fnn -c /data/config.yml -d /data`

You can customize by editing `deploy/compose/fnn/config/testnet.yml` before build, or by updating `/data/config.yml` inside the volume.

## Current Limitations
- Settlement detection currently uses polling + replay, not event subscription.
- Admin panel server is not included in this compose reference.
- This setup does not include production controls (TLS, secrets manager, backup, network isolation, observability stack).
- `worker` depends on `rpc` with `service_started`; no explicit RPC readiness probe is wired yet.

## Productionization Checklist (Next)
- Replace default generated dev wallet key flow with managed key import workflow.
- Add migration pipeline (`drizzle-kit`) instead of SQL bootstrap for schema evolution.
- Add service health endpoints and compose health checks for `rpc`/`worker`/`fnn`.
- Pin base images by digest (`postgres`, `redis`, `oven/bun`, `debian`) for deterministic rebuilds.
- Move `worker` dependency to RPC readiness (`service_healthy`) plus startup/backoff runbook notes.
