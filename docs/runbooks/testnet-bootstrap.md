# Deterministic Testnet Bootstrap Runbook

Issue: #52 (`W2.3: Publish deterministic testnet bootstrap runbook`)

This runbook provides a deterministic bootstrap flow for local/staging testnet bring-up:

1. precheck
2. spin-up
3. validate RPC
4. create invoice smoke
5. shutdown + cleanup

## Prerequisites

- Docker Engine + Docker Compose v2
- `curl`, `openssl`, `awk`
- Outbound network access to:
  - GitHub release assets (for `fnn` image build)
  - CKB testnet endpoint used by FNN

## Deterministic checkpoints

The run is successful only when checkpoints are observed in this order:

1. `CHECKPOINT 1`: precheck passed
2. `CHECKPOINT 2`: core containers are healthy/running
3. `CHECKPOINT 3`: signed `health.ping` returns `status=ok`
4. `CHECKPOINT 4`: signed `tip.create` returns a non-empty `invoice`
5. `CHECKPOINT 5`: logs archived and stack shut down cleanly

## Command sequence

Run from repository root:

```bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
COMPOSE_DIR="${ROOT_DIR}/deploy/compose"
ARTIFACT_DIR="${ROOT_DIR}/.tmp/testnet-bootstrap-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${ARTIFACT_DIR}"

cd "${COMPOSE_DIR}"
cp -n .env.example .env

# Fill secrets once before the first run.
required_keys=(
  POSTGRES_PASSWORD
  FIBER_SECRET_KEY_PASSWORD
  FIBER_LINK_HMAC_SECRET
  FNN_ASSET_SHA256
)

for key in "${required_keys[@]}"; do
  if ! grep -q "^${key}=" .env; then
    echo "missing ${key} entry in .env" >&2
    exit 1
  fi
  value="$(grep "^${key}=" .env | tail -n1 | cut -d= -f2-)"
  if [ -z "${value}" ]; then
    echo "${key} must be non-empty in .env" >&2
    exit 1
  fi
done

echo "CHECKPOINT 1: precheck passed"

# Clean rollback point before deterministic bring-up.
docker compose down -v --remove-orphans || true

docker compose up -d --build

# Wait up to 10 minutes for required service states.
deadline=$(( $(date +%s) + 600 ))
is_healthy() { [ "$(docker inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null || true)" = "healthy" ]; }
is_running() { [ "$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]; }

until is_healthy fiber-link-postgres && is_healthy fiber-link-redis && is_running fiber-link-rpc && is_running fiber-link-worker && is_running fiber-link-fnn; do
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    echo "timeout waiting for compose services" >&2
    docker compose ps >&2 || true
    docker compose logs --no-color --tail=200 >&2 || true
    exit 1
  fi
  sleep 5
done

echo "CHECKPOINT 2: core containers are healthy/running"

set -a
source .env
set +a

sign_payload() {
  local payload="$1"
  local ts="$2"
  local nonce="$3"
  printf '%s' "${ts}.${nonce}.${payload}" \
    | openssl dgst -sha256 -hmac "${FIBER_LINK_HMAC_SECRET}" -hex \
    | awk '{print $2}'
}

rpc_call_signed() {
  local payload="$1"
  local nonce="$2"
  local ts sig
  ts="$(date +%s)"
  sig="$(sign_payload "${payload}" "${ts}" "${nonce}")"
  curl -fsS "http://127.0.0.1:${RPC_PORT:-3000}/rpc" \
    -H "content-type: application/json" \
    -H "x-app-id: local-dev" \
    -H "x-ts: ${ts}" \
    -H "x-nonce: ${nonce}" \
    -H "x-signature: ${sig}" \
    -d "${payload}"
}

health_payload='{"jsonrpc":"2.0","id":"health-bootstrap","method":"health.ping","params":{}}'
health_resp="$(rpc_call_signed "${health_payload}" "bootstrap-health-$(date +%s)")"
printf '%s\n' "${health_resp}" > "${ARTIFACT_DIR}/health.json"
echo "${health_resp}" | grep -q '"status":"ok"'

echo "CHECKPOINT 3: signed health.ping returned status=ok"

tip_payload='{"jsonrpc":"2.0","id":"tip-bootstrap","method":"tip.create","params":{"postId":"bootstrap-post-1","fromUserId":"bootstrap-user-1","toUserId":"bootstrap-user-2","asset":"CKB","amount":"1"}}'

# FNN invoice path can be slower right after boot. Retry for up to 2 minutes.
tip_deadline=$(( $(date +%s) + 120 ))
tip_resp=""
until [ "$(date +%s)" -ge "${tip_deadline}" ]; do
  set +e
  tip_resp="$(rpc_call_signed "${tip_payload}" "bootstrap-tip-$(date +%s)")"
  status=$?
  set -e
  if [ "${status}" -eq 0 ] && printf '%s' "${tip_resp}" | grep -q '"invoice"'; then
    break
  fi
  sleep 5
done

printf '%s\n' "${tip_resp}" > "${ARTIFACT_DIR}/tip-create.json"
printf '%s' "${tip_resp}" | grep -q '"invoice"'

echo "CHECKPOINT 4: signed tip.create returned invoice"

docker compose logs --no-color > "${ARTIFACT_DIR}/compose.log" || true
docker compose down --remove-orphans

echo "CHECKPOINT 5: logs archived + stack shut down (${ARTIFACT_DIR})"
```

## Rollback/shutdown cleanup

If any checkpoint fails:

```bash
cd deploy/compose
docker compose ps
docker compose logs --no-color --tail=300
docker compose down -v --remove-orphans
```

This returns the stack to a clean baseline for the next deterministic re-run.

## Troubleshooting branches

### 1) `fnn` build fails with checksum mismatch

- Symptom: Docker build fails in `sha256sum --check`.
- Fix:
  1. Verify `FNN_VERSION` and `FNN_ASSET` in `deploy/compose/.env`.
  2. Re-copy official SHA256 to `FNN_ASSET_SHA256`.
  3. Re-run from `docker compose down -v --remove-orphans`.

### 2) signed `health.ping` returns unauthorized

- Symptom: JSON-RPC error `Unauthorized`.
- Fix:
  1. Ensure `.env` has non-empty `FIBER_LINK_HMAC_SECRET`.
  2. Ensure signature input is exactly `ts.nonce.payload` (no extra whitespace/newlines).
  3. Use a fresh nonce and current timestamp.

### 3) `tip.create` does not return invoice within 120s

- Symptom: no invoice result in retry window.
- Fix:
  1. Check `fiber-link-fnn` logs for startup or network errors.
  2. Confirm `FIBER_RPC_URL` is `http://fnn:8227` in compose env.
  3. Check `fiber-link-rpc` logs for adapter/internal errors.
  4. Reset stack (`down -v`) and retry.

### 4) ports already in use

- Symptom: compose fails to bind `5432`, `6379`, `3000`, `8227`, or `8228`.
- Fix: change port values in `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `RPC_PORT`, `FNN_RPC_PORT`, `FNN_P2P_PORT`) and rerun.
