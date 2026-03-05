#!/usr/bin/env bash
set -euo pipefail

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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
COMPOSE_ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR="${E2E_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows/${TIMESTAMP}}"
SETTLEMENT_MODES="${E2E_SETTLEMENT_MODES:-subscription,polling}"
EXPLORER_TX_URL_TEMPLATE="${E2E_EXPLORER_TX_URL_TEMPLATE:-}"
DISCOURSE_UI_BASE_URL="${E2E_DISCOURSE_UI_BASE_URL:-http://127.0.0.1:4200}"

SKIP_SERVICES=0
SKIP_DISCOURSE=0
HEADED=1
VERBOSE=0

RUN_SUBSCRIPTION=1
RUN_POLLING=1

PHASE1_DIR=""
PHASE2_DIR=""
POLLING_DIR=""
FLOW12_DIR=""
POSTCHECK_DIR=""
EXPLORER_DIR=""
SCREENSHOT_DIR=""
ARTIFACTS_DIR=""
STATUS_DIR=""
LOGS_DIR=""
COMMANDS_DIR=""

PHASE1_METADATA_PATH=""
PHASE2_METADATA_PATH=""
POLLING_METADATA_PATH=""
COMMAND_LOG=""

FLOW12_RESULT_JSON=""
POSTCHECK_RESULT_JSON=""
EXPLORER_RESULT_JSON=""

AUTHOR_USER_ID=""
TIPPER_USER_ID=""
TOPIC_POST_ID=""
REPLY_POST_ID=""
WITHDRAW_TO_ADDRESS=""
WITHDRAWAL_ID=""
WITHDRAWAL_STATE=""
WITHDRAWAL_TX_HASH=""
WITHDRAWAL_PRIVATE_KEY=""
WITHDRAWAL_SIGNER_ADDRESS=""
AUTHOR_BALANCE=""
AUTHOR_TIP_HISTORY_COUNT=""

RPC_PORT=""
APP_SECRET=""
APP_ID=""
CKB_FAUCET_API_BASE="${CKB_FAUCET_API_BASE:-https://faucet-api.nervos.org}"
CKB_FAUCET_FALLBACK_API_BASE="${CKB_FAUCET_FALLBACK_API_BASE:-https://ckb-utilities.random-walk.co.jp/api}"
CKB_FAUCET_ENABLE_FALLBACK="${CKB_FAUCET_ENABLE_FALLBACK:-1}"
CKB_FAUCET_AMOUNT="${CKB_FAUCET_AMOUNT:-100000}"
CKB_FAUCET_WAIT_SECONDS="${CKB_FAUCET_WAIT_SECONDS:-20}"
WITHDRAWAL_SIGNER_CACHE_PATH="${E2E_WITHDRAWAL_SIGNER_CACHE_PATH:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows/withdrawal-signer.json}"

refresh_paths() {
  PHASE1_DIR="${ARTIFACT_DIR}/workflow-phase1-subscription"
  PHASE2_DIR="${ARTIFACT_DIR}/workflow-phase2-subscription"
  POLLING_DIR="${ARTIFACT_DIR}/workflow-polling"
  FLOW12_DIR="${ARTIFACT_DIR}/flow12"
  POSTCHECK_DIR="${ARTIFACT_DIR}/postcheck"
  EXPLORER_DIR="${ARTIFACT_DIR}/explorer"
  SCREENSHOT_DIR="${ARTIFACT_DIR}/screenshots"
  ARTIFACTS_DIR="${ARTIFACT_DIR}/artifacts"
  STATUS_DIR="${ARTIFACT_DIR}/status"
  LOGS_DIR="${ARTIFACT_DIR}/logs"
  COMMANDS_DIR="${ARTIFACT_DIR}/commands"
  PHASE1_METADATA_PATH="${PHASE1_DIR}/result.env"
  PHASE2_METADATA_PATH="${PHASE2_DIR}/result.env"
  POLLING_METADATA_PATH="${POLLING_DIR}/result.env"
  COMMAND_LOG="${COMMANDS_DIR}/command-index.log"
}

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.sh [options]

Runs the 4 local e2e flows (Discourse + Fiber services via Docker):
1) Tip button + tip modal UI proof
2) Discourse-integrated backend interface proof
3) Settlement strategy proof (subscription and/or polling)
4) Creator balance/history + withdrawal + explorer transaction screenshot proof

