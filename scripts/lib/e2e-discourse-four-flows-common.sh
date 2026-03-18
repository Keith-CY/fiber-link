#!/usr/bin/env bash

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_FLOW12=11
EXIT_PHASE2=12
EXIT_POSTCHECK=13
EXIT_WITHDRAWAL=14
EXIT_EXPLORER=15
EXIT_POLLING=16
EXIT_ARTIFACT=17

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
COMPOSE_ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
DEFAULT_RUN_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEFAULT_RUN_DIR="${ROOT_DIR}/.tmp/e2e-discourse-four-flows/${DEFAULT_RUN_TIMESTAMP}"
DEFAULT_DISCOURSE_UI_BASE_URL="${E2E_DISCOURSE_UI_BASE_URL:-http://127.0.0.1:9292}"
DEFAULT_SETTLEMENT_MODES="${E2E_SETTLEMENT_MODES:-subscription}"
DEFAULT_WORKFLOW_RPC_PORT="${E2E_WORKFLOW_RPC_PORT:-13001}"
DEFAULT_WORKFLOW_WITHDRAW_AMOUNT_CKB="${WORKFLOW_WITHDRAW_AMOUNT:-61}"
DEFAULT_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_CKB="${E2E_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_DEFAULT:-${DEFAULT_WORKFLOW_WITHDRAW_AMOUNT_CKB}}"
DEFAULT_WITHDRAWAL_LIQUIDITY_FEE_BUFFER_CKB="${E2E_WITHDRAWAL_LIQUIDITY_FEE_BUFFER_DEFAULT:-1}"
DEFAULT_WITHDRAWAL_LIQUIDITY_POST_TX_RESERVE_CKB="${E2E_WITHDRAWAL_LIQUIDITY_POST_TX_RESERVE_DEFAULT:-0}"
DEFAULT_WITHDRAWAL_LIQUIDITY_WARM_BUFFER_CKB="${E2E_WITHDRAWAL_LIQUIDITY_WARM_BUFFER_DEFAULT:-${DEFAULT_WORKFLOW_WITHDRAW_AMOUNT_CKB}}"
DEFAULT_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_CKB="${E2E_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_DEFAULT:-$(( DEFAULT_WORKFLOW_WITHDRAW_AMOUNT_CKB + DEFAULT_WITHDRAWAL_LIQUIDITY_FEE_BUFFER_CKB + DEFAULT_WITHDRAWAL_LIQUIDITY_POST_TX_RESERVE_CKB + DEFAULT_WITHDRAWAL_LIQUIDITY_WARM_BUFFER_CKB ))}"
CKB_FAUCET_API_BASE="${CKB_FAUCET_API_BASE:-https://faucet-api.nervos.org}"
CKB_FAUCET_FALLBACK_API_BASE="${CKB_FAUCET_FALLBACK_API_BASE:-https://ckb-utilities.random-walk.co.jp/api}"
CKB_FAUCET_ENABLE_FALLBACK="${CKB_FAUCET_ENABLE_FALLBACK:-1}"
CKB_FAUCET_AMOUNT="${CKB_FAUCET_AMOUNT:-100000}"
CKB_FAUCET_WAIT_SECONDS="${CKB_FAUCET_WAIT_SECONDS:-20}"
WITHDRAWAL_SIGNER_CACHE_PATH="${E2E_WITHDRAWAL_SIGNER_CACHE_PATH:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows/withdrawal-signer.json}"
WITHDRAWAL_RESERVE_CACHE_PATH="${E2E_WITHDRAWAL_RESERVE_CACHE_PATH:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows/withdrawal-reserve.json}"
WORKFLOW_RPC_PORT="${WORKFLOW_RPC_PORT:-${DEFAULT_WORKFLOW_RPC_PORT}}"
E2E_WITHDRAWAL_SIGNER_ROTATE="${E2E_WITHDRAWAL_SIGNER_ROTATE:-0}"
E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET="${E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET:-0}"
E2E_WITHDRAWAL_SIGNER_RESERVE_ENABLED="${E2E_WITHDRAWAL_SIGNER_RESERVE_ENABLED:-1}"
E2E_WITHDRAWAL_SIGNER_RESERVE_TOPUP="${E2E_WITHDRAWAL_SIGNER_RESERVE_TOPUP:-1}"
E2E_WITHDRAWAL_SIGNER_TRANSFER_FEE_BUFFER_SHANNONS="${E2E_WITHDRAWAL_SIGNER_TRANSFER_FEE_BUFFER_SHANNONS:-100000000}"
E2E_WITHDRAWAL_SIGNER_TARGET_SHANNONS="${E2E_WITHDRAWAL_SIGNER_TARGET_SHANNONS:-}"
E2E_WITHDRAWAL_SIGNER_REFILL_SHANNONS="${E2E_WITHDRAWAL_SIGNER_REFILL_SHANNONS:-}"
E2E_WITHDRAWAL_SIGNER_MAX_SHANNONS="${E2E_WITHDRAWAL_SIGNER_MAX_SHANNONS:-}"

LOG_PREFIX="${LOG_PREFIX:-e2e-four-flows}"
VERBOSE="${VERBOSE:-0}"
RUN_DIR="${RUN_DIR:-}"
TIMESTAMP="${TIMESTAMP:-}"
STATE_ENV_PATH=""
PHASE1_DIR=""
PHASE2_DIR=""
POLLING_DIR=""
FLOW12_DIR=""
PHASE3_DIR=""
POSTCHECK_DIR=""
EXPLORER_DIR=""
SCREENSHOT_DIR=""
ARTIFACTS_DIR=""
STATUS_DIR=""
LOGS_DIR=""
COMMANDS_DIR=""
COMMAND_LOG=""
PHASE1_METADATA_PATH=""
PHASE2_METADATA_PATH=""
POLLING_METADATA_PATH=""

