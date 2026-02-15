#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_STARTUP_TIMEOUT=11
EXIT_HEALTH_CHECK=12
EXIT_SMOKE_CHECK=13
EXIT_CLEANUP=14

DRY_RUN=0
SKIP_SMOKE=0
VERBOSE=0
STARTED_COMPOSE=0

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/deploy/compose"
ENV_FILE="${COMPOSE_DIR}/.env"
ARTIFACT_DIR="${ROOT_DIR}/.tmp/testnet-smoke/$(date +%Y%m%d-%H%M%S)"

usage() {
  cat <<'EOF'
Usage: scripts/testnet-smoke.sh [--dry-run] [--skip-smoke] [--verbose]

Options:
  --dry-run     Print planned actions and validate prerequisites without starting containers.
  --skip-smoke  Skip tip.create invoice smoke (health check still runs).
  --verbose     Print additional progress logs.
  -h, --help    Show this help message.

Exit codes:
  0   PASS
  2   invalid usage
  10  precheck failure
  11  startup timeout
  12  signed health check failure
  13  invoice smoke failure
  14  cleanup failure
EOF
}

log() {
  printf '[testnet-smoke] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

compose() {
  (cd "${COMPOSE_DIR}" && docker compose "$@")
}

get_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    printf ''
    return
  fi
  printf '%s' "${line#*=}"
}

cleanup_stack() {
  if [[ "${STARTED_COMPOSE}" -ne 1 ]]; then
    return 0
  fi

  mkdir -p "${ARTIFACT_DIR}"
  compose logs --no-color > "${ARTIFACT_DIR}/compose.log" || true
  compose down --remove-orphans > "${ARTIFACT_DIR}/compose-down.log" 2>&1
}

exit_with() {
  local code="$1"
  local message="$2"
  local final_code="${code}"

  if ! cleanup_stack; then
    if [[ "${final_code}" -eq 0 ]]; then
      final_code="${EXIT_CLEANUP}"
      message="cleanup failed"
    else
      message="${message}; cleanup failed"
    fi
  fi

  if [[ "${final_code}" -eq 0 ]]; then
    printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s\n' "${ARTIFACT_DIR}"
  else
    printf 'RESULT=FAIL CODE=%s MESSAGE=%s ARTIFACT_DIR=%s\n' "${final_code}" "${message}" "${ARTIFACT_DIR}"
  fi
  exit "${final_code}"
}

trap 'exit_with 130 "interrupted"' INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-smoke)
      SKIP_SMOKE=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit_with "${EXIT_USAGE}" "unknown option: $1"
      ;;
  esac
  shift
done

mkdir -p "${ARTIFACT_DIR}"

for binary in docker curl openssl awk grep; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    exit_with "${EXIT_PRECHECK}" "missing required binary: ${binary}"
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  exit_with "${EXIT_PRECHECK}" "docker compose v2 is required"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  exit_with "${EXIT_PRECHECK}" "missing ${ENV_FILE} (copy deploy/compose/.env.example first)"
fi

required_keys=(
  POSTGRES_PASSWORD
  FIBER_SECRET_KEY_PASSWORD
  FIBER_LINK_HMAC_SECRET
  FNN_ASSET_SHA256
)

for key in "${required_keys[@]}"; do
  value="$(get_env_value "${key}")"
  if [[ -z "${value}" ]]; then
    exit_with "${EXIT_PRECHECK}" "${key} must be set in ${ENV_FILE}"
  fi
done

RPC_PORT_VALUE="$(get_env_value RPC_PORT)"
RPC_PORT="${RPC_PORT_VALUE:-3000}"
HMAC_SECRET="$(get_env_value FIBER_LINK_HMAC_SECRET)"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  log "dry-run mode enabled"
  log "would run: docker compose down -v --remove-orphans"
  log "would run: docker compose up -d --build"
  log "would wait for postgres/redis health and rpc/worker/fnn running"
  log "would run signed health.ping against http://127.0.0.1:${RPC_PORT}/rpc"
  if [[ "${SKIP_SMOKE}" -eq 0 ]]; then
    log "would run signed tip.create smoke request"
  else
    log "tip.create smoke skipped via --skip-smoke"
  fi
  exit_with "${EXIT_OK}" "dry-run complete"