Options:
  --skip-services               Skip compose/discourse bootstrap in phase1.
  --skip-discourse              Skip discourse bootstrap/seeding in phase1 (requires WORKFLOW_* IDs).
  --headless                    Run browser automation in headless mode.
  --artifact-dir <path>         Override output directory.
  --settlement-modes <modes>    Comma-separated: subscription,polling | subscription | polling.
  --explorer-tx-url-template <template>
                                Explorer URL template containing {txHash} or %s.
  --verbose                     Print detailed logs.
  -h, --help                    Show help.

Required env or option:
  E2E_EXPLORER_TX_URL_TEMPLATE (or --explorer-tx-url-template)
USAGE
}

log() {
  printf '[e2e-four-flows] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

record_cmd() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "${COMMAND_LOG}"
}

fatal() {
  local code="$1"
  shift
  log "FAIL(${code}): $*"
  write_checklist "FAIL" "$*"
  printf 'RESULT=FAIL CODE=%s ARTIFACT_DIR=%s MESSAGE=%s\n' "${code}" "${ARTIFACT_DIR}" "$*"
  exit "${code}"
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || fatal "${EXIT_PRECHECK}" "missing required command: ${cmd}"
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

resolve_runtime_rpc_port() {
  local configured
  configured="$(get_env_value RPC_PORT)"
  if [[ -z "${configured}" ]]; then
    configured="3000"
  fi
  RPC_PORT="${configured}"

  if ! curl -fsS -m 3 "http://127.0.0.1:${RPC_PORT}/healthz/ready" >/dev/null 2>&1; then
    local detected
    detected="$(docker port fiber-link-rpc 3000/tcp 2>/dev/null | awk -F: 'NR==1 {print $NF}' || true)"
    if [[ -n "${detected}" ]]; then
      RPC_PORT="${detected}"
    fi
  fi

  curl -fsS -m 5 "http://127.0.0.1:${RPC_PORT}/healthz/ready" >/dev/null 2>&1 \
    || fatal "${EXIT_PRECHECK}" "rpc endpoint is not ready at http://127.0.0.1:${RPC_PORT}/healthz/ready"
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
  local candidate cached_address generated derived_address
  candidate="${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-${FIBER_WITHDRAW_CKB_PRIVATE_KEY:-}}"
  if [[ -z "${candidate}" ]]; then
    candidate="$(get_env_value FIBER_WITHDRAWAL_CKB_PRIVATE_KEY)"
  fi

  if [[ -z "${candidate}" && -s "${WITHDRAWAL_SIGNER_CACHE_PATH}" ]]; then
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

  request_ckb_faucet_for_address "${WITHDRAWAL_SIGNER_ADDRESS}" "withdrawal-signer"
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
  curl -fsS "http://127.0.0.1:${RPC_PORT}/rpc" \
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

request_withdrawal_via_rpc() {
  local user_id="$1"
  local to_address="$2"
  local amount="$3"
  local req_file="${ARTIFACTS_DIR}/flow2-withdrawal-request.request.json"
  local resp_file="${ARTIFACTS_DIR}/flow2-withdrawal-request.response.json"
  local payload response nonce

  payload="$(jq -cn \
    --arg id "withdraw-request-$(date +%s)-$RANDOM" \
    --arg userId "${user_id}" \
    --arg amount "${amount}" \
    --arg toAddress "${to_address}" \
    '{jsonrpc:"2.0",id:$id,method:"withdrawal.request",params:{userId:$userId,asset:"CKB",amount:$amount,toAddress:$toAddress}}')"
  printf '%s\n' "${payload}" > "${req_file}"

  nonce="withdraw-request-$(date +%s)-$RANDOM"
  response="$(rpc_call_signed "${payload}" "${nonce}")" \
    || fatal "${EXIT_WITHDRAWAL}" "withdrawal.request transport failed"
  printf '%s\n' "${response}" > "${resp_file}"

  if printf '%s' "${response}" | jq -e '.error != null' >/dev/null 2>&1; then
    local message
    message="$(printf '%s' "${response}" | jq -r '.error.message // "unknown json-rpc error"')"
    fatal "${EXIT_WITHDRAWAL}" "withdrawal.request failed: ${message}"
  fi

  WITHDRAWAL_ID="$(printf '%s' "${response}" | jq -r '.result.id // empty')"
  [[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_WITHDRAWAL}" "withdrawal.request returned empty id"
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
    docker compose \
      --env-file "${COMPOSE_ENV_FILE}" \
      -f "${COMPOSE_FILE}" \
      up -d --no-deps --force-recreate worker
  ) > "${LOGS_DIR}/worker-${strategy}.log" 2>&1 \
    || fatal "${EXIT_PRECHECK}" "failed to restart worker with strategy=${strategy}"

  wait_container_healthy fiber-link-worker 180 \
    || fatal "${EXIT_PRECHECK}" "worker did not become healthy after strategy=${strategy}"
}

run_phase1_with_flow12() {
  local pause_cmd=(
    env
    "WORKFLOW_ARTIFACT_DIR=${PHASE1_DIR}"
    "WORKFLOW_RESULT_METADATA_PATH=${PHASE1_METADATA_PATH}"
    scripts/local-workflow-automation.sh
    --verbose
    --with-ember-cli
    --pause-at-step4
    --skip-withdrawal
  )

  if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
    pause_cmd+=(--skip-services)
  fi
  if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
    pause_cmd+=(--skip-discourse)
  fi

  local pause_cmd_escaped
  pause_cmd_escaped="$(printf '%q ' "${pause_cmd[@]}")"

  export ROOT_DIR
  export PAUSE_CMD_ESCAPED="${pause_cmd_escaped}"
  export FLOW12_DIR
  export FLOW12_HEADED="${HEADED}"
  export FLOW12_URL="${DISCOURSE_UI_BASE_URL}"

  record_cmd "expect phase1+flow12"
  set +e
  expect <<'EXPECT' 2>&1 | tee "${LOGS_DIR}/phase1.pause.log"
set timeout -1
set ran_flow12 0

spawn -noecho bash -lc "cd \"$env(ROOT_DIR)\" && $env(PAUSE_CMD_ESCAPED)"

while {1} {
  expect {
    -re "Press Enter to continue workflow\\.\\.\\." {
      set ran_flow12 1
      puts ""
      puts {[e2e-four-flows] pause reached; running flow1/flow2 playwright step...}
      puts ""
      set rc [catch {
        exec env PW_FLOW12_ARTIFACT_DIR=$env(FLOW12_DIR) PW_FLOW12_HEADED=$env(FLOW12_HEADED) PW_FLOW12_URL=$env(FLOW12_URL) $env(ROOT_DIR)/scripts/playwright-workflow-flow12.sh 2>@1
      } out]
      puts $out
      if {$rc != 0} {
        puts stderr {[e2e-four-flows] flow12 playwright step failed.}
        exit 97
      }
      send "\003"
      exp_continue
    }
    eof {
      break
    }
  }
}

if {$ran_flow12 == 0} {
  puts stderr {[e2e-four-flows] did not reach pause-at-step4 prompt.}
  exit 96
}

exit 0
EXPECT
  local rc=$?
  set -e

  [[ "${rc}" -eq 0 ]] || fatal "${EXIT_FLOW12}" "phase1 pause+flow12 failed (see ${LOGS_DIR}/phase1.pause.log)"
}

run_phase2_subscription() {
  local cmd=(
    env
    "WORKFLOW_ARTIFACT_DIR=${PHASE2_DIR}"
    "WORKFLOW_RESULT_METADATA_PATH=${PHASE2_METADATA_PATH}"
    scripts/local-workflow-automation.sh
    --verbose
    --with-ember-cli
    --skip-services
    --skip-discourse
    --skip-withdrawal
  )

  record_cmd "${cmd[*]}"
  (cd "${ROOT_DIR}" && "${cmd[@]}") 2>&1 | tee "${LOGS_DIR}/phase2.subscription.log" >/dev/null \
    || fatal "${EXIT_PHASE2}" "phase2 subscription workflow failed"
}

run_postcheck_with_withdrawal() {
  local cmd=(
    env
    "PW_DEMO_HEADED=${HEADED}"
    "PW_DEMO_URL=${DISCOURSE_UI_BASE_URL}"
    "PW_DEMO_SESSION=fiber-workflow-postcheck-${TIMESTAMP}"
    "PW_DEMO_ARTIFACT_DIR=${POSTCHECK_DIR}"
    "PW_DEMO_WITHDRAWAL_ID=${WITHDRAWAL_ID}"
    "PW_DEMO_WITHDRAW_AMOUNT=${WORKFLOW_WITHDRAW_AMOUNT:-61}"
    "PW_DEMO_WITHDRAW_TO_ADDRESS=${WITHDRAW_TO_ADDRESS}"
    "PW_DEMO_INITIATE_WITHDRAWAL=0"
    scripts/playwright-workflow-postcheck.sh
  )

  record_cmd "${cmd[*]}"
  (cd "${ROOT_DIR}" && "${cmd[@]}") > "${LOGS_DIR}/postcheck.log" 2>&1 \
    || fatal "${EXIT_POSTCHECK}" "postcheck flow failed"
}

run_polling_mode_verification() {
  local polling_app_id="${APP_ID}-polling"
  local cmd=(
    env
    "FIBER_LINK_APP_ID=${polling_app_id}"
    "WORKFLOW_ARTIFACT_DIR=${POLLING_DIR}"
    "WORKFLOW_RESULT_METADATA_PATH=${POLLING_METADATA_PATH}"
    scripts/local-workflow-automation.sh
    --verbose
    --skip-services
    --skip-discourse
    --skip-withdrawal
  )

  set_worker_strategy polling
  record_cmd "${cmd[*]}"
  set +e
  (cd "${ROOT_DIR}" && "${cmd[@]}") 2>&1 | tee "${LOGS_DIR}/phase-polling.log" >/dev/null
  local rc=${PIPESTATUS[0]}
  set -e
  set_worker_strategy subscription
  [[ "${rc}" -eq 0 ]] || fatal "${EXIT_POLLING}" "polling settlement verification flow failed"
}

write_checklist() {
  local overall_status="$1"
  local note="$2"
  mkdir -p "${STATUS_DIR}"
  cat > "${STATUS_DIR}/verification-checklist.md" <<CHECKLIST
# E2E Discourse Four Flows Checklist

- Overall status: ${overall_status}
- Note: ${note}
- Artifact directory: ${ARTIFACT_DIR}

## Required Screenshots
- [ ] screenshots/flow1-tip-button.png
- [ ] screenshots/flow1-tip-modal-invoice.png
- [ ] screenshots/flow4-author-balance-history.png
- [ ] screenshots/flow4-admin-withdrawal.png
- [ ] screenshots/flow4-explorer-withdrawal-tx.png

## Required Evidence
- [ ] artifacts/flow2-rpc-calls.json
- [ ] artifacts/flow3-subscription.json
- [ ] artifacts/flow3-polling.json
- [ ] artifacts/summary.json
CHECKLIST
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-services)
      SKIP_SERVICES=1
      ;;
    --skip-discourse)
      SKIP_DISCOURSE=1
      ;;
    --headless)
      HEADED=0
      ;;
    --artifact-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      ARTIFACT_DIR="$2"
      shift
      ;;
    --settlement-modes)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SETTLEMENT_MODES="$2"
      shift
      ;;
    --explorer-tx-url-template)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      EXPLORER_TX_URL_TEMPLATE="$2"
      shift
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
      exit "${EXIT_USAGE}"
      ;;
  esac
  shift