RUN_SUBSCRIPTION=1
RUN_POLLING=1
APP_SECRET="${APP_SECRET:-}"
APP_ID="${APP_ID:-}"
AUTHOR_USER_ID="${AUTHOR_USER_ID:-}"
TIPPER_USER_ID="${TIPPER_USER_ID:-}"
TOPIC_POST_ID="${TOPIC_POST_ID:-}"
REPLY_POST_ID="${REPLY_POST_ID:-}"
TOPIC_TX_HASH="${TOPIC_TX_HASH:-}"
REPLY_TX_HASH="${REPLY_TX_HASH:-}"
WITHDRAW_TO_ADDRESS="${WITHDRAW_TO_ADDRESS:-}"
WITHDRAWAL_ID="${WITHDRAWAL_ID:-}"
WITHDRAWAL_REQUESTED_STATE="${WITHDRAWAL_REQUESTED_STATE:-}"
WITHDRAWAL_STATE="${WITHDRAWAL_STATE:-}"
WITHDRAWAL_TX_HASH="${WITHDRAWAL_TX_HASH:-}"
WITHDRAWAL_PRIVATE_KEY="${WITHDRAWAL_PRIVATE_KEY:-}"
WITHDRAWAL_SIGNER_ADDRESS="${WITHDRAWAL_SIGNER_ADDRESS:-}"
WITHDRAWAL_RESERVE_PRIVATE_KEY="${WITHDRAWAL_RESERVE_PRIVATE_KEY:-}"
WITHDRAWAL_RESERVE_ADDRESS="${WITHDRAWAL_RESERVE_ADDRESS:-}"
AUTHOR_BALANCE="${AUTHOR_BALANCE:-}"
AUTHOR_TIP_HISTORY_COUNT="${AUTHOR_TIP_HISTORY_COUNT:-}"
DISCOURSE_UI_BASE_URL="${DISCOURSE_UI_BASE_URL:-${DEFAULT_DISCOURSE_UI_BASE_URL}}"
SETTLEMENT_MODES="${SETTLEMENT_MODES:-${DEFAULT_SETTLEMENT_MODES}}"
EXPLORER_TX_URL_TEMPLATE="${EXPLORER_TX_URL_TEMPLATE:-${E2E_EXPLORER_TX_URL_TEMPLATE:-}}"
LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE:-${FIBER_LIQUIDITY_FALLBACK_MODE:-channel_rotation}}"
CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${DEFAULT_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_CKB}}}"
CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${DEFAULT_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_CKB}}}"
CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT:-${FIBER_CHANNEL_ROTATION_MAX_CONCURRENT:-1}}"

log() {
  printf '[%s] %s\n' "${LOG_PREFIX}" "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

record_cmd() {
  if [[ -n "${COMMAND_LOG}" ]]; then
    printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "${COMMAND_LOG}"
  fi
}

write_checklist() {
  local overall_status="$1"
  local note="$2"
  mkdir -p "${STATUS_DIR}"
  cat > "${STATUS_DIR}/verification-checklist.md" <<CHECKLIST
# E2E Discourse Four Flows Checklist

- Overall status: ${overall_status}
- Note: ${note}
- Artifact directory: ${RUN_DIR}

## Required Screenshots
- [ ] screenshots/step1-forum-tip-entrypoints.png
- [ ] screenshots/step2-topic-and-reply.png
- [ ] screenshots/flow1-tip-button.png
- [ ] screenshots/flow1-tip-modal-step1-generate.png
- [ ] screenshots/flow1-tip-modal-step2-pay.png
- [ ] screenshots/flow1-tip-modal-step3-confirmed.png
- [ ] screenshots/flow1-tip-modal-invoice.png
- [ ] screenshots/step4-tipper-dashboard.png
- [ ] screenshots/step5-author-dashboard.png
- [ ] screenshots/step6-author-withdrawal.png
- [ ] screenshots/step6-admin-withdrawal.png
- [ ] screenshots/step6-explorer-tx.png

## Required Evidence
- [ ] artifacts/flow2-rpc-calls.json
- [ ] artifacts/flow3-subscription.json
- [ ] artifacts/flow3-polling.json
- [ ] artifacts/summary.json
CHECKLIST
}

fatal() {
  local code="$1"
  shift
  log "FAIL(${code}): $*"
  if [[ -n "${RUN_DIR}" ]]; then
    write_checklist "FAIL" "$*"
  fi
  printf 'RESULT=FAIL CODE=%s ARTIFACT_DIR=%s MESSAGE=%s\n' "${code}" "${RUN_DIR:-<unset>}" "$*"
  exit "${code}"
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || fatal "${EXIT_PRECHECK}" "missing required command: ${cmd}"
}

ensure_run_dir() {
  if [[ -z "${RUN_DIR}" ]]; then
    RUN_DIR="${DEFAULT_RUN_DIR}"
  fi
  if [[ -z "${TIMESTAMP}" ]]; then
    TIMESTAMP="$(basename "${RUN_DIR}")"
  fi
}

refresh_run_paths() {
  ensure_run_dir
  PHASE1_DIR="${RUN_DIR}/workflow-phase1-subscription"
  PHASE2_DIR="${RUN_DIR}/workflow-phase2-subscription"
  POLLING_DIR="${RUN_DIR}/workflow-polling"
  FLOW12_DIR="${RUN_DIR}/flow12"
  PHASE3_DIR="${RUN_DIR}/withdrawal-browser"
  POSTCHECK_DIR="${RUN_DIR}/postcheck"
  EXPLORER_DIR="${RUN_DIR}/explorer"
  SCREENSHOT_DIR="${RUN_DIR}/screenshots"
  ARTIFACTS_DIR="${RUN_DIR}/artifacts"
  STATUS_DIR="${RUN_DIR}/status"
  LOGS_DIR="${RUN_DIR}/logs"
  COMMANDS_DIR="${RUN_DIR}/commands"
  STATE_ENV_PATH="${RUN_DIR}/state.env"
  PHASE1_METADATA_PATH="${PHASE1_DIR}/result.env"
  PHASE2_METADATA_PATH="${PHASE2_DIR}/result.env"
  POLLING_METADATA_PATH="${POLLING_DIR}/result.env"
  COMMAND_LOG="${COMMANDS_DIR}/command-index.log"
}

ensure_run_layout() {
  refresh_run_paths
  mkdir -p \
    "${RUN_DIR}" \
    "${SCREENSHOT_DIR}" \
    "${ARTIFACTS_DIR}" \
    "${STATUS_DIR}" \
    "${LOGS_DIR}" \
    "${COMMANDS_DIR}" \
    "${PHASE1_DIR}" \
    "${PHASE2_DIR}" \
    "${POLLING_DIR}" \
    "${FLOW12_DIR}" \
    "${PHASE3_DIR}" \
    "${POSTCHECK_DIR}" \
    "${EXPLORER_DIR}"
  touch "${COMMAND_LOG}"
}

state_keys() {
  cat <<'EOF_KEYS'
TIMESTAMP
RUN_DIR
APP_ID
DISCOURSE_UI_BASE_URL
SETTLEMENT_MODES
AUTHOR_USER_ID
TIPPER_USER_ID
TOPIC_POST_ID
REPLY_POST_ID
TOPIC_TX_HASH
REPLY_TX_HASH
WITHDRAW_TO_ADDRESS
WITHDRAWAL_ID
WITHDRAWAL_REQUESTED_STATE
WITHDRAWAL_STATE
WITHDRAWAL_TX_HASH
AUTHOR_BALANCE
AUTHOR_TIP_HISTORY_COUNT
EXPLORER_TX_URL_TEMPLATE
LIQUIDITY_FALLBACK_MODE
CHANNEL_ROTATION_BOOTSTRAP_RESERVE
CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT
CHANNEL_ROTATION_MAX_CONCURRENT
EOF_KEYS
}

sync_liquidity_fallback_env() {
  export FIBER_LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE:-channel_rotation}"
  export FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${DEFAULT_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_CKB}}"
  export FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${DEFAULT_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_CKB}}"
  export FIBER_CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT:-1}"
}