fi

vlog "reset compose stack to deterministic baseline"
compose down -v --remove-orphans || true

vlog "starting compose stack"
compose up -d --build > "${ARTIFACT_DIR}/compose-up.log" 2>&1
STARTED_COMPOSE=1

is_healthy() {
  local container="$1"
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "${container}" 2>/dev/null || true)" == "healthy" ]]
}

is_running() {
  local container="$1"
  [[ "$(docker inspect --format '{{.State.Running}}' "${container}" 2>/dev/null || true)" == "true" ]]
}

deadline=$(( $(date +%s) + 600 ))
until is_healthy fiber-link-postgres && is_healthy fiber-link-redis && is_running fiber-link-rpc && is_running fiber-link-worker && is_running fiber-link-fnn; do
  if [[ "$(date +%s)" -ge "${deadline}" ]]; then
    compose ps > "${ARTIFACT_DIR}/compose-ps-timeout.log" 2>&1 || true
    exit_with "${EXIT_STARTUP_TIMEOUT}" "timeout waiting for compose services"
  fi
  sleep 5
done
vlog "compose services are ready"

sign_payload() {
  local payload="$1"
  local ts="$2"
  local nonce="$3"
  printf '%s' "${ts}.${nonce}.${payload}" \
    | openssl dgst -sha256 -hmac "${HMAC_SECRET}" -hex \
    | awk '{print $2}'
}

rpc_call_signed() {
  local payload="$1"
  local nonce="$2"
  local ts sig
  ts="$(date +%s)"
  sig="$(sign_payload "${payload}" "${ts}" "${nonce}")"
  curl -fsS "http://127.0.0.1:${RPC_PORT}/rpc" \
    -H "content-type: application/json" \
    -H "x-app-id: local-dev" \
    -H "x-ts: ${ts}" \
    -H "x-nonce: ${nonce}" \
    -H "x-signature: ${sig}" \
    -d "${payload}"
}

health_payload='{"jsonrpc":"2.0","id":"health-smoke","method":"health.ping","params":{}}'
set +e
health_resp="$(rpc_call_signed "${health_payload}" "smoke-health-$(date +%s)")"
health_status=$?
set -e
printf '%s\n' "${health_resp}" > "${ARTIFACT_DIR}/health-response.json"
if [[ "${health_status}" -ne 0 ]] || ! printf '%s' "${health_resp}" | grep -q '"status":"ok"'; then
  exit_with "${EXIT_HEALTH_CHECK}" "signed health.ping failed"
fi
vlog "signed health.ping passed"

if [[ "${SKIP_SMOKE}" -eq 0 ]]; then
  tip_payload='{"jsonrpc":"2.0","id":"tip-smoke","method":"tip.create","params":{"postId":"smoke-post-1","fromUserId":"smoke-user-1","toUserId":"smoke-user-2","asset":"CKB","amount":"1"}}'
  tip_deadline=$(( $(date +%s) + 120 ))
  tip_ok=0
  tip_resp=""
  tip_nonce_counter=0
  while [[ "$(date +%s)" -lt "${tip_deadline}" ]]; do
    tip_nonce_counter=$((tip_nonce_counter + 1))
    set +e
    tip_resp="$(rpc_call_signed "${tip_payload}" "smoke-tip-$(date +%s)-${tip_nonce_counter}")"
    tip_status=$?
    set -e
    if [[ "${tip_status}" -eq 0 ]] && printf '%s' "${tip_resp}" | grep -q '"invoice":'; then
      tip_ok=1
      break
    fi
    sleep 5
  done
  printf '%s\n' "${tip_resp}" > "${ARTIFACT_DIR}/tip-response.json"
  if [[ "${tip_ok}" -ne 1 ]]; then
    exit_with "${EXIT_SMOKE_CHECK}" "signed tip.create did not return invoice within timeout"
  fi
  vlog "signed tip.create smoke passed"
else
  vlog "tip.create smoke skipped"
fi

exit_with "${EXIT_OK}" "ok"
