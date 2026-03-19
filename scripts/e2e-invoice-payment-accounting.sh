#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_STARTUP_TIMEOUT=11
EXIT_FAUCET_FAILURE=12
EXIT_INVOICE_FAILURE=13
EXIT_PAYMENT_FAILURE=14
EXIT_SETTLEMENT_FAILURE=15
EXIT_INSUFFICIENT_BALANCE=16
EXIT_CLEANUP_FAILURE=17
EXIT_CHANNEL_BOOTSTRAP_FAILURE=18

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/deploy/compose"
ENV_FILE="${ENV_FILE:-${COMPOSE_ENV_FILE:-${COMPOSE_DIR}/.env}}"
ARTIFACT_DIR="${ROOT_DIR}/.tmp/e2e-invoice-payment-accounting/$(date -u +%Y%m%dT%H%M%SZ)"
SUMMARY_FILE="${ARTIFACT_DIR}/summary.tsv"
HOST_ACCESS_HOST="${E2E_HOST_ACCESS_HOST:-127.0.0.1}"
HOST_ACCESS_BASE_URL="${E2E_HOST_ACCESS_BASE_URL:-http://${HOST_ACCESS_HOST}}"

# Normalize PATH for non-interactive shells (expect/CI) so modern Node/Bun are found first.
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  latest_nvm_bin="$(ls -d "${HOME}"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
  if [[ -n "${latest_nvm_bin}" ]]; then
    PATH="${latest_nvm_bin}:${PATH}"
  fi
fi
if [[ -x "/opt/homebrew/bin/node" ]]; then
  PATH="/opt/homebrew/bin:${PATH}"
fi
if [[ -x "${HOME}/.bun/bin/bun" ]]; then
  PATH="${HOME}/.bun/bin:${PATH}"
fi
export PATH

WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-600}"
SETTLEMENT_TIMEOUT_SECONDS="${SETTLEMENT_TIMEOUT_SECONDS:-180}"
SETTLEMENT_POLL_INTERVAL_SECONDS="${SETTLEMENT_POLL_INTERVAL_SECONDS:-5}"
CHANNEL_READY_TIMEOUT_SECONDS="${CHANNEL_READY_TIMEOUT_SECONDS:-600}"
CHANNEL_POLL_INTERVAL_SECONDS="${CHANNEL_POLL_INTERVAL_SECONDS:-5}"
COMPOSE_UP_TIMEOUT_SECONDS="${COMPOSE_UP_TIMEOUT_SECONDS:-600}"

APP_ID="${E2E_APP_ID:-local-dev}"
CKB_PAYMENT_AMOUNT="${E2E_CKB_PAYMENT_AMOUNT:-1}"
USDI_PAYMENT_AMOUNT="${E2E_USDI_PAYMENT_AMOUNT:-1}"

CKB_TOPUP_ADDRESS="${E2E_CKB_TOPUP_ADDRESS:-}"
CKB_INVOICE_NODE_TOPUP_ADDRESS="${E2E_CKB_INVOICE_TOPUP_ADDRESS:-}"
USDI_TOPUP_ADDRESS="${E2E_USDI_TOPUP_ADDRESS:-}"

CKB_FAUCET_API_BASE="${CKB_FAUCET_API_BASE:-https://faucet-api.nervos.org}"
CKB_FAUCET_FALLBACK_API_BASE="${CKB_FAUCET_FALLBACK_API_BASE:-https://ckb-utilities.random-walk.co.jp/api}"
CKB_FAUCET_ENABLE_FALLBACK="${CKB_FAUCET_ENABLE_FALLBACK:-1}"
CKB_FAUCET_AMOUNT="${CKB_FAUCET_AMOUNT:-100000}"
CKB_FAUCET_WAIT_SECONDS="${CKB_FAUCET_WAIT_SECONDS:-20}"
CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS="${CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS:-180}"
CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS="${CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS:-5}"
CKB_PAYMENT_FAUCET_ON_FLOW="${E2E_CKB_PAYMENT_FAUCET_ON_FLOW:-0}"
CKB_RPC_URL="${E2E_CKB_RPC_URL:-https://testnet.ckbapp.dev/}"
CKB_BALANCE_CHECK_LIMIT_PAGES="${E2E_CKB_BALANCE_CHECK_LIMIT_PAGES:-20}"
USDI_BALANCE_CHECK_LIMIT_PAGES="${E2E_USDI_BALANCE_CHECK_LIMIT_PAGES:-20}"
NODE_INFO_DERIVE_RETRIES="${NODE_INFO_DERIVE_RETRIES:-30}"
NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS="${NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS:-2}"

USDI_FAUCET_COMMAND="${E2E_USDI_FAUCET_COMMAND:-}"
USDI_FAUCET_AMOUNT="${USDI_FAUCET_AMOUNT:-20}"
USDI_FAUCET_WAIT_SECONDS="${USDI_FAUCET_WAIT_SECONDS:-20}"
USDI_CHANNEL_FUNDING_AMOUNT="${E2E_USDI_CHANNEL_FUNDING_AMOUNT:-}"

CHANNEL_FUNDING_AMOUNT="${E2E_CHANNEL_FUNDING_AMOUNT:-10000000000}"
CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS="${E2E_CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS:-0x4B0}"
TOPUP_INVOICE_NODE_CKB="${E2E_TOPUP_INVOICE_NODE_CKB:-0}"
SKIP_CKB_FAUCET="${E2E_SKIP_CKB_FAUCET:-0}"
ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX="${E2E_ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX:-}"
OPEN_CHANNEL_INIT_RETRIES="${E2E_OPEN_CHANNEL_INIT_RETRIES:-10}"
OPEN_CHANNEL_INIT_RETRY_INTERVAL_SECONDS="${E2E_OPEN_CHANNEL_INIT_RETRY_INTERVAL_SECONDS:-2}"
CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS="${E2E_CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS:-6}"

STARTED_COMPOSE=0
KEEP_STACK_UP=0
VERBOSE=0
PREPARE_ONLY=0
FINALIZED=0

RPC_PORT="${RPC_PORT:-}"
FNN_INVOICE_RPC_PORT="${FNN_INVOICE_RPC_PORT:-}"
FNN_PAYER_RPC_PORT="${FNN_PAYER_RPC_PORT:-}"

INVOICE_NODE_CONTAINER="fiber-link-fnn"
PAYER_NODE_CONTAINER="fiber-link-fnn2"
INVOICE_NODE_ID=""
PAYER_NODE_ID=""
INVOICE_PEER_ID=""
PAYER_PEER_ID=""
PAYER_LOCK_SCRIPT_JSON=""
INVOICE_LOCK_SCRIPT_JSON=""
USDI_TYPE_SCRIPT_JSON=""
DETECTED_USDI_CURRENCY=""
USDI_AUTO_ACCEPT_AMOUNT_HEX=""

NODE_INFO_RESULT=""
OPEN_CHANNEL_TEMPORARY_ID=""
CREATE_INVOICE_RESULT=""
PAY_INVOICE_RESULT=""
SETTLEMENT_RESULT=""

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-invoice-payment-accounting.sh [--keep-up] [--prepare-only] [--verbose]

Flow (full e2e):
1) docker compose start services (includes 2 FNN nodes)
2) derive/confirm top-up addresses
3) CKB balance precheck + faucet top-up when needed + establish channel between fnn2(payer) -> fnn(invoice)
4) create invoice (CKB + USDI)
5) pay invoice from fnn2
6) poll tip.status until SETTLED

Flow (--prepare-only):
1) docker compose start services
2) derive/confirm top-up addresses
3) CKB balance precheck + faucet top-up when needed + establish channel between fnn2 and fnn
4) keep stack up for manual testing (use with --keep-up)

Required env:
  E2E_CKB_TOPUP_ADDRESS       payer(FNN2) CKB top-up address (optional if derivable from node_info)
  E2E_CKB_INVOICE_TOPUP_ADDRESS  invoice node(FNN1) CKB top-up address (optional if derivable)
  E2E_USDI_TOPUP_ADDRESS      payer(FNN2) USDI top-up address (optional, defaults to E2E_CKB_TOPUP_ADDRESS)
  E2E_USDI_FAUCET_COMMAND     Optional override command for USDI faucet request

Optional env:
  E2E_APP_ID=local-dev
  E2E_CKB_PAYMENT_AMOUNT=1
  E2E_USDI_PAYMENT_AMOUNT=1
  FIBER_INVOICE_CURRENCY_CKB=Fibt
  CKB_FAUCET_API_BASE=https://faucet-api.nervos.org
  CKB_FAUCET_FALLBACK_API_BASE=https://ckb-utilities.random-walk.co.jp/api
  CKB_FAUCET_ENABLE_FALLBACK=1
  CKB_FAUCET_AMOUNT=100000
  CKB_FAUCET_WAIT_SECONDS=20
  CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS=180
  CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS=5
  E2E_CKB_PAYMENT_FAUCET_ON_FLOW=0  # 0=precheck and topup only when needed, 1=always request faucet on CKB payment flow
  E2E_CKB_RPC_URL=https://testnet.ckbapp.dev/
  E2E_CKB_BALANCE_CHECK_LIMIT_PAGES=20
  E2E_USDI_BALANCE_CHECK_LIMIT_PAGES=20
  NODE_INFO_DERIVE_RETRIES=30
  NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS=2
  E2E_USDI_CHANNEL_FUNDING_AMOUNT=<auto from fnn node_info.udt_cfg_infos[].auto_accept_amount>
  # default when E2E_USDI_FAUCET_COMMAND is unset:
  # curl -fsS -X POST https://ckb-utilities.random-walk.co.jp/api/faucet \
  #   -H "content-type: application/json" \
  #   -d "{\"address\":\"${E2E_FAUCET_ADDRESS}\",\"token\":\"usdi\"}"
  USDI_FAUCET_AMOUNT=20
  USDI_FAUCET_WAIT_SECONDS=20
  E2E_CHANNEL_FUNDING_AMOUNT=10000000000
  E2E_CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS=0x4B0
  E2E_ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX=<auto from invoice node_info>
  E2E_OPEN_CHANNEL_INIT_RETRIES=10
  E2E_OPEN_CHANNEL_INIT_RETRY_INTERVAL_SECONDS=2
  E2E_CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS=6
  E2E_TOPUP_INVOICE_NODE_CKB=0
  E2E_SKIP_CKB_FAUCET=0
  CHANNEL_READY_TIMEOUT_SECONDS=600
  CHANNEL_POLL_INTERVAL_SECONDS=5
  WAIT_TIMEOUT_SECONDS=600
  COMPOSE_UP_TIMEOUT_SECONDS=600
  SETTLEMENT_TIMEOUT_SECONDS=180
  SETTLEMENT_POLL_INTERVAL_SECONDS=5

Exit codes:
  0  PASS
  2  invalid usage
  10 precheck failure
  11 startup timeout
  12 faucet failure
  13 invoice creation failure
  14 payment failure
  15 settlement confirmation failure
  16 insufficient balance
  17 cleanup failure
  18 channel bootstrap failure
USAGE
}

log() {
  printf '[e2e-invoice] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

is_positive_integer() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]] && [[ "${value}" -gt 0 ]]
}

compose() {
  (cd "${COMPOSE_DIR}" && docker compose "$@")
}

reset_compose_stack() {
  compose down -v --remove-orphans > "${ARTIFACT_DIR}/compose-down-reset.log" 2>&1 || true
}

