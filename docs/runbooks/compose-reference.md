# Fiber Link + FNN Docker Compose Reference

## Scope
This reference deployment starts:
- `postgres` (schema bootstrap via SQL init script)
- `redis` (nonce replay cache for RPC)
- `fnn` (Hub Fiber Node from official release binary)
- `rpc` (`/rpc` JSON-RPC service)
- `worker` (withdrawal batch loop)

It is intended for local/staging bring-up, not production hardening.

For a strict deterministic execution sequence (precheck -> spin-up -> signed RPC checks -> cleanup), use:
- `docs/runbooks/testnet-bootstrap.md`

## Prerequisites
- Docker and Docker Compose v2
- Outbound network access to:
  - GitHub release download (for FNN image build)
  - CKB testnet RPC endpoint (`https://testnet.ckbapp.dev/`)
- Required external dependency behavior:
  - the FNN release asset (`${FNN_ASSET}`) must remain available for the pinned `${FNN_VERSION}`
  - the CKB RPC endpoint configured in `deploy/compose/fnn/config/testnet.yml` must be reachable from container network

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

## Config and Override Semantics
- Internal ports are fixed by service config:
  - FNN listens on `8227` (RPC) and `8228` (P2P) in `deploy/compose/fnn/config/testnet.yml`.
  - RPC service listens on `3000` in container.
- `.env` port overrides (`FNN_RPC_PORT`, `FNN_P2P_PORT`, `RPC_PORT`) control host-published ports only.
- `FIBER_RPC_URL` is the compose-network endpoint used by `rpc` and `worker`; default is `http://fnn:8227`.
- Compose startup order is `postgres/redis/fnn` -> `rpc` -> `worker` (current dependency wiring in `docker-compose.yml`).

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

## One-command deterministic smoke check

From repo root:

```bash
scripts/testnet-smoke.sh
```

Optional flags:

- `--dry-run` (precheck only, no container changes)
- `--skip-smoke` (skip `tip.create`, keep signed health check)
- `--verbose` (more logs during execution)

The script prints machine-readable status lines:

- success: `RESULT=PASS CODE=0 ...`
- failure: `RESULT=FAIL CODE=<non-zero> ...`

## One-command deployment evidence bundle

From repo root:

```bash
scripts/capture-deployment-evidence.sh \
  --invoice-id <invoice_id> \
  --settlement-id <settlement_id_or_tx_hash>
```

This captures compose logs, node metadata, invoice/settlement IDs, status snapshots, and acceptance mapping.
See detailed policy/checklist in:
- `docs/runbooks/deployment-evidence.md`

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