load_state_env() {
  refresh_run_paths
  if [[ -f "${STATE_ENV_PATH}" ]]; then
    # shellcheck disable=SC1090
    source "${STATE_ENV_PATH}"
  fi
  sync_liquidity_fallback_env
}

persist_state_env() {
  refresh_run_paths
  sync_liquidity_fallback_env
  mkdir -p "$(dirname "${STATE_ENV_PATH}")"
  {
    while IFS= read -r key; do
      printf '%s=%q\n' "${key}" "${!key-}"
    done < <(state_keys)
  } > "${STATE_ENV_PATH}"
}

should_use_unique_withdraw_to_address() {
  [[ "${E2E_UNIQUE_WITHDRAW_TO_ADDRESS:-0}" == "1" ]]
}

generate_unique_testnet_withdraw_to_address() {
  local label="${1:-primary}"
  local seed address

  require_cmd docker
  wait_container_healthy fiber-link-worker 180 \
    || fatal "${EXIT_PRECHECK}" "fiber-link-worker is not healthy for unique withdraw address generation"

  seed="${APP_ID}:${TIMESTAMP}:${label}"
  record_cmd "generate unique withdraw address (label=${label}, seed=${seed})"
  address="$(
    docker exec \
      -e "E2E_UNIQUE_ADDR_SEED=${seed}" \
      fiber-link-worker \
      bun -e 'import { createHash } from "node:crypto";
import { config, hd, helpers } from "@ckb-lumos/lumos";
const seed = process.env.E2E_UNIQUE_ADDR_SEED ?? "default";
const digest = createHash("sha256").update(seed).digest("hex");
const privateKey = `0x${digest}`;
const cfg = config.predefined.AGGRON4;
config.initializeConfig(cfg);
const address = helpers.encodeToConfigAddress(
  hd.key.privateKeyToBlake160(privateKey),
  "SECP256K1_BLAKE160",
  { config: cfg },
);
console.log(address);' 2>/dev/null | tail -n1 | tr -d '\r'
  )"

  [[ "${address}" =~ ^ckt1[0-9a-z]+$ ]] \
    || fatal "${EXIT_PRECHECK}" "failed to generate a valid unique testnet withdraw address for ${label}"

  printf '%s' "${address}"
}

ensure_compose_files() {
  [[ -f "${COMPOSE_ENV_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing compose env file: ${COMPOSE_ENV_FILE}"
  [[ -f "${COMPOSE_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing compose file: ${COMPOSE_FILE}"
}

ensure_app_context() {
  if [[ -z "${APP_ID}" ]]; then
    APP_ID="${FIBER_LINK_APP_ID:-}"
  fi
  if [[ -z "${APP_ID}" ]]; then
    APP_ID="e2e-four-flows-${TIMESTAMP}"
  fi
  export FIBER_LINK_APP_ID="${APP_ID}"

  if [[ -z "${DISCOURSE_UI_BASE_URL}" ]]; then
    DISCOURSE_UI_BASE_URL="${DEFAULT_DISCOURSE_UI_BASE_URL}"
  fi

  export DISCOURSE_UI_BASE_URL
}

ensure_topic_defaults() {
  if [[ -z "${WORKFLOW_TOPIC_TITLE:-}" ]]; then
    export WORKFLOW_TOPIC_TITLE="Fiber Link Local Workflow Topic ${TIMESTAMP}"
  fi
  if [[ -z "${WORKFLOW_TOPIC_BODY:-}" ]]; then
    export WORKFLOW_TOPIC_BODY="This topic is created by local workflow automation (${TIMESTAMP})."
  fi
  if [[ -z "${WORKFLOW_REPLY_BODY:-}" ]]; then
    export WORKFLOW_REPLY_BODY="This reply is created by local workflow automation (${TIMESTAMP})."
  fi
  if [[ -z "${PW_FLOW12_TOPIC_TITLE:-}" ]]; then
    export PW_FLOW12_TOPIC_TITLE="${WORKFLOW_TOPIC_TITLE}"
  fi
}

parse_settlement_modes() {
  local normalized_modes mode_validation
  SETTLEMENT_MODES="${SETTLEMENT_MODES//[[:space:]]/}"
  normalized_modes=",${SETTLEMENT_MODES},"
  RUN_SUBSCRIPTION=0
  RUN_POLLING=0
  if [[ "${normalized_modes}" == *",subscription,"* ]]; then
    RUN_SUBSCRIPTION=1
  fi
  if [[ "${normalized_modes}" == *",polling,"* ]]; then
    RUN_POLLING=1
  fi
  if [[ "${RUN_SUBSCRIPTION}" -eq 0 && "${RUN_POLLING}" -eq 0 ]]; then
    fatal "${EXIT_USAGE}" "invalid --settlement-modes value: ${SETTLEMENT_MODES}"
  fi
  mode_validation="${SETTLEMENT_MODES//subscription/}"
  mode_validation="${mode_validation//polling/}"
  mode_validation="${mode_validation//,/}"
  if [[ -n "${mode_validation}" ]]; then
    fatal "${EXIT_USAGE}" "invalid --settlement-modes value: ${SETTLEMENT_MODES}"
  fi
}

extract_result_json() {
  local log_file="$1"
  [[ -f "${log_file}" ]] || return 1
  awk '/^### Result/{getline; print; exit}' "${log_file}"
}

load_result_metadata() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  unset WORKFLOW_RESULT_STATUS WORKFLOW_RESULT_CODE WORKFLOW_RESULT_MESSAGE \
    WORKFLOW_RESULT_ARTIFACT_DIR WORKFLOW_RESULT_SUMMARY_PATH WORKFLOW_RESULT_SEED_JSON_PATH
  # shellcheck disable=SC1090
  source "${file}"
  return 0
}

get_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${COMPOSE_ENV_FILE}" | tail -n1 || true)"
  [[ -n "${line}" ]] || {
    printf ''
    return
  }
  printf '%s' "${line#*=}"
}

json_or_null() {
  local file="$1"
  if [[ -s "${file}" ]]; then
    jq -c . "${file}" 2>/dev/null || printf 'null'
  else
    printf 'null'
  fi
}

last_json_line_or_null() {
  local file="$1"
  if [[ -s "${file}" ]]; then
    tail -n1 "${file}" | jq -c . 2>/dev/null || printf 'null'
  else
    printf 'null'
  fi
}

copy_or_fail() {
  local src="$1"
  local dest="$2"
  [[ -f "${src}" ]] || fatal "${EXIT_ARTIFACT}" "missing expected file: ${src}"
  cp "${src}" "${dest}"
}

wait_container_healthy() {
  local container="$1"
  local timeout_seconds="$2"
  local start now status
  start="$(date +%s)"

  while true; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - start >= timeout_seconds )); then
      return 1
    fi
    sleep 2
  done
}