is_tcp_port_listening() {
  local port="$1"
  node -e 'const net = require("node:net");
const port = Number(process.argv[1]);
if (!Number.isInteger(port) || port <= 0) process.exit(1);
const socket = new net.Socket();
const finish = (code) => {
  socket.destroy();
  process.exit(code);
};
socket.setTimeout(500);
socket.once("connect", () => finish(0));
socket.once("timeout", () => finish(1));
socket.once("error", () => finish(1));
socket.connect(port, process.argv[2] || "127.0.0.1");' "${port}" "${HOST_ACCESS_HOST}"
}

listener_hint_for_port() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    printf ''
    return
  fi
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1 "/" $2 " " $9; exit}'
}

find_free_rpc_port() {
  local candidate
  local candidates=(3000 3001 3002 13001 13002 13003 13004 13005)
  for candidate in "${candidates[@]}"; do
    if [[ "${candidate}" == "${RPC_PORT}" ]]; then
      continue
    fi
    if ! is_tcp_port_listening "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  return 1
}

ensure_rpc_port_available() {
  local requested_port="${RPC_PORT}"
  local existing_rpc_host_port
  existing_rpc_host_port="$(
    docker port fiber-link-rpc 3000/tcp 2>/dev/null | awk -F: 'NR==1 {print $NF}' || true
  )"

  if ! is_tcp_port_listening "${requested_port}"; then
    export RPC_PORT
    return 0
  fi

  if [[ -n "${existing_rpc_host_port}" && "${existing_rpc_host_port}" == "${requested_port}" ]]; then
    vlog "RPC_PORT=${requested_port} already served by existing fiber-link-rpc container"
    export RPC_PORT
    return 0
  fi

  local fallback_port
  fallback_port="$(find_free_rpc_port)" \
    || fatal "${EXIT_PRECHECK}" "RPC_PORT=${requested_port} is occupied and no fallback port was found"

  local listener_hint
  listener_hint="$(listener_hint_for_port "${requested_port}")"
  if [[ -n "${listener_hint}" ]]; then
    log "RPC_PORT=${requested_port} is in use (${listener_hint}); using RPC_PORT=${fallback_port} for this run"
  else
    log "RPC_PORT=${requested_port} is in use; using RPC_PORT=${fallback_port} for this run"
  fi
  RPC_PORT="${fallback_port}"
  export RPC_PORT
}

compose_up_with_timeout() {
  local timeout_seconds="$1"
  local log_path="$2"
  local start_pid=""
  local deadline=$(( $(date +%s) + timeout_seconds ))

  (
    cd "${COMPOSE_DIR}"
    docker compose up -d --build postgres redis fnn fnn2 rpc worker
  ) > "${log_path}" 2>&1 &
  start_pid=$!

  while kill -0 "${start_pid}" >/dev/null 2>&1; do
    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      kill "${start_pid}" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "${start_pid}" >/dev/null 2>&1 || true
      wait "${start_pid}" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 2
  done

  wait "${start_pid}"
}

cleanup_stack() {
  if [[ "${STARTED_COMPOSE}" -ne 1 || "${KEEP_STACK_UP}" -eq 1 ]]; then
    return 0
  fi

  compose logs --no-color > "${ARTIFACT_DIR}/compose.log" || true
  compose down -v --remove-orphans > "${ARTIFACT_DIR}/compose-down.log" 2>&1 || return 1
  return 0
}