done

refresh_paths

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

if [[ -z "${EXPLORER_TX_URL_TEMPLATE}" ]]; then
  fatal "${EXIT_USAGE}" "E2E_EXPLORER_TX_URL_TEMPLATE/--explorer-tx-url-template is required"
fi

mkdir -p "${ARTIFACT_DIR}" "${SCREENSHOT_DIR}" "${ARTIFACTS_DIR}" "${STATUS_DIR}" "${LOGS_DIR}" "${COMMANDS_DIR}" \
  "${PHASE1_DIR}" "${PHASE2_DIR}" "${POLLING_DIR}" "${FLOW12_DIR}" "${POSTCHECK_DIR}" "${EXPLORER_DIR}"

: > "${COMMAND_LOG}"

require_cmd jq
require_cmd awk
require_cmd expect
require_cmd curl
require_cmd openssl
require_cmd docker

[[ -f "${COMPOSE_ENV_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing compose env file: ${COMPOSE_ENV_FILE}"
[[ -f "${COMPOSE_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing compose file: ${COMPOSE_FILE}"

APP_SECRET="${FIBER_LINK_APP_SECRET:-}"
if [[ -z "${APP_SECRET}" ]]; then
  APP_SECRET="$(get_env_value FIBER_LINK_HMAC_SECRET)"
fi
[[ -n "${APP_SECRET}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_LINK_HMAC_SECRET/FIBER_LINK_APP_SECRET is required"

if [[ -z "${FIBER_LINK_APP_ID:-}" ]]; then
  export FIBER_LINK_APP_ID="e2e-four-flows-${TIMESTAMP}"
fi
APP_ID="${FIBER_LINK_APP_ID}"

log "artifacts: ${ARTIFACT_DIR}"
log "app id: ${APP_ID}"
log "settlement modes: ${SETTLEMENT_MODES}"

if [[ "${RUN_SUBSCRIPTION}" -eq 1 ]]; then
  run_phase1_with_flow12

  if load_result_metadata "${PHASE1_METADATA_PATH}"; then
    phase1_seed_path="${WORKFLOW_RESULT_SEED_JSON_PATH:-${PHASE1_DIR}/discourse-seed.json}"
  else
    phase1_seed_path="${PHASE1_DIR}/discourse-seed.json"
  fi
  if [[ -f "${phase1_seed_path}" ]]; then
    TIPPER_USER_ID="$(jq -r '.tipper.id // empty' "${phase1_seed_path}")"
    AUTHOR_USER_ID="$(jq -r '.author.id // empty' "${phase1_seed_path}")"
    TOPIC_POST_ID="$(jq -r '.topic.first_post_id // empty' "${phase1_seed_path}")"
    REPLY_POST_ID="$(jq -r '.reply.post_id // empty' "${phase1_seed_path}")"
  else
    TIPPER_USER_ID="${WORKFLOW_TIPPER_USER_ID:-}"
    AUTHOR_USER_ID="${WORKFLOW_AUTHOR_USER_ID:-}"
    TOPIC_POST_ID="${WORKFLOW_TOPIC_POST_ID:-}"
    REPLY_POST_ID="${WORKFLOW_REPLY_POST_ID:-}"
  fi
  [[ -n "${TIPPER_USER_ID}" && -n "${AUTHOR_USER_ID}" && -n "${TOPIC_POST_ID}" && -n "${REPLY_POST_ID}" ]] \
    || fatal "${EXIT_FLOW12}" "failed to resolve required workflow IDs"

  export WORKFLOW_TIPPER_USER_ID="${TIPPER_USER_ID}"
  export WORKFLOW_AUTHOR_USER_ID="${AUTHOR_USER_ID}"
  export WORKFLOW_TOPIC_POST_ID="${TOPIC_POST_ID}"
  export WORKFLOW_REPLY_POST_ID="${REPLY_POST_ID}"

  FLOW12_RESULT_JSON="$(extract_result_json "${FLOW12_DIR}/playwright-flow12-result.log" || true)"
  [[ -n "${FLOW12_RESULT_JSON}" ]] || fatal "${EXIT_FLOW12}" "missing flow12 result payload"

  run_phase2_subscription

  phase2_summary_path="${PHASE2_DIR}/summary.json"
  [[ -f "${phase2_summary_path}" ]] || fatal "${EXIT_PHASE2}" "missing phase2 summary: ${phase2_summary_path}"
  WITHDRAW_TO_ADDRESS="$(jq -r '.withdrawal.destinationAddress // empty' "${phase2_summary_path}")"
  [[ -n "${WITHDRAW_TO_ADDRESS}" ]] || fatal "${EXIT_PHASE2}" "missing withdrawal destination address in phase2 summary"

  ensure_withdrawal_signer_private_key
  set_worker_strategy subscription
  resolve_runtime_rpc_port
  request_withdrawal_via_rpc "${AUTHOR_USER_ID}" "${WITHDRAW_TO_ADDRESS}" "${WORKFLOW_WITHDRAW_AMOUNT:-61}"

  run_postcheck_with_withdrawal
  POSTCHECK_RESULT_JSON="$(extract_result_json "${POSTCHECK_DIR}/playwright-postcheck-result.log" || true)"
  [[ -n "${POSTCHECK_RESULT_JSON}" ]] || fatal "${EXIT_POSTCHECK}" "missing postcheck result payload"

  postcheck_error="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.error // empty')"
  [[ -z "${postcheck_error}" ]] || fatal "${EXIT_POSTCHECK}" "postcheck returned error: ${postcheck_error}"

  postcheck_withdrawal_id="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.withdrawalId // empty')"
  if [[ -n "${postcheck_withdrawal_id}" ]]; then
    WITHDRAWAL_ID="${postcheck_withdrawal_id}"
  fi
  AUTHOR_BALANCE="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.authorBalance // empty')"
  AUTHOR_TIP_HISTORY_COUNT="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.authorTipHistoryCount // empty')"
  [[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_POSTCHECK}" "postcheck did not return withdrawal id"

  resolve_runtime_rpc_port

  if ! wait_withdrawal_completed "${WITHDRAWAL_ID}" 420; then
    if [[ "${WITHDRAWAL_STATE}" == "FAILED" ]]; then
      fatal "${EXIT_WITHDRAWAL}" "withdrawal ${WITHDRAWAL_ID} reached FAILED"
    fi
    fatal "${EXIT_WITHDRAWAL}" "timeout waiting withdrawal ${WITHDRAWAL_ID} completion"
  fi

  [[ -n "${WITHDRAWAL_TX_HASH}" ]] || fatal "${EXIT_WITHDRAWAL}" "completed withdrawal ${WITHDRAWAL_ID} missing tx hash"

  explorer_cmd=(
    env
    "PW_EXPLORER_TX_HASH=${WITHDRAWAL_TX_HASH}"
    "PW_EXPLORER_TX_URL_TEMPLATE=${EXPLORER_TX_URL_TEMPLATE}"
    "PW_EXPLORER_ARTIFACT_DIR=${EXPLORER_DIR}"
    scripts/playwright-workflow-explorer-proof.sh
  )
  record_cmd "${explorer_cmd[*]}"
  (cd "${ROOT_DIR}" && "${explorer_cmd[@]}") > "${LOGS_DIR}/explorer.log" 2>&1 \
    || fatal "${EXIT_EXPLORER}" "failed to capture explorer screenshot"
  EXPLORER_RESULT_JSON="$(extract_result_json "${EXPLORER_DIR}/playwright-explorer-result.log" || true)"
  [[ -n "${EXPLORER_RESULT_JSON}" ]] || fatal "${EXIT_EXPLORER}" "missing explorer result payload"

  copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-button.png" "${SCREENSHOT_DIR}/flow1-tip-button.png"
  copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-modal-invoice.png" "${SCREENSHOT_DIR}/flow1-tip-modal-invoice.png"
  copy_or_fail "${POSTCHECK_DIR}/playwright-step5-author-dashboard.png" "${SCREENSHOT_DIR}/flow4-author-balance-history.png"
  copy_or_fail "${POSTCHECK_DIR}/playwright-step7-admin-withdrawal.png" "${SCREENSHOT_DIR}/flow4-admin-withdrawal.png"
  copy_or_fail "${EXPLORER_DIR}/playwright-flow4-explorer-withdrawal-tx.png" "${SCREENSHOT_DIR}/flow4-explorer-withdrawal-tx.png"

  flow2_tip_create_req="$(json_or_null "${PHASE2_DIR}/tips/topic-post/tip-create.request.json")"
  flow2_tip_create_resp="$(json_or_null "${PHASE2_DIR}/tips/topic-post/tip-create.response.json")"
  flow2_tip_status_resp="$(last_json_line_or_null "${PHASE2_DIR}/tips/topic-post/tip-status.poll.log")"
  flow2_dashboard_resp="$(json_or_null "${PHASE2_DIR}/author-dashboard.json")"
  flow2_withdraw_req="$(json_or_null "${ARTIFACTS_DIR}/flow2-withdrawal-request.request.json")"
  flow2_withdraw_resp="$(json_or_null "${ARTIFACTS_DIR}/flow2-withdrawal-request.response.json")"

  jq -n \
    --argjson tipCreateRequest "${flow2_tip_create_req}" \
    --argjson tipCreateResponse "${flow2_tip_create_resp}" \
    --argjson tipStatusResponse "${flow2_tip_status_resp}" \
    --argjson dashboardSummaryResponse "${flow2_dashboard_resp}" \
    --argjson withdrawalRequestRequest "${flow2_withdraw_req}" \
    --argjson withdrawalRequestResponse "${flow2_withdraw_resp}" \
    '{
      methods: {
        "tip.create": {
          request: $tipCreateRequest,
          response: $tipCreateResponse,
          ok: (($tipCreateResponse.result.invoice // "") != "")
        },
        "tip.status": {
          request: ($tipStatusResponse.id // null),
          response: $tipStatusResponse,
          ok: (($tipStatusResponse.result.state // "") != "")
        },
        "dashboard.summary": {
          request: ($dashboardSummaryResponse.id // null),
          response: $dashboardSummaryResponse,
          ok: (($dashboardSummaryResponse.result.balance // "") != "")
        },
        "withdrawal.request": {
          request: $withdrawalRequestRequest,
          response: $withdrawalRequestResponse,
          ok: (($withdrawalRequestResponse.result.id // "") != "")
        }
      }
    }' > "${ARTIFACTS_DIR}/flow2-rpc-calls.json"

  subscription_topic_settled=false
  subscription_reply_settled=false
  if assert_tip_log_settled "${PHASE2_DIR}/tips/topic-post/tip-status.poll.log"; then
    subscription_topic_settled=true
  fi
  if assert_tip_log_settled "${PHASE2_DIR}/tips/reply-post/tip-status.poll.log"; then
    subscription_reply_settled=true
  fi

  jq -n \
    --arg mode "subscription" \
    --arg artifactDir "${PHASE2_DIR}" \
    --argjson topicSettled "${subscription_topic_settled}" \
    --argjson replySettled "${subscription_reply_settled}" \
    '{
      mode: $mode,
      artifactDir: $artifactDir,
      checks: {
        topicPostSettled: $topicSettled,
        replyPostSettled: $replySettled,
        pass: ($topicSettled and $replySettled)
      }
    }' > "${ARTIFACTS_DIR}/flow3-subscription.json"
fi

if [[ "${RUN_POLLING}" -eq 1 ]]; then
  if [[ -z "${AUTHOR_USER_ID}" || -z "${TIPPER_USER_ID}" || -z "${TOPIC_POST_ID}" || -z "${REPLY_POST_ID}" ]]; then
    AUTHOR_USER_ID="${WORKFLOW_AUTHOR_USER_ID:-}"
    TIPPER_USER_ID="${WORKFLOW_TIPPER_USER_ID:-}"
    TOPIC_POST_ID="${WORKFLOW_TOPIC_POST_ID:-}"
    REPLY_POST_ID="${WORKFLOW_REPLY_POST_ID:-}"
  fi
  [[ -n "${AUTHOR_USER_ID}" && -n "${TIPPER_USER_ID}" && -n "${TOPIC_POST_ID}" && -n "${REPLY_POST_ID}" ]] \
    || fatal "${EXIT_POLLING}" "polling mode requires workflow IDs (run subscription mode first or export WORKFLOW_* IDs)"
  run_polling_mode_verification

  polling_topic_settled=false
  polling_reply_settled=false
  if assert_tip_log_settled "${POLLING_DIR}/tips/topic-post/tip-status.poll.log"; then
    polling_topic_settled=true
  fi
  if assert_tip_log_settled "${POLLING_DIR}/tips/reply-post/tip-status.poll.log"; then
    polling_reply_settled=true
  fi

  jq -n \
    --arg mode "polling" \
    --arg artifactDir "${POLLING_DIR}" \
    --argjson topicSettled "${polling_topic_settled}" \
    --argjson replySettled "${polling_reply_settled}" \
    '{
      mode: $mode,
      artifactDir: $artifactDir,
      checks: {
        topicPostSettled: $topicSettled,
        replyPostSettled: $replySettled,
        pass: ($topicSettled and $replySettled)
      }
    }' > "${ARTIFACTS_DIR}/flow3-polling.json"
fi

flow1_ok=true
flow2_ok=true
flow3_sub_ok=true
flow3_poll_ok=true
flow4_ok=true

if [[ "${RUN_SUBSCRIPTION}" -eq 1 ]]; then
  flow1_ok="$(printf '%s' "${FLOW12_RESULT_JSON:-null}" | jq -r '
    if . == null then
      false
    else
      ((.screenshots.tipButton // "") != "")
      and ((.screenshots.tipModal // "") != "")
      and ((.rpc.dashboardSummary.ok // false) == true)
    end
  ')"
  flow2_ok="$(jq -r '.methods | to_entries | all(.value.ok == true)' "${ARTIFACTS_DIR}/flow2-rpc-calls.json" 2>/dev/null || printf 'false')"
  flow3_sub_ok="$(jq -r '.checks.pass // false' "${ARTIFACTS_DIR}/flow3-subscription.json" 2>/dev/null || printf 'false')"
  flow4_ok=false
  if [[ -n "${WITHDRAWAL_ID}" && "${WITHDRAWAL_STATE}" == "COMPLETED" && -n "${WITHDRAWAL_TX_HASH}" ]]; then
    flow4_ok=true
  fi
fi

if [[ "${RUN_POLLING}" -eq 1 ]]; then
  flow3_poll_ok="$(jq -r '.checks.pass // false' "${ARTIFACTS_DIR}/flow3-polling.json" 2>/dev/null || printf 'false')"
fi

summary_file="${ARTIFACTS_DIR}/summary.json"
jq -n \
  --arg artifactDir "${ARTIFACT_DIR}" \
  --arg appId "${APP_ID}" \
  --arg withdrawalId "${WITHDRAWAL_ID}" \
  --arg withdrawalState "${WITHDRAWAL_STATE}" \
  --arg withdrawalTxHash "${WITHDRAWAL_TX_HASH}" \
  --arg authorBalance "${AUTHOR_BALANCE}" \
  --arg authorTipHistoryCount "${AUTHOR_TIP_HISTORY_COUNT}" \
  --arg explorerUrl "$(printf '%s' "${EXPLORER_RESULT_JSON:-null}" | jq -r '.explorerUrl // empty')" \
  --argjson flow1Ok "${flow1_ok}" \
  --argjson flow2Ok "${flow2_ok}" \
  --argjson flow3SubscriptionOk "${flow3_sub_ok}" \
  --argjson flow3PollingOk "${flow3_poll_ok}" \
  --argjson flow4Ok "${flow4_ok}" \
  '{
    artifactDir: $artifactDir,
    appId: $appId,
    flows: {
      flow1TipUi: {
        ok: $flow1Ok,
        screenshots: {
          tipButton: "screenshots/flow1-tip-button.png",
          tipModal: "screenshots/flow1-tip-modal-invoice.png"
        }
      },
      flow2BackendInterfaces: {
        ok: $flow2Ok,
        evidence: "artifacts/flow2-rpc-calls.json"
      },
      flow3Settlement: {
        subscription: {
          ok: $flow3SubscriptionOk,
          evidence: "artifacts/flow3-subscription.json"
        },
        polling: {
          ok: $flow3PollingOk,
          evidence: "artifacts/flow3-polling.json"
        }
      },
      flow4CreatorPanelAndWithdrawal: {
        ok: $flow4Ok,
        authorBalance: $authorBalance,
        authorTipHistoryCount: $authorTipHistoryCount,
        withdrawalId: $withdrawalId,
        withdrawalState: $withdrawalState,
        withdrawalTxHash: $withdrawalTxHash,
        explorerUrl: $explorerUrl,
        screenshots: {
          authorBalanceHistory: "screenshots/flow4-author-balance-history.png",
          adminWithdrawal: "screenshots/flow4-admin-withdrawal.png",
          explorerTx: "screenshots/flow4-explorer-withdrawal-tx.png"
        }
      }
    }
  }' > "${summary_file}"

overall_ok=false
if [[ "${flow1_ok}" == "true" && "${flow2_ok}" == "true" && "${flow3_sub_ok}" == "true" && "${flow3_poll_ok}" == "true" && "${flow4_ok}" == "true" ]]; then
  overall_ok=true
fi

if [[ "${overall_ok}" == "true" ]]; then
  write_checklist "PASS" "all four flows passed"
  printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${ARTIFACT_DIR}" "${summary_file}"
  exit "${EXIT_OK}"
fi

fatal "${EXIT_ARTIFACT}" "flow verification failed (see ${summary_file})"