wait_http_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local started now
  started="$(date +%s)"

  while true; do
    if curl -fsS -m 3 "${url}" >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      return 1
    fi

    sleep 2
  done
}

ensure_discourse_ui_proxy() {
  local base_url normalized_url login_url backend_ready_url ember_log ember_pattern

  normalized_url="${DISCOURSE_UI_BASE_URL%/}"
  if [[ -z "${normalized_url}" ]]; then
    normalized_url="${DEFAULT_DISCOURSE_UI_BASE_URL%/}"
  fi

  if [[ "${normalized_url}" != "http://127.0.0.1:4200" ]]; then
    login_url="${normalized_url}/login"
    wait_http_ready "${login_url}" 120 \
      || fatal "${EXIT_PRECHECK}" "discourse ui did not become ready at ${login_url}"
    return 0
  fi

  login_url="http://127.0.0.1:4200/login"
  backend_ready_url="http://127.0.0.1:9292/session/csrf.json"
  ember_log="${LOGS_DIR}/discourse-ember-cli.log"
  ember_pattern='[e]mber server --proxy http://127.0.0.1:9292'

  if docker exec discourse_dev sh -lc "pgrep -f '${ember_pattern}' >/dev/null 2>&1"; then
    if wait_http_ready "${login_url}" 20; then
      vlog "ember-cli proxy already running (${login_url})"
      return 0
    fi

    log "ember-cli process exists but ${login_url} is not ready; restarting proxy"
    docker exec discourse_dev sh -lc "pkill -f '${ember_pattern}' >/dev/null 2>&1 || true"
    sleep 2
  fi

  log "starting ember-cli proxy"
  docker exec -u discourse:discourse -w /src discourse_dev sh -lc 'bin/ember-cli --proxy http://127.0.0.1:9292' > "${ember_log}" 2>&1 &
  wait_http_ready "${login_url}" 420 \
    || fatal "${EXIT_PRECHECK}" "ember-cli proxy did not become ready at ${login_url} (see ${ember_log})"
  wait_http_ready "${backend_ready_url}" 180 \
    || fatal "${EXIT_PRECHECK}" "discourse backend did not become ready at ${backend_ready_url} (see ${ember_log})"
}

docker_container_env_value() {
  local container="$1"
  local key="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${container}" 2>/dev/null \
    | awk -F= -v wanted_key="${key}" '$1 == wanted_key {print substr($0, length(wanted_key) + 2); exit}'
}

resolve_runtime_app_secret() {
  [[ "${SKIP_SERVICES:-0}" -eq 1 ]] || return 0

  local runtime_secret
  runtime_secret="$(docker_container_env_value "fiber-link-rpc" "FIBER_LINK_HMAC_SECRET")"
  if [[ -z "${runtime_secret}" ]]; then
    return 0
  fi

  if [[ "${APP_SECRET}" != "${runtime_secret}" ]]; then
    log "detected running rpc secret mismatch under --skip-services; using runtime rpc secret"
  fi
  APP_SECRET="${runtime_secret}"
}

