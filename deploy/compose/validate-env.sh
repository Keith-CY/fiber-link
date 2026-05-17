#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${COMPOSE_ENV_FILE:-${ROOT_DIR}/deploy/compose/.env}"

usage() {
  cat <<'EOF'
Usage: validate-env.sh [ENV_FILE]

Validates deploy/compose runtime environment before starting containers.
Set COMPOSE_ENV_FILE or pass ENV_FILE to validate a non-default env file.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  ENV_FILE="$1"
fi

fail() {
  printf 'compose env validation failed: %s\n' "$*" >&2
  exit 1
}

if [[ ! -f "${ENV_FILE}" ]]; then
  fail "missing ${ENV_FILE} (copy deploy/compose/.env.example and replace placeholders first)"
fi

get_env_value() {
  local key="$1"
  local line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "${ENV_FILE}" | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    printf ''
    return 0
  fi
  value="${line#*=}"
  value="${value%%#*}"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "${value}"
}

is_placeholder() {
  local value="${1,,}"
  [[ -z "${value}" ]] \
    || [[ "${value}" == *change-me* ]] \
    || [[ "${value}" == *changeme* ]] \
    || [[ "${value}" == *replace-with* ]] \
    || [[ "${value}" == *placeholder* ]] \
    || [[ "${value}" == *example* ]] \
    || [[ "${value}" == "todo" ]] \
    || [[ "${value}" == "secret" ]] \
    || [[ "${value}" == "password" ]]
}

require_secret() {
  local key="$1" min_len="${2:-12}" value
  value="$(get_env_value "${key}")"
  [[ -n "${value}" ]] || fail "${key} must be set"
  ! is_placeholder "${value}" || fail "${key} still uses a placeholder/default-like value"
  (( ${#value} >= min_len )) || fail "${key} must be at least ${min_len} characters"
}

require_sha256() {
  local key="$1" value
  value="$(get_env_value "${key}")"
  [[ -n "${value}" ]] || fail "${key} must be set"
  ! is_placeholder "${value}" || fail "${key} still uses a placeholder value"
  [[ "${value}" =~ ^[A-Fa-f0-9]{64}$ ]] || fail "${key} must be a 64-character hexadecimal sha256 digest"
  [[ ! "${value}" =~ ^0{64}$ ]] || fail "${key} must not be the all-zero digest"
}

validate_url() {
  local key="$1" required="${2:-required}" value
  value="$(get_env_value "${key}")"
  if [[ -z "${value}" ]]; then
    [[ "${required}" == "optional" ]] && return 0
    fail "${key} must be set"
  fi
  ! is_placeholder "${value}" || fail "${key} still uses a placeholder value"
  case "${key}" in
    FIBER_LINK_RATE_LIMIT_REDIS_URL)
      [[ "${value}" =~ ^rediss?://[^[:space:]]+$ ]] \
        || fail "${key} must be a redis:// or rediss:// URL"
      ;;
    FIBER_SETTLEMENT_SUBSCRIPTION_URL)
      [[ "${value}" =~ ^(https?|wss?)://[^[:space:]/:]+(:[0-9]{1,5})?(/[^[:space:]]*)?$ ]] \
        || fail "${key} must be an http(s) or ws(s) URL"
      ;;
    *)
      [[ "${value}" =~ ^https?://[^[:space:]/:]+(:[0-9]{1,5})?(/[^[:space:]]*)?$ ]] \
        || fail "${key} must be an http(s) URL"
      ;;
  esac
}

validate_port() {
  local key="$1" default="$2" value
  value="$(get_env_value "${key}")"
  value="${value:-${default}}"
  [[ "${value}" =~ ^[0-9]+$ ]] || fail "${key} must be numeric"
  (( value >= 1 && value <= 65535 )) || fail "${key} must be between 1 and 65535"
}

validate_int() {
  local key="$1" default="$2" min="$3" max="${4:-}" value
  value="$(get_env_value "${key}")"
  value="${value:-${default}}"
  [[ "${value}" =~ ^[0-9]+$ ]] || fail "${key} must be numeric"
  (( value >= min )) || fail "${key} must be >= ${min}"
  if [[ -n "${max}" ]]; then
    (( value <= max )) || fail "${key} must be <= ${max}"
  fi
}

require_secret POSTGRES_PASSWORD 12
require_secret FIBER_SECRET_KEY_PASSWORD 12
require_secret FIBER_LINK_HMAC_SECRET 32
require_sha256 FNN_ASSET_SHA256

validate_url FIBER_RPC_URL
validate_url FIBER_CHANNEL_ACCEPT_RPC_URL
validate_url FIBER_SETTLEMENT_SUBSCRIPTION_URL optional
validate_url FIBER_LINK_RATE_LIMIT_REDIS_URL

for key_default in \
  POSTGRES_PORT:5432 REDIS_PORT:6379 RPC_PORT:3000 \
  FNN_RPC_PORT:8227 FNN_P2P_PORT:8228 FNN2_RPC_PORT:9227 FNN2_P2P_PORT:9228; do
  validate_port "${key_default%%:*}" "${key_default##*:}"
done

for int_default_min in \
  RPC_HEALTHCHECK_TIMEOUT_MS:3000:1 \
  BACKUP_RETENTION_DAYS:30:1 \
  RPC_RATE_LIMIT_WINDOW_MS:60000:1 \
  RPC_RATE_LIMIT_MAX_REQUESTS:300:1 \
  FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST:5000:1 \
  FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX:20000:1 \
  FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX:200000:1 \
  FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS:0:0 \
  WORKER_WITHDRAWAL_INTERVAL_MS:30000:1 \
  WORKER_SETTLEMENT_INTERVAL_MS:30000:1 \
  WORKER_SETTLEMENT_BATCH_SIZE:200:1 \
  WORKER_MAX_RETRIES:3:0 \
  WORKER_RETRY_DELAY_MS:60000:0 \
  WORKER_SETTLEMENT_MAX_RETRIES:3:0 \
  WORKER_SETTLEMENT_RETRY_DELAY_MS:60000:0 \
  WORKER_SETTLEMENT_PENDING_TIMEOUT_MS:1800000:1 \
  WORKER_SHUTDOWN_TIMEOUT_MS:15000:1 \
  WORKER_READINESS_TIMEOUT_MS:5000:1 \
  WORKER_OPS_MAX_UNPAID_BACKLOG:25:0 \
  WORKER_OPS_MAX_OLDEST_UNPAID_AGE_MS:900000:0 \
  WORKER_OPS_MAX_RETRY_PENDING:3:0 \
  WORKER_OPS_MAX_RECENT_FAILED_SETTLEMENTS:0:0 \
  WORKER_OPS_RECENT_FAILURE_LOOKBACK_HOURS:24:1 \
  WORKER_OPS_MAX_WITHDRAWAL_PARITY_ISSUES:0:0 \
  WORKER_OPS_WITHDRAWAL_LOOKBACK_HOURS:24:1 \
  WORKER_OPS_WITHDRAWAL_SAMPLE_LIMIT:500:1 \
  FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE:61:0 \
  FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:61:0 \
  FIBER_CHANNEL_ROTATION_MAX_CONCURRENT:1:1; do
  IFS=: read -r key default min <<<"${int_default_min}"
  validate_int "${key}" "${default}" "${min}"
done

printf 'compose env validation passed: %s\n' "${ENV_FILE}"