finalize_and_exit() {
  local code="$1"
  local message="$2"
  local final_code="${code}"

  if [[ "${FINALIZED}" -eq 1 ]]; then
    exit "${final_code}"
  fi
  FINALIZED=1

  if ! cleanup_stack; then
    if [[ "${final_code}" -eq 0 ]]; then
      final_code="${EXIT_CLEANUP_FAILURE}"
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

fatal() {
  local code="$1"
  shift
  local message="$*"
  finalize_and_exit "${code}" "${message}"
}

trap 'finalize_and_exit 130 "interrupted"' INT TERM

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

run_service_db_migrations() {
  local pg_user pg_db sql_dir sql_file
  pg_user="${POSTGRES_USER:-$(get_env_value POSTGRES_USER)}"
  pg_db="${POSTGRES_DB:-$(get_env_value POSTGRES_DB)}"
  pg_user="${pg_user:-fiber}"
  pg_db="${pg_db:-fiber_link}"
  sql_dir="${ROOT_DIR}/fiber-link-service/packages/db/drizzle"
  [[ -d "${sql_dir}" ]] || fatal "${EXIT_PRECHECK}" "missing db migration dir: ${sql_dir}"

  log "applying service db migrations"
  : > "${ARTIFACT_DIR}/db-migrate.log"
  for sql_file in "${sql_dir}"/*.sql; do
    printf '==> %s\n' "$(basename "${sql_file}")" >> "${ARTIFACT_DIR}/db-migrate.log"
    docker exec -i fiber-link-postgres \
      psql -v ON_ERROR_STOP=1 -U "${pg_user}" -d "${pg_db}" < "${sql_file}" >> "${ARTIFACT_DIR}/db-migrate.log" 2>&1 \
      || fatal "${EXIT_STARTUP_TIMEOUT}" "service db migration failed on $(basename "${sql_file}") (see ${ARTIFACT_DIR}/db-migrate.log)"
  done
}

wait_for_state() {
  local container="$1"
  local expected="$2"
  local deadline
  deadline=$(( $(date +%s) + WAIT_TIMEOUT_SECONDS ))

  while true; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "${container}" 2>/dev/null || true)"
    if [[ "${status}" == "${expected}" ]]; then
      vlog "${container} is ${status}"
      return 0
    fi

    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      return 1
    fi
    sleep 3
  done
}

to_hex_quantity() {
  local amount="$1"
  if ! [[ "${amount}" =~ ^[0-9]+$ ]]; then
    fatal "${EXIT_PRECHECK}" "amount must be integer, got '${amount}'"
  fi
  printf '0x%x' "${amount}"
}

hex_quantity_to_decimal() {
  local quantity="$1"
  node -e 'const q = String(process.argv[1] ?? "").trim();
try {
  console.log(BigInt(q).toString());
} catch (_error) {
  process.exit(1);
}' "${quantity}"
}

currency_for_asset() {
  local asset="$1"
  local scoped_var="FIBER_INVOICE_CURRENCY_${asset}"
  local scoped_value="${!scoped_var:-}"
  if [[ -n "${scoped_value}" ]]; then
    printf '%s' "${scoped_value}"
    return
  fi

  if [[ -n "${FIBER_INVOICE_CURRENCY:-}" ]]; then
    printf '%s' "${FIBER_INVOICE_CURRENCY}"
    return
  fi

  if [[ "${asset}" == "CKB" ]]; then
    printf 'Fibt'
  else
    local ckb_scoped="${FIBER_INVOICE_CURRENCY_CKB:-}"
    if [[ -n "${ckb_scoped}" ]]; then
      printf '%s' "${ckb_scoped}"
    else
      printf 'Fibt'
    fi
  fi
}

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
  curl -fsS "${HOST_ACCESS_BASE_URL}:${RPC_PORT}/rpc" \
    -H "content-type: application/json" \
    -H "x-app-id: ${APP_ID}" \
    -H "x-ts: ${ts}" \
    -H "x-nonce: ${nonce}" \
    -H "x-signature: ${sig}" \
    -d "${payload}"
}

fnn_rpc_call_on_port() {
  local port="$1"
  local payload="$2"
  curl -fsS "${HOST_ACCESS_BASE_URL}:${port}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

fnn_invoice_rpc_call() {
  local payload="$1"
  fnn_rpc_call_on_port "${FNN_INVOICE_RPC_PORT}" "${payload}"
}

fnn_payer_rpc_call() {
  local payload="$1"
  fnn_rpc_call_on_port "${FNN_PAYER_RPC_PORT}" "${payload}"
}

ckb_rpc_call() {
  local payload="$1"
  curl -fsS "${CKB_RPC_URL}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

bigint_gte() {
  local left="$1"
  local right="$2"
  node -e 'try {
  const left = BigInt(process.argv[1]);
  const right = BigInt(process.argv[2]);
  process.exit(left >= right ? 0 : 1);
} catch (_error) {
  process.exit(1);
}' "${left}" "${right}"
}

extract_usdi_type_script_from_node_info() {
  local node_info_payload="$1"
  printf '%s' "${node_info_payload}" | jq -c '
    ([
      .result.udt_cfg_infos[]?
      | select((((.name // "") | ascii_downcase) == "usdi") or (((.name // "") | ascii_downcase) == "rusd"))
      | .script
    ] | .[0]) // (.result.udt_cfg_infos[0].script // empty)
  '
}

extract_usdi_currency_from_node_info() {
  local node_info_payload="$1"
  printf '%s' "${node_info_payload}" | jq -r '
    (
      [
        .result.udt_cfg_infos[]?
        | .name
        | select(type == "string" and length > 0)
        | select((ascii_downcase == "usdi") or (ascii_downcase == "rusd"))
      ] | .[0]
    ) // (
      .result.udt_cfg_infos[0].name
      | select(type == "string" and length > 0)
    ) // empty
  '
}

extract_usdi_auto_accept_amount_from_node_info() {
  local node_info_payload="$1"
  printf '%s' "${node_info_payload}" | jq -r '
    (
      [
        .result.udt_cfg_infos[]?
        | select(
            (((.name // "") | ascii_downcase) == "usdi")
            or (((.name // "") | ascii_downcase) == "rusd")
          )
        | .auto_accept_amount
      ] | .[0]
    ) // (
      .result.udt_cfg_infos[0].auto_accept_amount
    ) // empty
  '
}

sum_xudt_amount_from_get_cells_response() {
  local response_payload="$1"
  node -e 'let resp;
try {
  resp = JSON.parse(process.argv[1]);
} catch (_error) {
  process.exit(1);
}
const objs = Array.isArray(resp?.result?.objects) ? resp.result.objects : [];
let total = 0n;
for (const obj of objs) {
  const data = obj?.output_data ?? obj?.outputData ?? "";
  if (typeof data !== "string" || !data.startsWith("0x")) continue;
  const hexData = data.slice(2);
  if (hexData.length < 32) continue;
  let first16;
  try {
    first16 = Buffer.from(hexData.slice(0, 32), "hex");
  } catch (_error) {
    continue;
  }
  if (first16.length !== 16) continue;
  let value = 0n;
  for (let i = 15; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(first16[i]);
  }
  total += value;
}
console.log(total.toString());' "${response_payload}"
}

contains_jsonrpc_error() {
  local payload="$1"
  printf '%s' "${payload}" | jq -e '.error != null' >/dev/null 2>&1
}

jsonrpc_error_message() {
  local payload="$1"
  printf '%s' "${payload}" | jq -r '.error.message // "unknown jsonrpc error"'
}

contains_insufficient_balance() {
  local text="$1"
  local normalized
  normalized="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == *"insufficient"* ]] \
    || [[ "${normalized}" == *"not enough"* ]] \
    || [[ "${normalized}" == *"can not find enough"* ]] \
    || [[ "${normalized}" == *"lack"* ]] \
    || [[ "${normalized}" == *"balance"* ]] \
    || [[ "${normalized}" == *"capacity"* ]] \
    || [[ "${normalized}" == *"owner cells"* ]]
}

contains_no_route() {
  local text="$1"
  local normalized
  normalized="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == *"no path found"* ]] \
    || [[ "${normalized}" == *"failed to build route"* ]] \
    || [[ "${normalized}" == *"pathfind error"* ]] \
    || [[ "${normalized}" == *"target_pubkey is missing"* ]]
}

contains_already_connected() {
  local text="$1"
  local normalized
  normalized="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == *"already connected"* ]] \
    || [[ "${normalized}" == *"session already exists"* ]] \
    || [[ "${normalized}" == *"already exists"* ]]
}

contains_accept_channel_ignorable_error() {
  local text="$1"
  local normalized
  normalized="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == *"already"* ]] \
    || [[ "${normalized}" == *"not found"* ]] \
    || [[ "${normalized}" == *"no channel with temp id"* ]] \
    || [[ "${normalized}" == *"no channel"* ]] \
    || [[ "${normalized}" == *"unknown channel"* ]]
}

contains_open_channel_peer_not_ready_error() {
  local text="$1"
  local normalized
  normalized="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == *"waiting for peer to send init message"* ]] \
    || [[ "${normalized}" == *"peer"* && "${normalized}" == *"feature not found"* ]]
}

asset_topup_address() {
  local asset="$1"
  if [[ "${asset}" == "CKB" ]]; then
    printf '%s' "${CKB_TOPUP_ADDRESS}"
  else
    printf '%s' "${USDI_TOPUP_ADDRESS}"
  fi
}

fail_with_topup_hint() {
  local asset="$1"
  local reason="$2"
  local address
  address="$(asset_topup_address "${asset}")"

  {
    log "余额不足导致 ${asset} 支付失败: ${reason}"
    log "请先给地址充值后重试:"
    log "  asset=${asset}"
    log "  address=${address}"
    if [[ "${asset}" == "CKB" ]]; then
      log "  faucet=https://faucet.nervos.org/"
    else
      log "  usdi_faucet_command=${USDI_FAUCET_COMMAND}"
      log "  note=USDI route/channel funding requires UDT owner cells for fnn2"
    fi
  } | tee -a "${ARTIFACT_DIR}/insufficient-balance.log"

  fatal "${EXIT_INSUFFICIENT_BALANCE}" "insufficient balance for ${asset}"
}

fail_with_channel_topup_hint() {
  local reason="$1"

  {
    log "建立 fnn2 -> fnn channel 失败（疑似余额不足）: ${reason}"
    log "请先给以下地址充值后重试:"
    log "  payer_node=fnn2"
    log "  payer_ckb_address=${CKB_TOPUP_ADDRESS}"
    log "  invoice_node=fnn"
    log "  invoice_ckb_address=${CKB_INVOICE_NODE_TOPUP_ADDRESS}"
    log "  faucet=https://faucet.nervos.org/"
  } | tee -a "${ARTIFACT_DIR}/channel-insufficient-balance.log"

  fatal "${EXIT_INSUFFICIENT_BALANCE}" "insufficient balance for channel bootstrap"
}

fail_with_route_hint() {
  local asset="$1"
  local reason="$2"

  {
    log "支付路由不可达，${asset} 支付失败: ${reason}"
    log "请先准备可支付路由后重试:"
    log "  1) 检查 fnn2 -> fnn channel 是否已到 ChannelReady"
    log "  2) 确认 invoice 资产与 channel 资产一致（CKB 或 USDI）"
    log "  3) 再次执行 e2e"
  } | tee -a "${ARTIFACT_DIR}/route-unavailable.log"

  fatal "${EXIT_PAYMENT_FAILURE}" "route unavailable for ${asset}"
}

derive_ckb_testnet_address_from_lock_args() {
  local lock_args_hex="$1"
  node -e 'const lockArgsHex = String(process.argv[1] ?? "").trim();
if (!lockArgsHex.startsWith("0x")) process.exit(1);
let args;
try {
  args = Buffer.from(lockArgsHex.slice(2), "hex");
} catch (_error) {
  process.exit(1);
}
if (args.length !== 20) process.exit(1);

const payload = Buffer.concat([Buffer.from([0x01, 0x00]), args]);
const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const generators = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3];

const hrpExpand = (hrp) => {
  const expanded = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  return expanded;
};

const polymod = (values) => {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >>> i) & 1) chk ^= generators[i];
    }
  }
  return chk >>> 0;
};

const createChecksum = (hrp, data) => {
  const values = hrpExpand(hrp).concat(data);
  const pm = polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i += 1) checksum.push((pm >>> (5 * (5 - i))) & 31);
  return checksum;
};

const convertBits = (data, fromBits, toBits, pad) => {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || (value >>> fromBits) !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return ret;
};

const data = convertBits([...payload], 8, 5, true);
if (!data) process.exit(1);
const checksum = createChecksum("ckt", data);
const addr = "ckt1" + data.concat(checksum).map((idx) => charset[idx]).join("");
console.log(addr);' "${lock_args_hex}"
}

derive_peer_id_from_node_id() {
  local node_id_hex="$1"
  node -e 'const crypto = require("node:crypto");
let nodeIdHex = String(process.argv[1] ?? "").trim();
if (nodeIdHex.startsWith("0x")) nodeIdHex = nodeIdHex.slice(2);
let pubkey;
try {
  pubkey = Buffer.from(nodeIdHex, "hex");
} catch (_error) {
  process.exit(1);
}
if (pubkey.length !== 33) process.exit(1);

const digest = crypto.createHash("sha256").update(pubkey).digest();
const raw = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let num = BigInt("0x" + raw.toString("hex"));
let out = "";
while (num > 0n) {
  const rem = Number(num % 58n);
  out = alphabet[rem] + out;
  num /= 58n;
}
let leadingZero = 0;
for (const b of raw) {
  if (b === 0) leadingZero += 1;
  else break;
}
out = "1".repeat(leadingZero) + out;
console.log(out);' "${node_id_hex}"
}

derive_ckb_topup_address_from_node_info() {
  local rpc_port="$1"
  local payload='{"jsonrpc":"2.0","id":"derive-topup-address","method":"node_info","params":[]}'
  local response
  set +e
  response="$(fnn_rpc_call_on_port "${rpc_port}" "${payload}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    printf '[e2e-invoice] node_info call failed on port=%s (rc=%s)\n' "${rpc_port}" "${rc}" >&2
    return 1
  fi

  local lock_args
  lock_args="$(printf '%s' "${response}" | jq -r '.result.default_funding_lock_script.args // empty')"
  if [[ -z "${lock_args}" ]]; then
    printf '[e2e-invoice] node_info missing default_funding_lock_script.args on port=%s\n' "${rpc_port}" >&2
    printf '%s\n' "${response}" > "${ARTIFACT_DIR}/node-info-derive-${rpc_port}.last.json" || true
    return 1
  fi

  derive_ckb_testnet_address_from_lock_args "${lock_args}"
}

derive_ckb_topup_address_with_retry() {
  local rpc_port="$1"
  local node_label="$2"
  local attempt=1
  local derived=""

  while [[ "${attempt}" -le "${NODE_INFO_DERIVE_RETRIES}" ]]; do
    set +e
    derived="$(derive_ckb_topup_address_from_node_info "${rpc_port}")"
    local rc=$?
    set -e
    if [[ "${rc}" -eq 0 && -n "${derived}" ]]; then
      printf '%s' "${derived}"
      return 0
    fi

    if [[ "${attempt}" -lt "${NODE_INFO_DERIVE_RETRIES}" ]]; then
      printf '[e2e-invoice] derive %s top-up address attempt=%s failed; retrying in %ss\n' \
        "${node_label}" "${attempt}" "${NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS}" >&2
      sleep "${NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS}"
    fi
    attempt=$((attempt + 1))
  done

  printf '[e2e-invoice] derive %s top-up address exhausted retries=%s\n' "${node_label}" "${NODE_INFO_DERIVE_RETRIES}" >&2
  return 1
}

request_ckb_faucet() {
  local address="$1"
  local label="$2"
  local target_dir="$3"

  local payload
  payload="$(jq -cn --arg address "${address}" --arg amount "${CKB_FAUCET_AMOUNT}" '{claim_event:{address_hash:$address,amount:$amount}}')"
  printf '%s\n' "${payload}" > "${target_dir}/ckb-faucet-${label}.request.json"

  local response_file="${target_dir}/ckb-faucet-${label}.response.json"
  local http_code
  set +e
  http_code="$(curl -sS -o "${response_file}" -w "%{http_code}" \
    -H "content-type: application/json" \
    -d "${payload}" \
    "${CKB_FAUCET_API_BASE%/}/claim_events")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    http_code="000"
  fi

  if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
    if [[ "${CKB_FAUCET_ENABLE_FALLBACK}" == "1" ]]; then
      local fallback_payload fallback_http_code fallback_response_file
      fallback_payload="$(jq -cn --arg address "${address}" '{address:$address,token:"ckb"}')"
      printf '%s\n' "${fallback_payload}" > "${target_dir}/ckb-faucet-fallback-${label}.request.json"

      fallback_response_file="${target_dir}/ckb-faucet-fallback-${label}.response.json"
      set +e
      fallback_http_code="$(curl -sS -o "${fallback_response_file}" -w "%{http_code}" \
        -H "content-type: application/json" \
        -d "${fallback_payload}" \
        "${CKB_FAUCET_FALLBACK_API_BASE%/}/faucet")"
      rc=$?
      set -e

      if [[ "${rc}" -eq 0 && "${fallback_http_code}" -ge 200 && "${fallback_http_code}" -lt 300 ]] \
        && ! jq -e '(.error != null) or ((.errors | type) == "array" and (.errors | length) > 0)' "${fallback_response_file}" >/dev/null 2>&1; then
        log "CKB faucet(${label}) primary rejected (HTTP ${http_code}); fallback faucet accepted; waiting ${CKB_FAUCET_WAIT_SECONDS}s"
        sleep "${CKB_FAUCET_WAIT_SECONDS}"
        return 0
      fi
    fi

    if [[ "${http_code}" -eq 422 ]]; then
      local detail
      detail="$(jq -r '.errors[0].detail // empty' "${response_file}")"
      {
        log "CKB faucet(${label}) 被拒绝: HTTP 422 ${detail}"
        log "请先手工给地址充值后重试:"
        log "  address=${address}"
        log "  faucet=https://faucet.nervos.org/"
      } | tee -a "${target_dir}/ckb-faucet-${label}.hint.log"
      fatal "${EXIT_INSUFFICIENT_BALANCE}" "CKB faucet rejected for ${label}"
    fi
    fatal "${EXIT_FAUCET_FAILURE}" "CKB faucet returned HTTP ${http_code} (${label})"
  fi

  if jq -e '(.error != null) or ((.errors | type) == "array" and (.errors | length) > 0)' "${response_file}" >/dev/null 2>&1; then
    fatal "${EXIT_FAUCET_FAILURE}" "CKB faucet returned logical error (${label})"
  fi

  log "CKB faucet(${label}) accepted; waiting ${CKB_FAUCET_WAIT_SECONDS}s"
  sleep "${CKB_FAUCET_WAIT_SECONDS}"
}

sum_ckb_capacity_from_get_cells_response() {
  local response_payload="$1"
  node -e 'let resp;
try {
  resp = JSON.parse(process.argv[1]);
} catch (_error) {
  process.exit(1);
}
const objs = Array.isArray(resp?.result?.objects) ? resp.result.objects : [];
let total = 0n;
for (const obj of objs) {
  const cap = obj?.output?.capacity ?? "";
  if (typeof cap !== "string" || cap.length === 0) continue;
  try {
    total += BigInt(cap);
  } catch (_error) {
    continue;
  }
}
console.log(total.toString());' "${response_payload}"
}

query_ckb_balance_for_lock_script() {
  local lock_script_json="$1"
  local target_dir="$2"
  local label="$3"
  local cursor="0x"
  local page=0
  local total=0
  local log_file="${target_dir}/ckb-balance-${label}.query.log"
  : > "${log_file}"

  while true; do
    page=$((page + 1))
    if [[ "${page}" -gt "${CKB_BALANCE_CHECK_LIMIT_PAGES}" ]]; then
      log "CKB balance query reached page limit=${CKB_BALANCE_CHECK_LIMIT_PAGES}, partial_total=${total}, label=${label}"
      break
    fi

    local payload
    payload="$(jq -cn \
      --arg id "ckb-balance-${label}-${page}" \
      --argjson lock_script "${lock_script_json}" \
      --arg cursor "${cursor}" \
      '
      if $cursor == "0x" then
        {
          jsonrpc:"2.0",
          id:$id,
          method:"get_cells",
          params:[
            {script:$lock_script,script_type:"lock"},
            "asc",
            "0x64"
          ]
        }
      else
        {
          jsonrpc:"2.0",
          id:$id,
          method:"get_cells",
          params:[
            {script:$lock_script,script_type:"lock"},
            "asc",
            "0x64",
            $cursor
          ]
        }
      end
      '
    )"

    local response
    set +e
    response="$(ckb_rpc_call "${payload}")"
    local rc=$?
    set -e
    if [[ "${rc}" -ne 0 ]]; then
      return 1
    fi
    printf '%s\n' "${response}" > "${target_dir}/ckb-balance-${label}.page.${page}.json"
    if contains_jsonrpc_error "${response}"; then
      return 1
    fi

    local page_sum
    page_sum="$(sum_ckb_capacity_from_get_cells_response "${response}")"
    total="$(node -e 'console.log((BigInt(process.argv[1]) + BigInt(process.argv[2])).toString())' "${total}" "${page_sum}")"

    local count next_cursor
    count="$(printf '%s' "${response}" | jq -r '.result.objects | length')"
    next_cursor="$(printf '%s' "${response}" | jq -r '.result.last_cursor // "0x"')"
    printf 'page=%s count=%s page_sum=%s total=%s cursor=%s next=%s\n' \
      "${page}" "${count}" "${page_sum}" "${total}" "${cursor}" "${next_cursor}" >> "${log_file}"

    if [[ "${count}" -eq 0 || -z "${next_cursor}" || "${next_cursor}" == "${cursor}" ]]; then
      break
    fi
    cursor="${next_cursor}"
  done

  printf '%s' "${total}"
}

ensure_ckb_balance_or_request_faucet() {
  local address="$1"
  local label="$2"
  local target_dir="$3"
  local required_amount="$4"
  local lock_script_json="${5:-}"

  if [[ -n "${lock_script_json}" ]]; then
    local before_balance
    set +e
    before_balance="$(query_ckb_balance_for_lock_script "${lock_script_json}" "${target_dir}" "${label}-before")"
    local balance_rc=$?
    set -e
    if [[ "${balance_rc}" -eq 0 && -n "${before_balance}" ]]; then
      printf '%s\n' "${before_balance}" > "${target_dir}/ckb-balance-${label}.before.txt"
      if bigint_gte "${before_balance}" "${required_amount}"; then
        log "CKB balance precheck passed (label=${label}, balance=${before_balance}, required=${required_amount}), skip faucet"
        return 0
      fi
      log "CKB balance precheck insufficient (label=${label}, balance=${before_balance}, required=${required_amount}), requesting faucet"
    else
      log "CKB balance precheck failed (label=${label}), falling back to faucet request"
    fi
  else
    log "CKB balance precheck skipped (label=${label}, missing lock script), requesting faucet"
  fi

  request_ckb_faucet "${address}" "${label}" "${target_dir}"

  if [[ -n "${lock_script_json}" ]]; then
    local after_balance
    set +e
    after_balance="$(query_ckb_balance_for_lock_script "${lock_script_json}" "${target_dir}" "${label}-after")"
    local after_rc=$?
    set -e
    if [[ "${after_rc}" -eq 0 && -n "${after_balance}" ]]; then
      printf '%s\n' "${after_balance}" > "${target_dir}/ckb-balance-${label}.after.txt"
      log "CKB balance after faucet (label=${label}): ${after_balance}"
      if bigint_gte "${after_balance}" "${required_amount}"; then
        return 0
      fi
    fi

    if [[ "${CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS}" -gt 0 ]]; then
      local deadline attempt waited_balance
      deadline=$(( $(date +%s) + CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS ))
      attempt=0
      waited_balance="${after_balance:-0}"

      while [[ "$(date +%s)" -lt "${deadline}" ]]; do
        attempt=$((attempt + 1))
        sleep "${CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS}"

        set +e
        waited_balance="$(query_ckb_balance_for_lock_script "${lock_script_json}" "${target_dir}" "${label}-postwait")"
        after_rc=$?
        set -e
        if [[ "${after_rc}" -ne 0 || -z "${waited_balance}" ]]; then
          continue
        fi

        printf '%s\n' "${waited_balance}" > "${target_dir}/ckb-balance-${label}.after.txt"
        vlog "CKB balance post-faucet wait (label=${label}, attempt=${attempt}): ${waited_balance}"
        if bigint_gte "${waited_balance}" "${required_amount}"; then
          log "CKB balance reached required threshold after faucet (label=${label}, balance=${waited_balance}, required=${required_amount})"
          return 0
        fi
      done

      log "CKB balance still below required after waiting ${CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS}s (label=${label}, balance=${waited_balance}, required=${required_amount})"
    fi
  fi
}

query_usdi_balance_for_payer() {
  local target_dir="$1"
  local cursor="0x"
  local page=0
  local total=0
  local log_file="${target_dir}/usdi-balance.query.log"
  : > "${log_file}"

  while true; do
    page=$((page + 1))
    if [[ "${page}" -gt "${USDI_BALANCE_CHECK_LIMIT_PAGES}" ]]; then
      log "USDI balance query reached page limit=${USDI_BALANCE_CHECK_LIMIT_PAGES}, partial_total=${total}"
      break
    fi

    local payload
    payload="$(jq -cn \
      --arg id "usdi-balance-${page}" \
      --argjson lock_script "${PAYER_LOCK_SCRIPT_JSON}" \
      --argjson type_script "${USDI_TYPE_SCRIPT_JSON}" \
      --arg cursor "${cursor}" \
      '
      if $cursor == "0x" then
        {
          jsonrpc:"2.0",
          id:$id,
          method:"get_cells",
          params:[
            {script:$lock_script,script_type:"lock",filter:{script:$type_script}},
            "asc",
            "0x64"
          ]
        }
      else
        {
          jsonrpc:"2.0",
          id:$id,
          method:"get_cells",
          params:[
            {script:$lock_script,script_type:"lock",filter:{script:$type_script}},
            "asc",
            "0x64",
            $cursor
          ]
        }
      end
      '
    )"

    local response
    set +e
    response="$(ckb_rpc_call "${payload}")"
    local rc=$?
    set -e
    if [[ "${rc}" -ne 0 ]]; then
      return 1
    fi
    printf '%s\n' "${response}" > "${target_dir}/usdi-balance.page.${page}.json"
    if contains_jsonrpc_error "${response}"; then
      return 1
    fi

    local page_sum
    page_sum="$(sum_xudt_amount_from_get_cells_response "${response}")"
    total="$(node -e 'console.log((BigInt(process.argv[1]) + BigInt(process.argv[2])).toString())' "${total}" "${page_sum}")"

    local count next_cursor
    count="$(printf '%s' "${response}" | jq -r '.result.objects | length')"
    next_cursor="$(printf '%s' "${response}" | jq -r '.result.last_cursor // "0x"')"
    printf 'page=%s count=%s page_sum=%s total=%s cursor=%s next=%s\n' \
      "${page}" "${count}" "${page_sum}" "${total}" "${cursor}" "${next_cursor}" >> "${log_file}"

    if [[ "${count}" -eq 0 || -z "${next_cursor}" || "${next_cursor}" == "${cursor}" ]]; then
      break
    fi
    cursor="${next_cursor}"
  done

  printf '%s' "${total}"
}

request_usdi_faucet() {
  local target_dir="$1"
  local required_amount="$2"

  if [[ -n "${PAYER_LOCK_SCRIPT_JSON}" && -n "${USDI_TYPE_SCRIPT_JSON}" ]]; then
    local before_balance
    set +e
    before_balance="$(query_usdi_balance_for_payer "${target_dir}")"
    local balance_rc=$?
    set -e
    if [[ "${balance_rc}" -eq 0 && -n "${before_balance}" ]]; then
      printf '%s\n' "${before_balance}" > "${target_dir}/usdi-balance.before.txt"
      if bigint_gte "${before_balance}" "${required_amount}"; then
        log "USDI balance precheck passed (balance=${before_balance}, required=${required_amount}), skip faucet"
        return 0
      fi
      log "USDI balance precheck insufficient (balance=${before_balance}, required=${required_amount}), requesting faucet"
    else
      log "USDI balance precheck failed, falling back to faucet request"
    fi
  else
    log "USDI balance precheck skipped (missing payer lock script or USDI type script)"
  fi

  printf '%s\n' "${USDI_FAUCET_COMMAND}" > "${target_dir}/usdi-faucet.command.txt"
  set +e
  E2E_FAUCET_ASSET="USDI" \
  E2E_FAUCET_ADDRESS="${USDI_TOPUP_ADDRESS}" \
  E2E_FAUCET_AMOUNT="${USDI_FAUCET_AMOUNT}" \
    bash -lc "${USDI_FAUCET_COMMAND}" \
      > "${target_dir}/usdi-faucet.stdout.log" \
      2> "${target_dir}/usdi-faucet.stderr.log"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_FAUCET_FAILURE}" "USDI faucet command failed"
  fi

  log "USDI faucet succeeded; waiting ${USDI_FAUCET_WAIT_SECONDS}s"
  sleep "${USDI_FAUCET_WAIT_SECONDS}"

  if [[ -n "${PAYER_LOCK_SCRIPT_JSON}" && -n "${USDI_TYPE_SCRIPT_JSON}" ]]; then
    local after_balance
    set +e
    after_balance="$(query_usdi_balance_for_payer "${target_dir}")"
    local balance_rc=$?
    set -e
    if [[ "${balance_rc}" -eq 0 && -n "${after_balance}" ]]; then
      printf '%s\n' "${after_balance}" > "${target_dir}/usdi-balance.after.txt"
      log "USDI balance after faucet: ${after_balance}"
    fi
  fi
}

get_container_ip() {
  local container="$1"
  docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${container}"
}

fetch_node_info() {
  local rpc_port="$1"
  local target_file="$2"

  local payload='{"jsonrpc":"2.0","id":"node-info","method":"node_info","params":[]}'
  local response
  set +e
  response="$(fnn_rpc_call_on_port "${rpc_port}" "${payload}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "node_info transport failed on port ${rpc_port}"
  fi
  printf '%s\n' "${response}" > "${target_file}"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "node_info failed on port ${rpc_port}: $(jsonrpc_error_message "${response}")"
  fi

  NODE_INFO_RESULT="${response}"
}

hydrate_lock_scripts_for_balance_precheck() {
  local target_dir="$1"
  mkdir -p "${target_dir}"

  local payer_info invoice_info
  fetch_node_info "${FNN_PAYER_RPC_PORT}" "${target_dir}/node-info-payer.precheck.response.json"
  payer_info="${NODE_INFO_RESULT}"
  fetch_node_info "${FNN_INVOICE_RPC_PORT}" "${target_dir}/node-info-invoice.precheck.response.json"
  invoice_info="${NODE_INFO_RESULT}"

  PAYER_LOCK_SCRIPT_JSON="$(printf '%s' "${payer_info}" | jq -c '.result.default_funding_lock_script // empty')"
  INVOICE_LOCK_SCRIPT_JSON="$(printf '%s' "${invoice_info}" | jq -c '.result.default_funding_lock_script // empty')"
  DETECTED_USDI_CURRENCY="$(extract_usdi_currency_from_node_info "${payer_info}")"
  USDI_AUTO_ACCEPT_AMOUNT_HEX="$(extract_usdi_auto_accept_amount_from_node_info "${payer_info}")"
  if [[ -z "${USDI_TYPE_SCRIPT_JSON}" ]]; then
    USDI_TYPE_SCRIPT_JSON="$(extract_usdi_type_script_from_node_info "${payer_info}")"
  fi
  if [[ -z "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" ]]; then
    ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX="$(printf '%s' "${invoice_info}" | jq -r '.result.auto_accept_channel_ckb_funding_amount // empty')"
  fi
  if [[ -n "${DETECTED_USDI_CURRENCY}" ]]; then
    log "detected USDI invoice currency from node_info: ${DETECTED_USDI_CURRENCY}"
  fi
}

connect_peer_on_port() {
  local from_port="$1"
  local remote_addr="$2"
  local label="$3"
  local target_dir="$4"

  local payload
  payload="$(jq -cn --arg id "connect-${label}-$(date +%s)-$RANDOM" --arg addr "${remote_addr}" '{jsonrpc:"2.0",id:$id,method:"connect_peer",params:[{address:$addr}]}')"
  printf '%s\n' "${payload}" > "${target_dir}/connect-peer-${label}.request.json"

  local response
  set +e
  response="$(fnn_rpc_call_on_port "${from_port}" "${payload}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "connect_peer transport failed (${label})"
  fi
  printf '%s\n' "${response}" > "${target_dir}/connect-peer-${label}.response.json"

  if contains_jsonrpc_error "${response}"; then
    local message
    message="$(jsonrpc_error_message "${response}")"
    if contains_already_connected "${message}"; then
      vlog "connect_peer(${label}) already connected"
      return 0
    fi
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "connect_peer failed (${label}): ${message}"
  fi

  vlog "connect_peer(${label}) succeeded"
}

open_channel_from_payer() {
  local peer_id="$1"
  local funding_amount_hex="$2"
  local target_dir="$3"
  local funding_udt_type_script_json="${4:-}"

  local attempt=0
  while true; do
    attempt=$((attempt + 1))

    local payload
    if [[ -n "${funding_udt_type_script_json}" ]]; then
      payload="$(jq -cn \
        --arg id "open-channel-${attempt}-$(date +%s)-$RANDOM" \
        --arg peer_id "${peer_id}" \
        --arg funding_amount "${funding_amount_hex}" \
        --arg tlc_fee_proportional_millionths "${CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS}" \
        --argjson funding_udt_type_script "${funding_udt_type_script_json}" \
        '{jsonrpc:"2.0",id:$id,method:"open_channel",params:[{peer_id:$peer_id,funding_amount:$funding_amount,funding_udt_type_script:$funding_udt_type_script,tlc_fee_proportional_millionths:$tlc_fee_proportional_millionths}]}'
      )"
    else
      payload="$(jq -cn \
        --arg id "open-channel-${attempt}-$(date +%s)-$RANDOM" \
        --arg peer_id "${peer_id}" \
        --arg funding_amount "${funding_amount_hex}" \
        --arg tlc_fee_proportional_millionths "${CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS}" \
        '{jsonrpc:"2.0",id:$id,method:"open_channel",params:[{peer_id:$peer_id,funding_amount:$funding_amount,tlc_fee_proportional_millionths:$tlc_fee_proportional_millionths}]}'
      )"
    fi
    printf '%s\n' "${payload}" > "${target_dir}/open-channel.request.${attempt}.json"
    printf '%s\n' "${payload}" > "${target_dir}/open-channel.request.json"

    local response
    set +e
    response="$(fnn_payer_rpc_call "${payload}")"
    local rc=$?
    set -e
    if [[ "${rc}" -ne 0 ]]; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "open_channel transport failed"
    fi
    printf '%s\n' "${response}" > "${target_dir}/open-channel.response.${attempt}.json"
    printf '%s\n' "${response}" > "${target_dir}/open-channel.response.json"

    if contains_jsonrpc_error "${response}"; then
      local message
      message="$(jsonrpc_error_message "${response}")"
      if contains_insufficient_balance "${message}"; then
        fail_with_channel_topup_hint "${message}"
      fi
      if contains_open_channel_peer_not_ready_error "${message}" && [[ "${attempt}" -lt "${OPEN_CHANNEL_INIT_RETRIES}" ]]; then
        printf 'attempt=%s retrying=true reason=%s at=%s\n' \
          "${attempt}" "${message}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${target_dir}/open-channel.retry.log"
        vlog "open_channel attempt=${attempt} waiting for peer init; retrying in ${OPEN_CHANNEL_INIT_RETRY_INTERVAL_SECONDS}s"
        sleep "${OPEN_CHANNEL_INIT_RETRY_INTERVAL_SECONDS}"
        continue
      fi
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "open_channel failed: ${message}"
    fi

    local temporary_channel_id
    temporary_channel_id="$(printf '%s' "${response}" | jq -r '.result.temporary_channel_id // empty')"
    OPEN_CHANNEL_TEMPORARY_ID="${temporary_channel_id}"
    return 0
  done
}

accept_channel_on_invoice_node() {
  local temporary_channel_id="$1"
  local target_dir="$2"
  local funding_amount_hex="${3:-${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}}"

  if [[ -z "${temporary_channel_id}" ]]; then
    return 0
  fi

  local payload
  payload="$(jq -cn \
    --arg id "accept-channel-$(date +%s)-$RANDOM" \
    --arg temporary_channel_id "${temporary_channel_id}" \
    --arg funding_amount "${funding_amount_hex}" \
    '{jsonrpc:"2.0",id:$id,method:"accept_channel",params:[{temporary_channel_id:$temporary_channel_id,funding_amount:$funding_amount}]}'
  )"
  printf '%s\n' "${payload}" > "${target_dir}/accept-channel.request.json"

  local response
  set +e
  response="$(fnn_invoice_rpc_call "${payload}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "accept_channel transport failed"
  fi
  printf '%s\n' "${response}" > "${target_dir}/accept-channel.response.json"

  if contains_jsonrpc_error "${response}"; then
    local message
    message="$(jsonrpc_error_message "${response}")"
    if contains_accept_channel_ignorable_error "${message}"; then
      vlog "accept_channel ignorable error: ${message}"
      return 0
    fi
    if contains_insufficient_balance "${message}"; then
      fail_with_channel_topup_hint "${message}"
    fi
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "accept_channel failed: ${message}"
  fi

  vlog "accept_channel succeeded"
}

list_channels_by_peer() {
  local rpc_port="$1"
  local peer_id="$2"

  local payload
  payload="$(jq -cn --arg id "list-channels-$(date +%s)-$RANDOM" --arg peer_id "${peer_id}" '{jsonrpc:"2.0",id:$id,method:"list_channels",params:[{peer_id:$peer_id}]}')"
  fnn_rpc_call_on_port "${rpc_port}" "${payload}"
}

extract_first_channel_state() {
  local response="$1"
  printf '%s' "${response}" | jq -r '
    .result.channels[0].state as $s
    | if $s == null then ""
      elif ($s | type) == "string" then $s
      elif ($s | type) == "object" then ($s.state_name // "")
      else ""
      end
  '
}

normalize_channel_state() {
  local state="$1"
  case "${state}" in
    ChannelReady|CHANNEL_READY)
      printf 'CHANNEL_READY'
      ;;
    Closed|CLOSED)
      printf 'CLOSED'
      ;;
    *)
      printf '%s' "${state}"
      ;;
  esac
}

wait_until_channel_ready() {
  local target_dir="$1"
  local temporary_channel_id="${2:-}"
  local poll_log="${target_dir}/channel-ready.poll.log"
  : > "${poll_log}"

  local deadline
  deadline=$(( $(date +%s) + CHANNEL_READY_TIMEOUT_SECONDS ))
  local attempt=0
  local seen_channel=0

  while true; do
    attempt=$((attempt + 1))

    local payer_resp invoice_resp
    set +e
    payer_resp="$(list_channels_by_peer "${FNN_PAYER_RPC_PORT}" "${INVOICE_PEER_ID}")"
    local payer_rc=$?
    invoice_resp="$(list_channels_by_peer "${FNN_INVOICE_RPC_PORT}" "${PAYER_PEER_ID}")"
    local invoice_rc=$?
    set -e

    if [[ "${payer_rc}" -ne 0 || "${invoice_rc}" -ne 0 ]]; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "list_channels transport failed while waiting channel ready"
    fi

    printf '%s\n' "${payer_resp}" > "${target_dir}/list-channels-payer.response.${attempt}.json"
    printf '%s\n' "${invoice_resp}" > "${target_dir}/list-channels-invoice.response.${attempt}.json"

    if contains_jsonrpc_error "${payer_resp}"; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "list_channels payer failed: $(jsonrpc_error_message "${payer_resp}")"
    fi
    if contains_jsonrpc_error "${invoice_resp}"; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "list_channels invoice failed: $(jsonrpc_error_message "${invoice_resp}")"
    fi

    local payer_count invoice_count payer_state invoice_state payer_enabled invoice_enabled
    payer_count="$(printf '%s' "${payer_resp}" | jq -r '.result.channels | length')"
    invoice_count="$(printf '%s' "${invoice_resp}" | jq -r '.result.channels | length')"
    payer_state="$(extract_first_channel_state "${payer_resp}")"
    invoice_state="$(extract_first_channel_state "${invoice_resp}")"
    payer_state="$(normalize_channel_state "${payer_state}")"
    invoice_state="$(normalize_channel_state "${invoice_state}")"
    payer_enabled="$(printf '%s' "${payer_resp}" | jq -r '.result.channels[0].enabled // empty')"
    invoice_enabled="$(printf '%s' "${invoice_resp}" | jq -r '.result.channels[0].enabled // empty')"

    if [[ "${payer_count}" -gt 0 || "${invoice_count}" -gt 0 ]]; then
      seen_channel=1
    fi

    printf 'attempt=%s payer_count=%s payer_state=%s payer_enabled=%s invoice_count=%s invoice_state=%s invoice_enabled=%s at=%s\n' \
      "${attempt}" "${payer_count}" "${payer_state:-<empty>}" "${payer_enabled:-<empty>}" "${invoice_count}" "${invoice_state:-<empty>}" "${invoice_enabled:-<empty>}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${poll_log}"

    vlog "channel poll attempt=${attempt} payer=${payer_state:-<empty>} invoice=${invoice_state:-<empty>}"

    if [[ "${seen_channel}" -eq 1 && "${payer_count}" -eq 0 && "${invoice_count}" -eq 0 ]]; then
      fail_with_channel_topup_hint "channel dropped before ChannelReady"
    fi

    if [[ -n "${temporary_channel_id}" \
      && "${invoice_state}" == "AWAITING_CHANNEL_READY" \
      && "${CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS}" =~ ^[0-9]+$ \
      && "${CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS}" -gt 0 \
      && $((attempt % CHANNEL_ACCEPT_RETRY_INTERVAL_ATTEMPTS)) -eq 0 ]]; then
      vlog "channel poll attempt=${attempt} still awaiting channel ready; retrying accept_channel"
      accept_channel_on_invoice_node "${temporary_channel_id}" "${target_dir}"
    fi

    if [[ "${payer_count}" -gt 0 && "${invoice_count}" -gt 0 && "${payer_state}" == "CHANNEL_READY" && "${invoice_state}" == "CHANNEL_READY" ]]; then
      return 0
    fi

    if [[ "${payer_state}" == "CLOSED" || "${invoice_state}" == "CLOSED" ]]; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "channel entered Closed before ready"
    fi

    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      return 1
    fi

    sleep "${CHANNEL_POLL_INTERVAL_SECONDS}"
  done
}

has_ready_usdi_channel_on_port() {
  local rpc_port="$1"
  local peer_id="$2"

  if [[ -z "${USDI_TYPE_SCRIPT_JSON}" ]]; then
    return 1
  fi

  local response
  set +e
  response="$(list_channels_by_peer "${rpc_port}" "${peer_id}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    return 1
  fi
  if contains_jsonrpc_error "${response}"; then
    return 1
  fi

  if printf '%s' "${response}" | jq -e --argjson script "${USDI_TYPE_SCRIPT_JSON}" '
    .result.channels // []
    | any(
        ((.state.state_name // .state) | tostring) as $state
        | ($state == "CHANNEL_READY" or $state == "ChannelReady")
        and (.funding_udt_type_script != null)
        and ((.funding_udt_type_script.code_hash // "") == ($script.code_hash // ""))
        and ((.funding_udt_type_script.hash_type // "") == ($script.hash_type // ""))
        and ((.funding_udt_type_script.args // "") == ($script.args // ""))
      )
  ' >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

wait_until_usdi_channel_ready() {
  local target_dir="$1"
  local poll_log="${target_dir}/usdi-channel-ready.poll.log"
  : > "${poll_log}"

  local deadline
  deadline=$(( $(date +%s) + CHANNEL_READY_TIMEOUT_SECONDS ))
  local attempt=0

  while true; do
    attempt=$((attempt + 1))
    local payer_ready invoice_ready
    if has_ready_usdi_channel_on_port "${FNN_PAYER_RPC_PORT}" "${INVOICE_PEER_ID}"; then
      payer_ready=1
    else
      payer_ready=0
    fi
    if has_ready_usdi_channel_on_port "${FNN_INVOICE_RPC_PORT}" "${PAYER_PEER_ID}"; then
      invoice_ready=1
    else
      invoice_ready=0
    fi

    printf 'attempt=%s payer_ready=%s invoice_ready=%s at=%s\n' \
      "${attempt}" "${payer_ready}" "${invoice_ready}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${poll_log}"
    vlog "usdi channel poll attempt=${attempt} payer_ready=${payer_ready} invoice_ready=${invoice_ready}"

    if [[ "${payer_ready}" -eq 1 && "${invoice_ready}" -eq 1 ]]; then
      return 0
    fi

    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      return 1
    fi
    sleep "${CHANNEL_POLL_INTERVAL_SECONDS}"
  done
}

resolve_usdi_channel_funding_amount() {
  local amount="${USDI_CHANNEL_FUNDING_AMOUNT}"
  if [[ -z "${amount}" && -n "${USDI_AUTO_ACCEPT_AMOUNT_HEX}" ]]; then
    set +e
    amount="$(hex_quantity_to_decimal "${USDI_AUTO_ACCEPT_AMOUNT_HEX}")"
    local rc=$?
    set -e
    if [[ "${rc}" -ne 0 ]]; then
      amount=""
    fi
  fi
  if [[ -z "${amount}" ]]; then
    amount="${USDI_PAYMENT_AMOUNT}"
  fi
  if ! is_positive_integer "${amount}"; then
    amount="1"
  fi
  printf '%s' "${amount}"
}

bootstrap_usdi_channel() {
  local target_dir="$1"
  mkdir -p "${target_dir}"

  if [[ -z "${USDI_TYPE_SCRIPT_JSON}" ]]; then
    fatal "${EXIT_PRECHECK}" "node_info missing USDI udt script; cannot bootstrap USDI channel"
  fi

  if has_ready_usdi_channel_on_port "${FNN_PAYER_RPC_PORT}" "${INVOICE_PEER_ID}" \
    && has_ready_usdi_channel_on_port "${FNN_INVOICE_RPC_PORT}" "${PAYER_PEER_ID}"; then
    log "USDI channel already ready (fnn2 <-> fnn)"
    return 0
  fi

  local funding_amount funding_amount_hex temporary_channel_id accept_funding_hex
  funding_amount="$(resolve_usdi_channel_funding_amount)"
  funding_amount_hex="$(to_hex_quantity "${funding_amount}")"
  accept_funding_hex="${USDI_AUTO_ACCEPT_AMOUNT_HEX:-${funding_amount_hex}}"

  log "bootstrapping USDI channel (payer=fnn2 -> invoice=fnn, funding_amount=${funding_amount_hex})"
  open_channel_from_payer "${INVOICE_PEER_ID}" "${funding_amount_hex}" "${target_dir}" "${USDI_TYPE_SCRIPT_JSON}"
  temporary_channel_id="${OPEN_CHANNEL_TEMPORARY_ID}"
  printf '%s\n' "${temporary_channel_id}" > "${target_dir}/temporary-channel-id"

  accept_channel_on_invoice_node "${temporary_channel_id}" "${target_dir}" "${accept_funding_hex}"
  if ! wait_until_usdi_channel_ready "${target_dir}"; then
    fail_with_topup_hint "USDI" "timeout waiting fnn2<->fnn USDI channel to reach ChannelReady (likely missing UDT owner cells)"
  fi
  log "USDI channel is ready (fnn2 <-> fnn)"
}

bootstrap_dual_fnn_channel() {
  local target_dir="$1"
  mkdir -p "${target_dir}"

  log "bootstrapping dual fnn channel (payer=fnn2 -> invoice=fnn)"

  local invoice_info payer_info
  fetch_node_info "${FNN_INVOICE_RPC_PORT}" "${target_dir}/node-info-invoice.response.json"
  invoice_info="${NODE_INFO_RESULT}"
  fetch_node_info "${FNN_PAYER_RPC_PORT}" "${target_dir}/node-info-payer.response.json"
  payer_info="${NODE_INFO_RESULT}"

  PAYER_LOCK_SCRIPT_JSON="$(printf '%s' "${payer_info}" | jq -c '.result.default_funding_lock_script // empty')"
  INVOICE_LOCK_SCRIPT_JSON="$(printf '%s' "${invoice_info}" | jq -c '.result.default_funding_lock_script // empty')"
  DETECTED_USDI_CURRENCY="$(extract_usdi_currency_from_node_info "${payer_info}")"
  USDI_AUTO_ACCEPT_AMOUNT_HEX="$(extract_usdi_auto_accept_amount_from_node_info "${payer_info}")"
  USDI_TYPE_SCRIPT_JSON="$(extract_usdi_type_script_from_node_info "${payer_info}")"

  INVOICE_NODE_ID="$(printf '%s' "${invoice_info}" | jq -r '.result.node_id // empty')"
  PAYER_NODE_ID="$(printf '%s' "${payer_info}" | jq -r '.result.node_id // empty')"
  if [[ -z "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" ]]; then
    ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX="$(printf '%s' "${invoice_info}" | jq -r '.result.auto_accept_channel_ckb_funding_amount // empty')"
  fi
  if [[ -z "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" ]]; then
    ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX="$(to_hex_quantity "${CHANNEL_FUNDING_AMOUNT}")"
  fi

  if [[ -z "${INVOICE_NODE_ID}" || -z "${PAYER_NODE_ID}" ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "node_info missing node_id"
  fi

  INVOICE_PEER_ID="$(derive_peer_id_from_node_id "${INVOICE_NODE_ID}")"
  PAYER_PEER_ID="$(derive_peer_id_from_node_id "${PAYER_NODE_ID}")"
  if [[ -z "${INVOICE_PEER_ID}" || -z "${PAYER_PEER_ID}" ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "unable to derive peer_id from node_id"
  fi

  local invoice_ip payer_ip
  invoice_ip="$(get_container_ip "${INVOICE_NODE_CONTAINER}")"
  payer_ip="$(get_container_ip "${PAYER_NODE_CONTAINER}")"

  if [[ -z "${invoice_ip}" || -z "${payer_ip}" ]]; then
    fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "unable to resolve fnn container IPs"
  fi

  local invoice_addr payer_addr
  invoice_addr="/ip4/${invoice_ip}/tcp/8228/p2p/${INVOICE_PEER_ID}"
  payer_addr="/ip4/${payer_ip}/tcp/8228/p2p/${PAYER_PEER_ID}"

  printf '%s\n' "${invoice_addr}" > "${target_dir}/invoice-node.addr"
  printf '%s\n' "${payer_addr}" > "${target_dir}/payer-node.addr"

  connect_peer_on_port "${FNN_PAYER_RPC_PORT}" "${invoice_addr}" "payer-to-invoice" "${target_dir}"
  connect_peer_on_port "${FNN_INVOICE_RPC_PORT}" "${payer_addr}" "invoice-to-payer" "${target_dir}"

  local funding_amount_hex
  funding_amount_hex="$(to_hex_quantity "${CHANNEL_FUNDING_AMOUNT}")"
  local temporary_channel_id=""
  open_channel_from_payer "${INVOICE_PEER_ID}" "${funding_amount_hex}" "${target_dir}"
  temporary_channel_id="${OPEN_CHANNEL_TEMPORARY_ID}"
  printf '%s\n' "${temporary_channel_id}" > "${target_dir}/temporary-channel-id"

  # In local dual-node mode, auto-accept can be delayed. Try explicit accept first.
  accept_channel_on_invoice_node "${temporary_channel_id}" "${target_dir}"

  if ! wait_until_channel_ready "${target_dir}" "${temporary_channel_id}"; then
    log "channel not ready yet, trying accept_channel fallback"
    accept_channel_on_invoice_node "${temporary_channel_id}" "${target_dir}"
    if ! wait_until_channel_ready "${target_dir}" "${temporary_channel_id}"; then
      fatal "${EXIT_CHANNEL_BOOTSTRAP_FAILURE}" "timeout waiting fnn2<->fnn channel to reach ChannelReady"
    fi
  fi

  log "channel is ready (fnn2 <-> fnn)"
}

create_invoice() {
  local asset="$1"
  local amount="$2"
  local target_dir="$3"

  local payload
  payload="$(jq -cn \
    --arg id "tip-create-${asset,,}-$(date +%s)-$RANDOM" \
    --arg postId "e2e-${asset,,}-post-$(date +%s)-$RANDOM" \
    --arg fromUserId "e2e-${asset,,}-payer" \
    --arg toUserId "e2e-${asset,,}-payee" \
    --arg asset "${asset}" \
    --arg amount "${amount}" \
    '{jsonrpc:"2.0",id:$id,method:"tip.create",params:{postId:$postId,fromUserId:$fromUserId,toUserId:$toUserId,asset:$asset,amount:$amount}}')"
  printf '%s\n' "${payload}" > "${target_dir}/tip-create.request.json"

  local response
  set +e
  response="$(rpc_call_signed "${payload}" "tip-create-${asset,,}-$(date +%s)-$RANDOM")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_INVOICE_FAILURE}" "tip.create transport failed for ${asset}"
  fi
  printf '%s\n' "${response}" > "${target_dir}/tip-create.response.json"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_INVOICE_FAILURE}" "tip.create failed for ${asset}: $(jsonrpc_error_message "${response}")"
  fi

  local invoice
  invoice="$(printf '%s' "${response}" | jq -r '.result.invoice // empty')"
  if [[ -z "${invoice}" ]]; then
    fatal "${EXIT_INVOICE_FAILURE}" "tip.create returned empty invoice for ${asset}"
  fi

  CREATE_INVOICE_RESULT="${invoice}"
}

pay_invoice() {
  local asset="$1"
  local amount="$2"
  local invoice="$3"
  local target_dir="$4"

  local parse_payload
  parse_payload="$(jq -cn --arg id "parse-${asset,,}-$(date +%s)-$RANDOM" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"parse_invoice",params:[{invoice:$invoice}]}')"
  printf '%s\n' "${parse_payload}" > "${target_dir}/parse-invoice.request.json"

  local parse_response
  set +e
  parse_response="$(fnn_payer_rpc_call "${parse_payload}")"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_PAYMENT_FAILURE}" "parse_invoice transport failed for ${asset}"
  fi
  printf '%s\n' "${parse_response}" > "${target_dir}/parse-invoice.response.json"
  if contains_jsonrpc_error "${parse_response}"; then
    fatal "${EXIT_PAYMENT_FAILURE}" "parse_invoice failed for ${asset}: $(jsonrpc_error_message "${parse_response}")"
  fi

  local payment_hash
  payment_hash="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.payment_hash // empty')"
  if [[ -z "${payment_hash}" ]]; then
    fatal "${EXIT_PAYMENT_FAILURE}" "parse_invoice missing payment_hash for ${asset}"
  fi
  local target_pubkey
  target_pubkey="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .payee_public_key? // empty' | head -n1)"
  local final_tlc_expiry_delta
  final_tlc_expiry_delta="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .final_htlc_minimum_expiry_delta? // empty' | head -n1)"

  local currency
  currency="$(currency_for_asset "${asset}")"
  local amount_hex
  amount_hex="$(to_hex_quantity "${amount}")"
  local request_id="e2e-${asset,,}-pay-$(date +%s)-$RANDOM"

  local send_payload
  send_payload="$(jq -cn \
    --arg id "send-${asset,,}-$(date +%s)-$RANDOM" \
    --arg payment_hash "${payment_hash}" \
    --arg amount "${amount_hex}" \
    --arg currency "${currency}" \
    --arg request_id "${request_id}" \
    --arg invoice "${invoice}" \
    --arg target_pubkey "${target_pubkey}" \
    --arg final_tlc_expiry_delta "${final_tlc_expiry_delta}" \
    '
      {
        jsonrpc:"2.0",
        id:$id,
        method:"send_payment",
        params:[
          (
            {
              payment_hash:$payment_hash,
              amount:$amount,
              currency:$currency,
              request_id:$request_id,
              invoice:$invoice,
              allow_self_payment:true
            }
            | if $target_pubkey != "" then . + {target_pubkey:$target_pubkey} else . end
            | if $final_tlc_expiry_delta != "" then . + {final_tlc_expiry_delta:$final_tlc_expiry_delta} else . end
          )
        ]
      }
    '
  )"
  printf '%s\n' "${send_payload}" > "${target_dir}/send-payment.request.json"

  local send_response
  set +e
  send_response="$(fnn_payer_rpc_call "${send_payload}")"
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    fatal "${EXIT_PAYMENT_FAILURE}" "send_payment transport failed for ${asset}"
  fi
  printf '%s\n' "${send_response}" > "${target_dir}/send-payment.response.json"
  if contains_jsonrpc_error "${send_response}"; then
    local message
    message="$(jsonrpc_error_message "${send_response}")"
    if contains_insufficient_balance "${message}"; then
      fail_with_topup_hint "${asset}" "${message}"
    fi
    if contains_no_route "${message}"; then
      fail_with_route_hint "${asset}" "${message}"
    fi
    fatal "${EXIT_PAYMENT_FAILURE}" "send_payment failed for ${asset}: ${message}"
  fi

  local tx_hash
  tx_hash="$(printf '%s' "${send_response}" | jq -r '.result.tx_hash // .result.txHash // .result.payment_hash // .result.paymentHash // .result.hash // empty')"
  if [[ -z "${tx_hash}" ]]; then
    fatal "${EXIT_PAYMENT_FAILURE}" "send_payment returned no tx evidence for ${asset}"
  fi

  PAY_INVOICE_RESULT="${tx_hash}"
}

wait_until_settled() {
  local asset="$1"
  local invoice="$2"
  local target_dir="$3"
  local poll_log="${target_dir}/tip-status.poll.log"
  : > "${poll_log}"

  local deadline
  deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))
  local attempt=0
  while true; do
    attempt=$((attempt + 1))
    local payload
    payload="$(jq -cn --arg id "tip-status-${asset,,}-${attempt}" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"tip.status",params:{invoice:$invoice}}')"

    local response
    set +e
    response="$(rpc_call_signed "${payload}" "tip-status-${asset,,}-${attempt}-$(date +%s)")"
    local rc=$?
    set -e
    if [[ "${rc}" -ne 0 ]]; then
      fatal "${EXIT_SETTLEMENT_FAILURE}" "tip.status transport failed for ${asset}"
    fi
    printf '%s\n' "${response}" > "${target_dir}/tip-status.response.${attempt}.json"
    if contains_jsonrpc_error "${response}"; then
      fatal "${EXIT_SETTLEMENT_FAILURE}" "tip.status failed for ${asset}: $(jsonrpc_error_message "${response}")"
    fi

    local state
    state="$(printf '%s' "${response}" | jq -r '.result.state // empty')"
    printf 'attempt=%s state=%s at=%s\n' "${attempt}" "${state:-<empty>}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${poll_log}"
    vlog "${asset} settlement poll attempt=${attempt} state=${state}"

    if [[ "${state}" == "SETTLED" ]]; then
      SETTLEMENT_RESULT="${state}"
      return 0
    fi
    if [[ "${state}" == "FAILED" ]]; then
      fatal "${EXIT_SETTLEMENT_FAILURE}" "invoice moved to FAILED for ${asset}"
    fi

    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      fatal "${EXIT_SETTLEMENT_FAILURE}" "timeout waiting SETTLED for ${asset} invoice"
    fi
    sleep "${SETTLEMENT_POLL_INTERVAL_SECONDS}"
  done
}

run_asset_flow() {
  local asset="$1"
  local amount="$2"

  local target_dir="${ARTIFACT_DIR}/${asset,,}"
  mkdir -p "${target_dir}"

  log "=== ${asset} flow: faucet -> create invoice -> pay invoice -> confirm settled ==="

  if [[ "${asset}" == "CKB" ]]; then
    if [[ "${SKIP_CKB_FAUCET}" == "1" ]]; then
      log "CKB faucet skipped for payment flow (E2E_SKIP_CKB_FAUCET=1)"
    elif [[ "${CKB_PAYMENT_FAUCET_ON_FLOW}" == "1" ]]; then
      request_ckb_faucet "${CKB_TOPUP_ADDRESS}" "payer-payment" "${target_dir}"
    else
      ensure_ckb_balance_or_request_faucet "${CKB_TOPUP_ADDRESS}" "payer-payment" "${target_dir}" "${amount}" "${PAYER_LOCK_SCRIPT_JSON}"
    fi
  else
    request_usdi_faucet "${target_dir}" "${amount}"
    bootstrap_usdi_channel "${target_dir}/usdi-channel-bootstrap"
  fi

  local invoice=""
  create_invoice "${asset}" "${amount}" "${target_dir}"
  invoice="${CREATE_INVOICE_RESULT}"
  log "${asset} invoice created: ${invoice}"

  local tx_hash=""
  pay_invoice "${asset}" "${amount}" "${invoice}" "${target_dir}"
  tx_hash="${PAY_INVOICE_RESULT}"
  log "${asset} payment submitted: ${tx_hash}"

  local final_state=""
  wait_until_settled "${asset}" "${invoice}" "${target_dir}"
  final_state="${SETTLEMENT_RESULT}"
  log "${asset} invoice settled: state=${final_state}"

  printf '%s\t%s\t%s\t%s\n' "${asset}" "${invoice}" "${tx_hash}" "${final_state}" >> "${SUMMARY_FILE}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-up)
      KEEP_STACK_UP=1
      ;;
    --prepare-only)
      PREPARE_ONLY=1
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

mkdir -p "${ARTIFACT_DIR}"
printf 'asset\tinvoice\ttx_hash\tfinal_state\n' > "${SUMMARY_FILE}"

for binary in docker curl openssl awk jq grep node; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    fatal "${EXIT_PRECHECK}" "missing required binary: ${binary}"
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  fatal "${EXIT_PRECHECK}" "docker compose v2 is required"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  fatal "${EXIT_PRECHECK}" "missing ${ENV_FILE} (copy deploy/compose/.env.example first)"
fi

required_env_keys=(
  POSTGRES_PASSWORD
  FIBER_SECRET_KEY_PASSWORD
  FIBER_LINK_HMAC_SECRET
  FNN_ASSET_SHA256
)
for key in "${required_env_keys[@]}"; do
  value="$(get_env_value "${key}")"
  if [[ -z "${value}" ]]; then
    fatal "${EXIT_PRECHECK}" "${key} must be set in ${ENV_FILE}"
  fi
done

set -a
# shellcheck disable=SC1090
preloaded_rpc_port="${RPC_PORT:-}"
source "${ENV_FILE}"
set +a

if [[ -n "${preloaded_rpc_port}" ]]; then
  RPC_PORT="${preloaded_rpc_port}"
fi

RPC_PORT="${RPC_PORT:-3000}"
FNN_INVOICE_RPC_PORT="${FNN_RPC_PORT:-8227}"
FNN_PAYER_RPC_PORT="${FNN2_RPC_PORT:-9227}"

if [[ -z "${FIBER_LINK_HMAC_SECRET:-}" ]]; then
  fatal "${EXIT_PRECHECK}" "FIBER_LINK_HMAC_SECRET must be non-empty in ${ENV_FILE}"
fi

if ! is_positive_integer "${CKB_PAYMENT_AMOUNT}"; then
  fatal "${EXIT_PRECHECK}" "E2E_CKB_PAYMENT_AMOUNT must be a positive integer"
fi
if ! is_positive_integer "${USDI_PAYMENT_AMOUNT}"; then
  fatal "${EXIT_PRECHECK}" "E2E_USDI_PAYMENT_AMOUNT must be a positive integer"
fi
if ! is_positive_integer "${CKB_FAUCET_AMOUNT}"; then
  fatal "${EXIT_PRECHECK}" "CKB_FAUCET_AMOUNT must be a positive integer"
fi
if ! is_positive_integer "${CKB_FAUCET_WAIT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "CKB_FAUCET_WAIT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "CKB_POST_FAUCET_BALANCE_WAIT_TIMEOUT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "CKB_POST_FAUCET_BALANCE_POLL_INTERVAL_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${USDI_FAUCET_WAIT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "USDI_FAUCET_WAIT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${NODE_INFO_DERIVE_RETRIES}"; then
  fatal "${EXIT_PRECHECK}" "NODE_INFO_DERIVE_RETRIES must be a positive integer"
fi
if ! is_positive_integer "${NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "NODE_INFO_DERIVE_RETRY_INTERVAL_SECONDS must be a positive integer"
fi
if [[ -n "${USDI_CHANNEL_FUNDING_AMOUNT}" ]] && ! is_positive_integer "${USDI_CHANNEL_FUNDING_AMOUNT}"; then
  fatal "${EXIT_PRECHECK}" "E2E_USDI_CHANNEL_FUNDING_AMOUNT must be a positive integer"
fi
if ! is_positive_integer "${WAIT_TIMEOUT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "WAIT_TIMEOUT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${COMPOSE_UP_TIMEOUT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "COMPOSE_UP_TIMEOUT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${SETTLEMENT_TIMEOUT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "SETTLEMENT_TIMEOUT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${SETTLEMENT_POLL_INTERVAL_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "SETTLEMENT_POLL_INTERVAL_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${CHANNEL_READY_TIMEOUT_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "CHANNEL_READY_TIMEOUT_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${CHANNEL_POLL_INTERVAL_SECONDS}"; then
  fatal "${EXIT_PRECHECK}" "CHANNEL_POLL_INTERVAL_SECONDS must be a positive integer"
fi
if ! is_positive_integer "${CKB_BALANCE_CHECK_LIMIT_PAGES}"; then
  fatal "${EXIT_PRECHECK}" "E2E_CKB_BALANCE_CHECK_LIMIT_PAGES must be a positive integer"
fi
if ! is_positive_integer "${USDI_BALANCE_CHECK_LIMIT_PAGES}"; then
  fatal "${EXIT_PRECHECK}" "E2E_USDI_BALANCE_CHECK_LIMIT_PAGES must be a positive integer"
fi
if ! is_positive_integer "${CHANNEL_FUNDING_AMOUNT}"; then
  fatal "${EXIT_PRECHECK}" "E2E_CHANNEL_FUNDING_AMOUNT must be a positive integer"
fi
if [[ "${TOPUP_INVOICE_NODE_CKB}" != "0" && "${TOPUP_INVOICE_NODE_CKB}" != "1" ]]; then
  fatal "${EXIT_PRECHECK}" "E2E_TOPUP_INVOICE_NODE_CKB must be 0 or 1"
fi
if [[ "${SKIP_CKB_FAUCET}" != "0" && "${SKIP_CKB_FAUCET}" != "1" ]]; then
  fatal "${EXIT_PRECHECK}" "E2E_SKIP_CKB_FAUCET must be 0 or 1"
fi
if [[ "${CKB_PAYMENT_FAUCET_ON_FLOW}" != "0" && "${CKB_PAYMENT_FAUCET_ON_FLOW}" != "1" ]]; then
  fatal "${EXIT_PRECHECK}" "E2E_CKB_PAYMENT_FAUCET_ON_FLOW must be 0 or 1"
fi
if [[ "${CKB_FAUCET_ENABLE_FALLBACK}" != "0" && "${CKB_FAUCET_ENABLE_FALLBACK}" != "1" ]]; then
  fatal "${EXIT_PRECHECK}" "CKB_FAUCET_ENABLE_FALLBACK must be 0 or 1"
fi
if [[ -n "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" && ! "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" =~ ^0x[0-9a-fA-F]+$ ]]; then
  fatal "${EXIT_PRECHECK}" "E2E_ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX must be hex quantity like 0x24e160300"
fi

if [[ "${PREPARE_ONLY}" -ne 1 && -z "${USDI_FAUCET_COMMAND}" ]]; then
  USDI_FAUCET_COMMAND='curl -fsS -X POST https://ckb-utilities.random-walk.co.jp/api/faucet -H "content-type: application/json" -d "{\"address\":\"${E2E_FAUCET_ADDRESS}\",\"token\":\"usdi\"}"'
  log "E2E_USDI_FAUCET_COMMAND is unset; using built-in default faucet command"
fi

log "starting compose services"
ensure_rpc_port_available
vlog "effective rpc_port=${RPC_PORT}"
vlog "reset compose stack to deterministic baseline"
reset_compose_stack
set +e
compose_up_with_timeout "${COMPOSE_UP_TIMEOUT_SECONDS}" "${ARTIFACT_DIR}/compose-up.log"
compose_up_rc=$?
set -e
if [[ "${compose_up_rc}" -eq 124 ]]; then
  compose ps > "${ARTIFACT_DIR}/compose-timeout.ps.log" 2>&1 || true
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' > "${ARTIFACT_DIR}/compose-timeout.docker-ps.log" 2>&1 || true
  fatal "${EXIT_STARTUP_TIMEOUT}" "docker compose up exceeded ${COMPOSE_UP_TIMEOUT_SECONDS}s (see compose-up.log and compose-timeout.*.log)"
fi
if [[ "${compose_up_rc}" -ne 0 ]]; then
  if grep -Eqi 'address already in use|port is already allocated|bind: address already in use' "${ARTIFACT_DIR}/compose-up.log"; then
    fatal "${EXIT_STARTUP_TIMEOUT}" "docker compose failed due to host port conflict (see compose-up.log)"
  fi
  fatal "${EXIT_STARTUP_TIMEOUT}" "docker compose up failed (see compose-up.log)"
fi
STARTED_COMPOSE=1

wait_for_state "fiber-link-postgres" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "postgres startup timeout"
wait_for_state "fiber-link-redis" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "redis startup timeout"
wait_for_state "fiber-link-fnn" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "fnn startup timeout"
wait_for_state "fiber-link-fnn2" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "fnn2 startup timeout"
wait_for_state "fiber-link-rpc" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "rpc startup timeout"
run_service_db_migrations
wait_for_state "fiber-link-worker" "healthy" || fatal "${EXIT_STARTUP_TIMEOUT}" "worker startup timeout"

if [[ -z "${CKB_TOPUP_ADDRESS}" ]]; then
  set +e
  CKB_TOPUP_ADDRESS="$(derive_ckb_topup_address_with_retry "${FNN_PAYER_RPC_PORT}" "fnn2")"
  local_rc=$?
  set -e
  if [[ "${local_rc}" -ne 0 || -z "${CKB_TOPUP_ADDRESS}" ]]; then
    fatal "${EXIT_PRECHECK}" "unable to derive payer CKB top-up address from fnn2 node_info; set E2E_CKB_TOPUP_ADDRESS"
  fi
  log "derived payer E2E_CKB_TOPUP_ADDRESS=${CKB_TOPUP_ADDRESS}"
fi

if [[ -z "${CKB_INVOICE_NODE_TOPUP_ADDRESS}" ]]; then
  set +e
  CKB_INVOICE_NODE_TOPUP_ADDRESS="$(derive_ckb_topup_address_with_retry "${FNN_INVOICE_RPC_PORT}" "fnn")"
  local_rc=$?
  set -e
  if [[ "${local_rc}" -ne 0 || -z "${CKB_INVOICE_NODE_TOPUP_ADDRESS}" ]]; then
    fatal "${EXIT_PRECHECK}" "unable to derive invoice-node CKB top-up address from fnn node_info; set E2E_CKB_INVOICE_TOPUP_ADDRESS"
  fi
  log "derived E2E_CKB_INVOICE_TOPUP_ADDRESS=${CKB_INVOICE_NODE_TOPUP_ADDRESS}"
fi

if [[ -z "${USDI_TOPUP_ADDRESS}" ]]; then
  USDI_TOPUP_ADDRESS="${CKB_TOPUP_ADDRESS}"
fi

bootstrap_dir="${ARTIFACT_DIR}/bootstrap"
mkdir -p "${bootstrap_dir}"
hydrate_lock_scripts_for_balance_precheck "${bootstrap_dir}"

payer_bootstrap_required_amount="${CHANNEL_FUNDING_AMOUNT}"
invoice_bootstrap_required_amount="1"
if [[ -n "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}" ]]; then
  set +e
  invoice_bootstrap_required_amount="$(hex_quantity_to_decimal "${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}")"
  local_rc=$?
  set -e
  if [[ "${local_rc}" -ne 0 ]]; then
    invoice_bootstrap_required_amount="1"
  elif ! is_positive_integer "${invoice_bootstrap_required_amount}"; then
    invoice_bootstrap_required_amount="1"
  fi
fi

# Ensure both sides have enough CKB to establish/accept channels.
if [[ "${SKIP_CKB_FAUCET}" == "1" ]]; then
  log "CKB faucet skipped for bootstrap (E2E_SKIP_CKB_FAUCET=1)"
else
  ensure_ckb_balance_or_request_faucet "${CKB_TOPUP_ADDRESS}" "payer-bootstrap" "${bootstrap_dir}" "${payer_bootstrap_required_amount}" "${PAYER_LOCK_SCRIPT_JSON}"
  if [[ "${TOPUP_INVOICE_NODE_CKB}" == "1" && "${CKB_INVOICE_NODE_TOPUP_ADDRESS}" != "${CKB_TOPUP_ADDRESS}" ]]; then
    ensure_ckb_balance_or_request_faucet "${CKB_INVOICE_NODE_TOPUP_ADDRESS}" "invoice-bootstrap" "${bootstrap_dir}" "${invoice_bootstrap_required_amount}" "${INVOICE_LOCK_SCRIPT_JSON}"
  else
    log "invoice bootstrap CKB faucet skipped (E2E_TOPUP_INVOICE_NODE_CKB=${TOPUP_INVOICE_NODE_CKB})"
  fi
fi

bootstrap_dual_fnn_channel "${bootstrap_dir}"

if [[ "${PREPARE_ONLY}" -eq 1 ]]; then
  log "prepare-only mode finished"
  log "accept_channel_funding_amount=${ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX}"
  log "payer_node=fnn2 node_id=${PAYER_NODE_ID} peer_id=${PAYER_PEER_ID} ckb_address=${CKB_TOPUP_ADDRESS} usdi_address=${USDI_TOPUP_ADDRESS}"
  log "invoice_node=fnn node_id=${INVOICE_NODE_ID} peer_id=${INVOICE_PEER_ID} ckb_address=${CKB_INVOICE_NODE_TOPUP_ADDRESS}"
  finalize_and_exit "${EXIT_OK}" "prepare-only complete"
fi

run_asset_flow "CKB" "${CKB_PAYMENT_AMOUNT}"
run_asset_flow "USDI" "${USDI_PAYMENT_AMOUNT}"

log "all flows passed"
log "summary:"
cat "${SUMMARY_FILE}"

finalize_and_exit "${EXIT_OK}" "ok"