ensure_app_secret() {
  ensure_compose_files
  if [[ -z "${APP_SECRET}" ]]; then
    APP_SECRET="${FIBER_LINK_APP_SECRET:-}"
  fi
  if [[ -z "${APP_SECRET}" ]]; then
    APP_SECRET="$(get_env_value FIBER_LINK_HMAC_SECRET)"
  fi
  [[ -n "${APP_SECRET}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_LINK_HMAC_SECRET/FIBER_LINK_APP_SECRET is required"
  resolve_runtime_app_secret
}

sync_rpc_app_secret_record() {
  local pg_container="fiber-link-postgres"
  local pg_user="${POSTGRES_USER:-$(get_env_value POSTGRES_USER)}"
  local pg_db="${POSTGRES_DB:-$(get_env_value POSTGRES_DB)}"
  pg_user="${pg_user:-fiber}"
  pg_db="${pg_db:-fiber_link}"

  if ! docker ps --format '{{.Names}}' | grep -qx "${pg_container}"; then
    vlog "postgres container '${pg_container}' is not running; skip app secret sync"
    return 0
  fi

  local app_id_sql app_secret_sql upsert_sql
  app_id_sql="$(printf '%s' "${APP_ID}" | sed "s/'/''/g")"
  app_secret_sql="$(printf '%s' "${APP_SECRET}" | sed "s/'/''/g")"
  upsert_sql="INSERT INTO apps (app_id, hmac_secret) VALUES ('${app_id_sql}', '${app_secret_sql}') ON CONFLICT (app_id) DO UPDATE SET hmac_secret = EXCLUDED.hmac_secret;"

  if docker exec "${pg_container}" psql \
    -v ON_ERROR_STOP=1 \
    -U "${pg_user}" \
    -d "${pg_db}" \
    -c "${upsert_sql}" >/dev/null 2>&1; then
    vlog "synced rpc app secret row for app_id='${APP_ID}'"
    return 0
  fi

  log "warning: failed to sync rpc app secret row for app_id='${APP_ID}'"
  return 0
}

resolve_runtime_rpc_port() {
  local configured detected
  configured="$(get_env_value RPC_PORT)"
  if [[ -z "${configured}" ]]; then
    configured="3000"
  fi
  WORKFLOW_RPC_PORT="${configured}"

  if ! curl -fsS -m 3 "http://127.0.0.1:${WORKFLOW_RPC_PORT}/healthz/ready" >/dev/null 2>&1; then
    detected="$(docker port fiber-link-rpc 3000/tcp 2>/dev/null | awk -F: 'NR==1 {print $NF}' || true)"
    if [[ -n "${detected}" ]]; then
      WORKFLOW_RPC_PORT="${detected}"
    fi
  fi

  curl -fsS -m 5 "http://127.0.0.1:${WORKFLOW_RPC_PORT}/healthz/ready" >/dev/null 2>&1 \
    || fatal "${EXIT_PRECHECK}" "rpc endpoint is not ready at http://127.0.0.1:${WORKFLOW_RPC_PORT}/healthz/ready"
}

normalize_private_key_hex() {
  local value="$1"
  if [[ "${value}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    printf '%s' "${value}" | tr 'A-F' 'a-f'
    return 0
  fi
  if [[ "${value}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    printf '0x%s' "$(printf '%s' "${value}" | tr 'A-F' 'a-f')"
    return 0
  fi
  return 1
}

derive_ckb_testnet_address_from_private_key() {
  local private_key="$1"
  docker exec -e FIBER_LINK_WITHDRAW_PK="${private_key}" fiber-link-rpc sh -lc 'bun -e '"'"'import { hd, helpers, config } from "@ckb-lumos/lumos";
const privateKey = (process.env.FIBER_LINK_WITHDRAW_PK ?? "").trim().toLowerCase();
if (!/^0x[0-9a-f]{64}$/.test(privateKey)) {
  throw new Error("invalid FIBER_LINK_WITHDRAW_PK");
}
config.initializeConfig(config.predefined.AGGRON4);
const address = helpers.encodeToConfigAddress(
  hd.key.privateKeyToBlake160(privateKey),
  "SECP256K1_BLAKE160",
  { config: config.predefined.AGGRON4 },
);
console.log(address);
	'"'"''
}

default_withdrawal_signer_target_shannons() {
  local withdraw_amount_ckb="${WORKFLOW_WITHDRAW_AMOUNT:-61}"
  [[ "${withdraw_amount_ckb}" =~ ^[0-9]+$ ]] || withdraw_amount_ckb=61
  if [[ "${LIQUIDITY_FALLBACK_MODE:-channel_rotation}" == "channel_rotation" ]]; then
    printf '%s' "$(( withdraw_amount_ckb * 100000000 ))"
    return 0
  fi
  printf '%s' "$(( (withdraw_amount_ckb * 2 + 1) * 100000000 ))"
}

resolve_shannons_setting() {
  local name="$1"
  local fallback="$2"
  local raw="${!name:-}"
  if [[ -z "${raw}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi
  [[ "${raw}" =~ ^[0-9]+$ ]] || fatal "${EXIT_PRECHECK}" "${name} must be a non-negative integer in shannons"
  printf '%s' "${raw}"
}

get_ckb_wallet_inventory_json_for_private_key() {
  local private_key="$1"
  docker exec \
    -e "FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=${private_key}" \
    -w /app \
    fiber-link-rpc \
    sh -lc 'bun -e '"'"'import { createDefaultHotWalletInventoryProvider } from "@fiber-link/fiber-adapter";
const provider = createDefaultHotWalletInventoryProvider();
const inventory = await provider({ asset: "CKB", network: "AGGRON4" });
function parseCkbToShannons(input) {
  const value = String(input ?? "0").trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`invalid CKB amount: ${value}`);
  }
  const [intPartRaw, fracPartRaw = ""] = value.split(".");
  const intPart = BigInt(intPartRaw);
  const fracPart = BigInt((fracPartRaw + "00000000").slice(0, 8));
  return intPart * 100000000n + fracPart;
}
console.log(JSON.stringify({
  asset: inventory.asset,
  network: inventory.network,
  availableAmount: String(inventory.availableAmount ?? "0"),
  availableShannons: parseCkbToShannons(inventory.availableAmount ?? "0").toString(),
}));
'"'"''
}

get_ckb_wallet_available_shannons_for_private_key() {
  local private_key="$1"
  local inventory_json
  inventory_json="$(get_ckb_wallet_inventory_json_for_private_key "${private_key}")" \
    || fatal "${EXIT_PRECHECK}" "failed to query hot wallet inventory"
  printf '%s' "${inventory_json}" | jq -r '.availableShannons'
}

transfer_ckb_between_private_keys() {
  local label="$1"
  local source_private_key="$2"
  local destination_address="$3"
  local amount_shannons="$4"
  local output_path="${ARTIFACTS_DIR}/${label}.json"
  local error_path="${output_path%.json}.stderr.log"

  [[ "${amount_shannons}" =~ ^[0-9]+$ ]] || fatal "${EXIT_PRECHECK}" "invalid transfer amount shannons: ${amount_shannons}"
  [[ "${amount_shannons}" -gt 0 ]] || fatal "${EXIT_PRECHECK}" "transfer amount must be > 0"

  docker exec \
    -e "FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=${source_private_key}" \
    -e "E2E_TRANSFER_TO_ADDRESS=${destination_address}" \
    -e "E2E_TRANSFER_AMOUNT_SHANNONS=${amount_shannons}" \
    -w /app \
    fiber-link-rpc \
    sh -lc 'bun -e '"'"'import { executeCkbOnchainWithdrawal, shannonsToCkbDecimal } from "./packages/fiber-adapter/src/ckb-onchain-withdrawal.ts";
const amountShannons = BigInt(process.env.E2E_TRANSFER_AMOUNT_SHANNONS ?? "0");
const toAddress = String(process.env.E2E_TRANSFER_TO_ADDRESS ?? "");
if (!toAddress) {
  throw new Error("missing E2E_TRANSFER_TO_ADDRESS");
}
const amount = shannonsToCkbDecimal(amountShannons);
const result = await executeCkbOnchainWithdrawal({
  asset: "CKB",
  amount,
  destination: { kind: "CKB_ADDRESS", address: toAddress },
});
console.log(JSON.stringify({
  txHash: result.txHash,
  amount,
  amountShannons: amountShannons.toString(),
  destinationAddress: toAddress,
}));
'"'"'' > "${output_path}" 2>"${error_path}" \
    || fatal "${EXIT_PRECHECK}" "failed CKB transfer (${label})"
}

wait_for_wallet_balance_at_most() {
  local private_key="$1"
  local max_shannons="$2"
  local label="$3"
  local attempt current
  for attempt in $(seq 1 20); do
    current="$(get_ckb_wallet_available_shannons_for_private_key "${private_key}")"
    if (( current <= max_shannons )); then
      return 0
    fi
    vlog "waiting ${label}: current=${current} max=${max_shannons} attempt=${attempt}"
    sleep 3
  done
  return 1
}

wait_for_wallet_balance_at_least() {
  local private_key="$1"
  local min_shannons="$2"
  local label="$3"
  local attempt current
  for attempt in $(seq 1 20); do
    current="$(get_ckb_wallet_available_shannons_for_private_key "${private_key}")"
    if (( current >= min_shannons )); then
      return 0
    fi
    vlog "waiting ${label}: current=${current} min=${min_shannons} attempt=${attempt}"
    sleep 3
  done
  return 1
}

ensure_withdrawal_reserve_private_key() {
  local candidate cached_address generated derived_address

  if [[ "${E2E_WITHDRAWAL_SIGNER_RESERVE_ENABLED}" != "1" ]]; then
    return 0
  fi

  candidate="${E2E_WITHDRAWAL_RESERVE_CKB_PRIVATE_KEY:-}"
  if [[ -z "${candidate}" && -s "${WITHDRAWAL_RESERVE_CACHE_PATH}" ]]; then
    candidate="$(jq -r '.privateKey // empty' "${WITHDRAWAL_RESERVE_CACHE_PATH}" 2>/dev/null || true)"
    cached_address="$(jq -r '.address // empty' "${WITHDRAWAL_RESERVE_CACHE_PATH}" 2>/dev/null || true)"
    if [[ -n "${cached_address}" ]]; then
      WITHDRAWAL_RESERVE_ADDRESS="${cached_address}"
    fi
  fi

  if [[ -z "${candidate}" ]]; then
    generated="$(openssl rand -hex 32)"
    candidate="0x${generated}"
  fi

  candidate="$(normalize_private_key_hex "${candidate}")" \
    || fatal "${EXIT_PRECHECK}" "invalid E2E_WITHDRAWAL_RESERVE_CKB_PRIVATE_KEY format"
  WITHDRAWAL_RESERVE_PRIVATE_KEY="${candidate}"

  if [[ -z "${WITHDRAWAL_RESERVE_ADDRESS}" ]]; then
    derived_address="$(derive_ckb_testnet_address_from_private_key "${WITHDRAWAL_RESERVE_PRIVATE_KEY}" | tail -n1 | tr -d '\r')"
    [[ "${derived_address}" =~ ^ckt1 ]] \
      || fatal "${EXIT_PRECHECK}" "failed to derive testnet reserve address from withdrawal reserve private key"
    WITHDRAWAL_RESERVE_ADDRESS="${derived_address}"
  fi

  mkdir -p "$(dirname "${WITHDRAWAL_RESERVE_CACHE_PATH}")"
  jq -n \
    --arg privateKey "${WITHDRAWAL_RESERVE_PRIVATE_KEY}" \
    --arg address "${WITHDRAWAL_RESERVE_ADDRESS}" \
    --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{privateKey:$privateKey,address:$address,updatedAt:$updatedAt}' > "${WITHDRAWAL_RESERVE_CACHE_PATH}"
  chmod 600 "${WITHDRAWAL_RESERVE_CACHE_PATH}" || true
}

rebalance_withdrawal_signer_balance() {
  local fee_buffer_shannons target_shannons refill_shannons max_shannons
  local signer_balance reserve_balance sweep_amount desired_balance_after_topup

  if [[ "${E2E_WITHDRAWAL_SIGNER_RESERVE_ENABLED}" != "1" ]]; then
    return 0
  fi

  ensure_withdrawal_reserve_private_key

  fee_buffer_shannons="$(resolve_shannons_setting "E2E_WITHDRAWAL_SIGNER_TRANSFER_FEE_BUFFER_SHANNONS" "100000000")"
  target_shannons="$(resolve_shannons_setting "E2E_WITHDRAWAL_SIGNER_TARGET_SHANNONS" "$(default_withdrawal_signer_target_shannons)")"
  refill_shannons="$(resolve_shannons_setting "E2E_WITHDRAWAL_SIGNER_REFILL_SHANNONS" "${target_shannons}")"
  max_shannons="$(resolve_shannons_setting "E2E_WITHDRAWAL_SIGNER_MAX_SHANNONS" "$(( target_shannons + refill_shannons ))")"

  signer_balance="$(get_ckb_wallet_available_shannons_for_private_key "${WITHDRAWAL_PRIVATE_KEY}")"
  vlog "withdrawal signer balance before reserve rebalance: ${signer_balance} shannons"

  if (( signer_balance > max_shannons )); then
    sweep_amount=$(( signer_balance - target_shannons - fee_buffer_shannons ))
    if (( sweep_amount > 0 )); then
      log "withdrawal signer overfunded; sweeping ${sweep_amount} shannons to reserve wallet"
      transfer_ckb_between_private_keys \
        "withdrawal-signer-sweep-to-reserve" \
        "${WITHDRAWAL_PRIVATE_KEY}" \
        "${WITHDRAWAL_RESERVE_ADDRESS}" \
        "${sweep_amount}"
      wait_for_wallet_balance_at_most "${WITHDRAWAL_PRIVATE_KEY}" "${max_shannons}" "withdrawal-signer-sweep" \
        || fatal "${EXIT_PRECHECK}" "withdrawal signer balance did not drop after reserve sweep"
      signer_balance="$(get_ckb_wallet_available_shannons_for_private_key "${WITHDRAWAL_PRIVATE_KEY}")"
    fi
  fi

  if [[ "${E2E_WITHDRAWAL_SIGNER_RESERVE_TOPUP}" == "1" ]] && (( signer_balance < target_shannons )); then
    reserve_balance="$(get_ckb_wallet_available_shannons_for_private_key "${WITHDRAWAL_RESERVE_PRIVATE_KEY}")"
    if (( reserve_balance > refill_shannons + fee_buffer_shannons )); then
      log "withdrawal signer under target; topping up ${refill_shannons} shannons from reserve wallet"
      desired_balance_after_topup=$(( signer_balance + refill_shannons ))
      transfer_ckb_between_private_keys \
        "withdrawal-signer-topup-from-reserve" \
        "${WITHDRAWAL_RESERVE_PRIVATE_KEY}" \
        "${WITHDRAWAL_SIGNER_ADDRESS}" \
        "${refill_shannons}"
      wait_for_wallet_balance_at_least "${WITHDRAWAL_PRIVATE_KEY}" "${desired_balance_after_topup}" "withdrawal-signer-topup" \
        || fatal "${EXIT_PRECHECK}" "withdrawal signer balance did not recover after reserve top-up"
      signer_balance="$(get_ckb_wallet_available_shannons_for_private_key "${WITHDRAWAL_PRIVATE_KEY}")"
    fi
  fi

  vlog "withdrawal signer balance after reserve rebalance: ${signer_balance} shannons"
}

request_ckb_faucet_for_address() {
  local address="$1"
  local label="$2"
  local payload request_file response_file http_code
  local fallback_payload fallback_request_file fallback_response_file fallback_http_code
  payload="$(jq -cn --arg address "${address}" --arg amount "${CKB_FAUCET_AMOUNT}" '{claim_event:{address_hash:$address,amount:$amount}}')"
  request_file="${ARTIFACTS_DIR}/ckb-faucet-${label}.request.json"
  response_file="${ARTIFACTS_DIR}/ckb-faucet-${label}.response.json"
  printf '%s\n' "${payload}" > "${request_file}"

  set +e
  http_code="$(curl -sS -o "${response_file}" -w "%{http_code}" \
    -H "content-type: application/json" \
    -d "${payload}" \
    "${CKB_FAUCET_API_BASE%/}/claim_events")"
  local rc=$?
  set -e
  if [[ "${rc}" -eq 0 && "${http_code}" -ge 200 && "${http_code}" -lt 300 ]] \
    && ! jq -e '(.error != null) or ((.errors | type) == "array" and (.errors | length) > 0)' "${response_file}" >/dev/null 2>&1; then
    log "ckb faucet(${label}) accepted; waiting ${CKB_FAUCET_WAIT_SECONDS}s"
    sleep "${CKB_FAUCET_WAIT_SECONDS}"
    return 0
  fi

  if [[ "${CKB_FAUCET_ENABLE_FALLBACK}" == "1" ]]; then
    fallback_payload="$(jq -cn --arg address "${address}" '{address:$address,token:"ckb"}')"
    fallback_request_file="${ARTIFACTS_DIR}/ckb-faucet-fallback-${label}.request.json"
    fallback_response_file="${ARTIFACTS_DIR}/ckb-faucet-fallback-${label}.response.json"
    printf '%s\n' "${fallback_payload}" > "${fallback_request_file}"
    set +e
    fallback_http_code="$(curl -sS -o "${fallback_response_file}" -w "%{http_code}" \
      -H "content-type: application/json" \
      -d "${fallback_payload}" \
      "${CKB_FAUCET_FALLBACK_API_BASE%/}/faucet")"
    rc=$?
    set -e
    if [[ "${rc}" -eq 0 && "${fallback_http_code}" -ge 200 && "${fallback_http_code}" -lt 300 ]] \
      && ! jq -e '(.error != null) or ((.errors | type) == "array" and (.errors | length) > 0)' "${fallback_response_file}" >/dev/null 2>&1; then
      log "ckb faucet fallback(${label}) accepted; waiting ${CKB_FAUCET_WAIT_SECONDS}s"
      sleep "${CKB_FAUCET_WAIT_SECONDS}"
      return 0
    fi
  fi

  if [[ "${http_code:-000}" == "422" ]]; then
    log "ckb faucet(${label}) returned HTTP 422; continuing with existing signer balance"
    return 0
  fi

  fatal "${EXIT_PRECHECK}" "ckb faucet request failed for ${label} (http=${http_code:-000})"
}

ensure_withdrawal_signer_private_key() {
  local candidate cached_address generated derived_address signer_target_shannons signer_balance
  candidate="${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-${FIBER_WITHDRAW_CKB_PRIVATE_KEY:-}}"
  if [[ -z "${candidate}" ]]; then
    candidate="$(get_env_value FIBER_WITHDRAWAL_CKB_PRIVATE_KEY)"
  fi

  if [[ "${E2E_WITHDRAWAL_SIGNER_ROTATE}" != "1" && -z "${candidate}" && -s "${WITHDRAWAL_SIGNER_CACHE_PATH}" ]]; then
    candidate="$(jq -r '.privateKey // empty' "${WITHDRAWAL_SIGNER_CACHE_PATH}" 2>/dev/null || true)"
    cached_address="$(jq -r '.address // empty' "${WITHDRAWAL_SIGNER_CACHE_PATH}" 2>/dev/null || true)"
    if [[ -n "${cached_address}" ]]; then
      WITHDRAWAL_SIGNER_ADDRESS="${cached_address}"
    fi
  fi

  if [[ -z "${candidate}" ]]; then
    generated="$(openssl rand -hex 32)"
    candidate="0x${generated}"
  fi

  candidate="$(normalize_private_key_hex "${candidate}")" \
    || fatal "${EXIT_PRECHECK}" "invalid FIBER_WITHDRAWAL_CKB_PRIVATE_KEY format"
  WITHDRAWAL_PRIVATE_KEY="${candidate}"

  if [[ -z "${WITHDRAWAL_SIGNER_ADDRESS}" ]]; then
    derived_address="$(derive_ckb_testnet_address_from_private_key "${WITHDRAWAL_PRIVATE_KEY}" | tail -n1 | tr -d '\r')"
    [[ "${derived_address}" =~ ^ckt1 ]] \
      || fatal "${EXIT_PRECHECK}" "failed to derive testnet signer address from withdrawal private key"
    WITHDRAWAL_SIGNER_ADDRESS="${derived_address}"
  fi

  mkdir -p "$(dirname "${WITHDRAWAL_SIGNER_CACHE_PATH}")"
  jq -n \
    --arg privateKey "${WITHDRAWAL_PRIVATE_KEY}" \
    --arg address "${WITHDRAWAL_SIGNER_ADDRESS}" \
    --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{privateKey:$privateKey,address:$address,updatedAt:$updatedAt}' > "${WITHDRAWAL_SIGNER_CACHE_PATH}"
  chmod 600 "${WITHDRAWAL_SIGNER_CACHE_PATH}" || true

  rebalance_withdrawal_signer_balance
  signer_target_shannons="$(resolve_shannons_setting "E2E_WITHDRAWAL_SIGNER_TARGET_SHANNONS" "$(default_withdrawal_signer_target_shannons)")"
  signer_balance="$(get_ckb_wallet_available_shannons_for_private_key "${WITHDRAWAL_PRIVATE_KEY}")"

  if [[ "${E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET}" != "1" ]] && (( signer_balance < signer_target_shannons )); then
    request_ckb_faucet_for_address "${WITHDRAWAL_SIGNER_ADDRESS}" "withdrawal-signer"
    rebalance_withdrawal_signer_balance
  elif [[ "${E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET}" != "1" ]]; then
    vlog "withdrawal signer already funded above target; skipping faucet"
  fi
}

restart_withdrawal_runtime() {
  local strategy="$1"
  local runtime_rpc_port="${WORKFLOW_RPC_PORT:-${DEFAULT_WORKFLOW_RPC_PORT}}"
  record_cmd "RPC_PORT=${runtime_rpc_port} WORKER_SETTLEMENT_STRATEGY=${strategy} docker compose --env-file ${COMPOSE_ENV_FILE} -f ${COMPOSE_FILE} up -d --no-deps --force-recreate rpc worker"
  if [[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
    record_cmd "runtime restart includes FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=<redacted>"
  fi
  (
    cd "${ROOT_DIR}"
    export RPC_PORT="${runtime_rpc_port}"
    export WORKER_SETTLEMENT_STRATEGY="${strategy}"
    if [[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
      export FIBER_WITHDRAWAL_CKB_PRIVATE_KEY="${WITHDRAWAL_PRIVATE_KEY}"
    fi
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER:-${DEFAULT_WITHDRAWAL_LIQUIDITY_FEE_BUFFER_CKB}}"
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE:-${DEFAULT_WITHDRAWAL_LIQUIDITY_POST_TX_RESERVE_CKB}}"
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER:-${DEFAULT_WITHDRAWAL_LIQUIDITY_WARM_BUFFER_CKB}}"
    export FIBER_LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE:-channel_rotation}"
    export FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${DEFAULT_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_CKB}}"
    export FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${DEFAULT_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_CKB}}"
    export FIBER_CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT:-1}"
    docker compose \
      --env-file "${COMPOSE_ENV_FILE}" \
      -f "${COMPOSE_FILE}" \
      up -d --no-deps --force-recreate rpc worker
  ) > "${LOGS_DIR}/runtime-${strategy}.log" 2>&1 \
    || fatal "${EXIT_PRECHECK}" "failed to restart rpc/worker with strategy=${strategy}"

  wait_container_healthy fiber-link-rpc 180 \
    || fatal "${EXIT_PRECHECK}" "rpc did not become healthy after strategy=${strategy}"
  wait_container_healthy fiber-link-worker 180 \
    || fatal "${EXIT_PRECHECK}" "worker did not become healthy after strategy=${strategy}"
}

sign_payload() {
  local payload="$1"
  local ts="$2"
  local nonce="$3"
  printf '%s' "${ts}.${nonce}.${payload}" \
    | openssl dgst -sha256 -hmac "${APP_SECRET}" -hex \
    | awk '{print $2}'
}

rpc_call_signed() {
  local payload="$1"
  local nonce="$2"
  local ts sig
  ts="$(date +%s)"
  sig="$(sign_payload "${payload}" "${ts}" "${nonce}")"
  curl -fsS "http://127.0.0.1:${WORKFLOW_RPC_PORT}/rpc" \
    -H "content-type: application/json" \
    -H "x-app-id: ${APP_ID}" \
    -H "x-ts: ${ts}" \
    -H "x-nonce: ${nonce}" \
    -H "x-signature: ${sig}" \
    -d "${payload}"
}

dashboard_summary_admin() {
  local payload
  payload="$(jq -cn \
    --arg id "dash-admin-$(date +%s)-$RANDOM" \
    --arg userId "${AUTHOR_USER_ID}" \
    '{jsonrpc:"2.0",id:$id,method:"dashboard.summary",params:{userId:$userId,includeAdmin:true,filters:{withdrawalState:"ALL",settlementState:"ALL"},limit:50}}')"
  rpc_call_signed "${payload}" "dash-admin-$(date +%s)-$RANDOM"
}

wait_withdrawal_completed() {
  local withdrawal_id="$1"
  local timeout_seconds="${2:-420}"
  local poll_log="${ARTIFACTS_DIR}/flow4-withdrawal-admin.poll.log"
  local started now response row state tx_hash

  : > "${poll_log}"
  started="$(date +%s)"

  while true; do
    response="$(dashboard_summary_admin)"
    printf '%s\n' "${response}" >> "${poll_log}"

    row="$(printf '%s' "${response}" | jq -c --arg wid "${withdrawal_id}" '.result.admin.withdrawals[]? | select(.id == $wid)' | head -n1 || true)"
    state="$(printf '%s' "${row}" | jq -r '.state // empty' 2>/dev/null || true)"
    tx_hash="$(printf '%s' "${row}" | jq -r '.txHash // .tx_hash // empty' 2>/dev/null || true)"

    if [[ "${state}" == "COMPLETED" ]]; then
      WITHDRAWAL_STATE="${state}"
      WITHDRAWAL_TX_HASH="${tx_hash}"
      return 0
    fi

    if [[ "${state}" == "FAILED" ]]; then
      WITHDRAWAL_STATE="${state}"
      WITHDRAWAL_TX_HASH="${tx_hash}"
      return 1
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      WITHDRAWAL_STATE="${state}"
      WITHDRAWAL_TX_HASH="${tx_hash}"
      return 2
    fi

    sleep 5
  done
}

assert_tip_log_settled() {
  local log_file="$1"
  local final_state
  [[ -s "${log_file}" ]] || return 1
  final_state="$(jq -r '.result.state // empty' "${log_file}" | tail -n1)"
  [[ "${final_state}" == "SETTLED" ]]
}

set_worker_strategy() {
  local strategy="$1"
  record_cmd "WORKER_SETTLEMENT_STRATEGY=${strategy} docker compose --env-file ${COMPOSE_ENV_FILE} -f ${COMPOSE_FILE} up -d --no-deps --force-recreate worker"
  if [[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
    record_cmd "worker restart includes FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=<redacted>"
  fi
  (
    cd "${ROOT_DIR}"
    export WORKER_SETTLEMENT_STRATEGY="${strategy}"
    if [[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
      export FIBER_WITHDRAWAL_CKB_PRIVATE_KEY="${WITHDRAWAL_PRIVATE_KEY}"
    fi
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER:-${DEFAULT_WITHDRAWAL_LIQUIDITY_FEE_BUFFER_CKB}}"
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE:-${DEFAULT_WITHDRAWAL_LIQUIDITY_POST_TX_RESERVE_CKB}}"
    export FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER:-${DEFAULT_WITHDRAWAL_LIQUIDITY_WARM_BUFFER_CKB}}"
    export FIBER_LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE:-channel_rotation}"
    export FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${DEFAULT_CHANNEL_ROTATION_BOOTSTRAP_RESERVE_CKB}}"
    export FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${DEFAULT_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT_CKB}}"
    export FIBER_CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT:-1}"
    docker compose \
      --env-file "${COMPOSE_ENV_FILE}" \
      -f "${COMPOSE_FILE}" \
      up -d --no-deps --force-recreate worker
  ) > "${LOGS_DIR}/worker-${strategy}.log" 2>&1 \
    || fatal "${EXIT_PRECHECK}" "failed to restart worker with strategy=${strategy}"

  wait_container_healthy fiber-link-worker 180 \
    || fatal "${EXIT_PRECHECK}" "worker did not become healthy after strategy=${strategy}"
}

capture_hot_wallet_inventory() {
  local output_path="$1"
  local asset="${2:-CKB}"
  local network="${3:-AGGRON4}"

  docker exec -w /app fiber-link-rpc sh -lc "bun -e '
import { createDefaultHotWalletInventoryProvider } from \"@fiber-link/fiber-adapter\";
const provider = createDefaultHotWalletInventoryProvider();
const inventory = await provider({ asset: \"${asset}\", network: \"${network}\" });
console.log(JSON.stringify(inventory));
' " > "${output_path}" 2>"${output_path%.json}.stderr.log" \
    || fatal "${EXIT_ARTIFACT}" "failed to capture hot wallet inventory"
}

capture_withdrawal_liquidity_snapshot() {
  local withdrawal_id="$1"
  local output_path="$2"
  local pg_container="fiber-link-postgres"
  local pg_user="${POSTGRES_USER:-$(get_env_value POSTGRES_USER)}"
  local pg_db="${POSTGRES_DB:-$(get_env_value POSTGRES_DB)}"
  local withdrawal_id_sql query
  pg_user="${pg_user:-fiber}"
  pg_db="${pg_db:-fiber_link}"
  withdrawal_id_sql="$(printf '%s' "${withdrawal_id}" | sed "s/'/''/g")"
  query="SELECT COALESCE(row_to_json(t)::text, 'null')
FROM (
  SELECT
    w.id,
    w.state,
    w.asset,
    w.amount,
    w.to_address AS \"toAddress\",
    w.liquidity_request_id AS \"liquidityRequestId\",
    w.liquidity_pending_reason AS \"liquidityPendingReason\",
    lr.state AS \"liquidityRequestState\",
    lr.required_amount AS \"liquidityRequestRequiredAmount\",
    lr.funded_amount AS \"liquidityRequestFundedAmount\",
    lr.metadata AS \"liquidityRequestMetadata\"
  FROM withdrawals w
  LEFT JOIN liquidity_requests lr ON lr.id = w.liquidity_request_id
  WHERE w.id = '${withdrawal_id_sql}'
) t;"
  docker exec "${pg_container}" psql -At -U "${pg_user}" -d "${pg_db}" -c "${query}" > "${output_path}" \
    || fatal "${EXIT_ARTIFACT}" "failed to capture withdrawal liquidity snapshot for ${withdrawal_id}"
}
