#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_DISCOURSE=11
EXIT_TIP=12
EXIT_SETTLEMENT=13
EXIT_BALANCE=14
EXIT_WITHDRAWAL=15

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
DISCOURSE_REF="${DISCOURSE_REF:-26f3e2aa87a3abb35849183e0740fe7ab84cec67}"
ARTIFACT_DIR="${ROOT_DIR}/.tmp/local-workflow-automation/$(date -u +%Y%m%dT%H%M%SZ)"

VERBOSE=0
SKIP_SERVICES=0
SKIP_DISCOURSE=0
PAUSE_AT_STEP4=0
START_EMBER_CLI=0

WORKFLOW_ASSET="${WORKFLOW_ASSET:-CKB}"
TIP_AMOUNT="${WORKFLOW_TIP_AMOUNT:-31}"
WITHDRAW_AMOUNT="${WORKFLOW_WITHDRAW_AMOUNT:-61}"
WITHDRAW_TO_ADDRESS="${WORKFLOW_WITHDRAW_TO_ADDRESS:-}"
POLL_INTERVAL_SECONDS="${WORKFLOW_POLL_INTERVAL_SECONDS:-5}"
SETTLEMENT_TIMEOUT_SECONDS="${WORKFLOW_SETTLEMENT_TIMEOUT_SECONDS:-240}"
WITHDRAWAL_TIMEOUT_SECONDS="${WORKFLOW_WITHDRAWAL_TIMEOUT_SECONDS:-360}"

TOPIC_LABEL="${WORKFLOW_TOPIC_TITLE:-Fiber Link Local Workflow Topic}"
TOPIC_BODY="${WORKFLOW_TOPIC_BODY:-This topic is created by local workflow automation.}"
REPLY_BODY="${WORKFLOW_REPLY_BODY:-This reply is created by local workflow automation.}"

usage() {
  cat <<'EOF'
Usage: scripts/local-workflow-automation.sh [--verbose] [--skip-services] [--skip-discourse] [--pause-at-step4] [--with-ember-cli]

Automates local workflow:
1) launch discourse
2) launch fiber link services (dual FNN + channel bootstrap)
3) install discourse plugin + configure settings
4) tip topic post and reply post
5) check author balance via dashboard.summary
6) request withdrawal and wait for completion

Options:
  --verbose         Print detailed logs.
  --skip-services   Skip services/bootstrap step (assume already running and ready).
  --skip-discourse  Skip discourse bootstrap/seeding step (assume IDs provided through env).
  --pause-at-step4  Pause before tip actions and wait for Enter.
  --with-ember-cli  Start Ember CLI proxy and expose interactive UI at http://127.0.0.1:4200/login.
  -h, --help        Show this help message.

Environment knobs:
  WORKFLOW_ASSET=CKB
  WORKFLOW_TIP_AMOUNT=31
  WORKFLOW_WITHDRAW_AMOUNT=61
  WORKFLOW_WITHDRAW_TO_ADDRESS=ckt1...
  WORKFLOW_POLL_INTERVAL_SECONDS=5
  WORKFLOW_SETTLEMENT_TIMEOUT_SECONDS=240
  WORKFLOW_WITHDRAWAL_TIMEOUT_SECONDS=360
  DISCOURSE_DEV_ROOT=/tmp/discourse-dev
  DISCOURSE_REF=26f3e2aa87a3abb35849183e0740fe7ab84cec67

When --skip-discourse is used, these are required:
  WORKFLOW_TIPPER_USER_ID
  WORKFLOW_AUTHOR_USER_ID
  WORKFLOW_TOPIC_POST_ID
  WORKFLOW_REPLY_POST_ID
EOF
}

log() {
  printf '[local-workflow] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

fatal() {
  local code="$1"
  shift
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s ARTIFACT_DIR=%s\n' "${code}" "$*" "${ARTIFACT_DIR}"
  exit "${code}"
}

require_cmd() {
  local name="$1"
  command -v "${name}" >/dev/null 2>&1 || fatal "${EXIT_PRECHECK}" "missing required command: ${name}"
}

get_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${COMPOSE_ENV_FILE}" | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    printf ''
    return
  fi
  printf '%s' "${line#*=}"
}

to_hex_quantity() {
  local amount="$1"
  if ! [[ "${amount}" =~ ^[0-9]+$ ]]; then
    fatal "${EXIT_PRECHECK}" "amount must be a positive integer, got '${amount}'"
  fi
  printf '0x%x' "${amount}"
}

contains_jsonrpc_error() {
  local payload="$1"
  printf '%s' "${payload}" | jq -e 'has("error") and .error != null' >/dev/null 2>&1
}

jsonrpc_error_message() {
  local payload="$1"
  printf '%s' "${payload}" | jq -r '.error.message // "unknown json-rpc error"'
}

sign_payload() {
  local payload="$1"
  local ts="$2"
  local nonce="$3"
  printf '%s' "${ts}.${nonce}.${payload}" \
    | openssl dgst -sha256 -hmac "${APP_SECRET}" -hex \
    | awk '{print $2}'
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

ensure_ember_cli_proxy() {
  local ember_url="http://127.0.0.1:4200/login"
  local ember_log="${ARTIFACT_DIR}/discourse-ember-cli.log"

  if docker exec discourse_dev sh -lc "pgrep -f 'ember server --proxy http://127.0.0.1:3000' >/dev/null 2>&1"; then
    log "ember-cli proxy already running (${ember_url})"
  else
    log "starting ember-cli proxy (first compile can take a few minutes)"
    docker exec -u discourse:discourse -w /src discourse_dev sh -lc 'bin/ember-cli' > "${ember_log}" 2>&1 &
    vlog "ember-cli logs: ${ember_log}"
  fi

  wait_http_ready "${ember_url}" 420 || fatal "${EXIT_DISCOURSE}" "ember-cli proxy did not become ready at ${ember_url} (see ${ember_log})"
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

fnn_payer_rpc_call() {
  local payload="$1"
  curl -fsS "http://127.0.0.1:${FNN2_RPC_PORT}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

derive_ckb_testnet_address_from_lock_args() {
  local lock_args="$1"
  python3 - "${lock_args}" <<'PY'
import sys

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

def hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def polymod(values):
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            if (top >> i) & 1:
                chk ^= GEN[i]
    return chk

def create_checksum(hrp, data):
    values = hrp_expand(hrp) + data
    polym = polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polym >> 5 * (5 - i)) & 31 for i in range(6)]

def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return ret

lock_args = sys.argv[1].strip()
if lock_args.startswith("0x"):
    lock_args = lock_args[2:]
if len(lock_args) != 40:
    raise SystemExit(1)

payload = bytes([0x01, 0x00]) + bytes.fromhex(lock_args)
data = convertbits(payload, 8, 5, True)
if data is None:
    raise SystemExit(1)

checksum = create_checksum("ckt", data)
addr = "ckt1" + "".join(CHARSET[d] for d in (data + checksum))
print(addr)
PY
}

resolve_withdraw_to_address() {
  if [[ -n "${WITHDRAW_TO_ADDRESS}" ]]; then
    printf '%s' "${WITHDRAW_TO_ADDRESS}"
    return 0
  fi

  local payload response lock_args
  payload='{"jsonrpc":"2.0","id":"withdraw-destination","method":"node_info","params":[]}'
  response="$(fnn_payer_rpc_call "${payload}")"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_WITHDRAWAL}" "node_info failed while deriving withdraw destination: $(jsonrpc_error_message "${response}")"
  fi

  lock_args="$(printf '%s' "${response}" | jq -r '.result.default_funding_lock_script.args // empty')"
  if [[ -z "${lock_args}" ]]; then
    fatal "${EXIT_WITHDRAWAL}" "node_info missing default_funding_lock_script.args"
  fi

  derive_ckb_testnet_address_from_lock_args "${lock_args}" \
    || fatal "${EXIT_WITHDRAWAL}" "failed to derive testnet CKB address from lock args"
}

currency_for_asset() {
  local asset="$1"
  if [[ "${asset}" != "CKB" ]]; then
    fatal "${EXIT_PRECHECK}" "WORKFLOW_ASSET currently supports only CKB"
  fi

  local scoped_key="FIBER_INVOICE_CURRENCY_CKB"
  local scoped_val="${!scoped_key:-}"
  if [[ -n "${scoped_val}" ]]; then
    printf '%s' "${scoped_val}"
    return
  fi

  local env_scoped
  env_scoped="$(get_env_value "${scoped_key}")"
  if [[ -n "${env_scoped}" ]]; then
    printf '%s' "${env_scoped}"
    return
  fi

  local global_env="${FIBER_INVOICE_CURRENCY:-}"
  if [[ -n "${global_env}" ]]; then
    printf '%s' "${global_env}"
    return
  fi

  printf 'Fibt'
}

create_tip_invoice() {
  local label="$1"
  local post_id="$2"
  local from_user_id="$3"
  local to_user_id="$4"
  local dir="${ARTIFACT_DIR}/tips/${label}"
  mkdir -p "${dir}"

  local payload
  payload="$(jq -cn \
    --arg id "tip-${label}-$(date +%s)-$RANDOM" \
    --arg postId "${post_id}" \
    --arg fromUserId "${from_user_id}" \
    --arg toUserId "${to_user_id}" \
    --arg asset "${WORKFLOW_ASSET}" \
    --arg amount "${TIP_AMOUNT}" \
    '{jsonrpc:"2.0",id:$id,method:"tip.create",params:{postId:$postId,fromUserId:$fromUserId,toUserId:$toUserId,asset:$asset,amount:$amount}}')"
  printf '%s\n' "${payload}" > "${dir}/tip-create.request.json"

  local response
  response="$(rpc_call_signed "${payload}" "tip-${label}-nonce-$(date +%s)-$RANDOM")"
  printf '%s\n' "${response}" > "${dir}/tip-create.response.json"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_TIP}" "tip.create failed for ${label}: $(jsonrpc_error_message "${response}")"
  fi

  local invoice
  invoice="$(printf '%s' "${response}" | jq -r '.result.invoice // empty')"
  if [[ -z "${invoice}" ]]; then
    fatal "${EXIT_TIP}" "tip.create returned empty invoice for ${label}"
  fi
  printf '%s' "${invoice}"
}

pay_invoice_from_payer() {
  local label="$1"
  local invoice="$2"
  local amount="$3"
  local dir="${ARTIFACT_DIR}/tips/${label}"

  local parse_payload parse_response payment_hash target_pubkey final_tlc_expiry_delta
  parse_payload="$(jq -cn --arg id "parse-${label}-$(date +%s)-$RANDOM" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"parse_invoice",params:[{invoice:$invoice}]}')"
  printf '%s\n' "${parse_payload}" > "${dir}/parse-invoice.request.json"

  parse_response="$(fnn_payer_rpc_call "${parse_payload}")"
  printf '%s\n' "${parse_response}" > "${dir}/parse-invoice.response.json"
  if contains_jsonrpc_error "${parse_response}"; then
    fatal "${EXIT_TIP}" "parse_invoice failed for ${label}: $(jsonrpc_error_message "${parse_response}")"
  fi

  payment_hash="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.payment_hash // empty')"
  target_pubkey="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .payee_public_key? // empty' | head -n1)"
  final_tlc_expiry_delta="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .final_htlc_minimum_expiry_delta? // empty' | head -n1)"
  if [[ -z "${payment_hash}" ]]; then
    fatal "${EXIT_TIP}" "parse_invoice did not return payment_hash for ${label}"
  fi

  local send_payload send_response tx_hash amount_hex
  amount_hex="$(to_hex_quantity "${amount}")"
  send_payload="$(jq -cn \
    --arg id "send-${label}-$(date +%s)-$RANDOM" \
    --arg payment_hash "${payment_hash}" \
    --arg amount "${amount_hex}" \
    --arg currency "${CURRENCY}" \
    --arg request_id "local-workflow-${label}-$(date +%s)-$RANDOM" \
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
    ')"
  printf '%s\n' "${send_payload}" > "${dir}/send-payment.request.json"

  send_response="$(fnn_payer_rpc_call "${send_payload}")"
  printf '%s\n' "${send_response}" > "${dir}/send-payment.response.json"
  if contains_jsonrpc_error "${send_response}"; then
    fatal "${EXIT_TIP}" "send_payment failed for ${label}: $(jsonrpc_error_message "${send_response}")"
  fi

  tx_hash="$(printf '%s' "${send_response}" | jq -r '.result.tx_hash // .result.txHash // .result.payment_hash // .result.paymentHash // .result.hash // empty')"
  if [[ -z "${tx_hash}" ]]; then
    fatal "${EXIT_TIP}" "send_payment returned no tx hash for ${label}"
  fi
  printf '%s' "${tx_hash}"
}

wait_tip_settled() {
  local label="$1"
  local invoice="$2"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))
  local attempt=0
  local dir="${ARTIFACT_DIR}/tips/${label}"
  local poll_log="${dir}/tip-status.poll.log"
  : > "${poll_log}"

  while [[ "$(date +%s)" -lt "${deadline}" ]]; do
    attempt=$((attempt + 1))
    local payload response state
    payload="$(jq -cn --arg id "status-${label}-${attempt}" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"tip.status",params:{invoice:$invoice}}')"
    response="$(rpc_call_signed "${payload}" "tip-status-${label}-${attempt}-$(date +%s)")"
    printf '%s\n' "${response}" >> "${poll_log}"
    if contains_jsonrpc_error "${response}"; then
      fatal "${EXIT_SETTLEMENT}" "tip.status failed for ${label}: $(jsonrpc_error_message "${response}")"
    fi
    state="$(printf '%s' "${response}" | jq -r '.result.state // empty')"
    if [[ "${state}" == "SETTLED" ]]; then
      return 0
    fi
    if [[ "${state}" == "FAILED" ]]; then
      fatal "${EXIT_SETTLEMENT}" "tip.status reached FAILED for ${label}"
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done

  fatal "${EXIT_SETTLEMENT}" "timeout waiting tip settlement for ${label}"
}

dashboard_summary() {
  local user_id="$1"
  local include_admin="$2"
  local payload
  payload="$(jq -cn \
    --arg id "dash-$(date +%s)-$RANDOM" \
    --arg userId "${user_id}" \
    --argjson includeAdmin "${include_admin}" \
    '{jsonrpc:"2.0",id:$id,method:"dashboard.summary",params:{userId:$userId,includeAdmin:$includeAdmin,limit:50}}')"
  rpc_call_signed "${payload}" "dashboard-$(date +%s)-$RANDOM"
}

request_withdrawal() {
  local user_id="$1"
  local to_address="$2"
  local dir="${ARTIFACT_DIR}/withdrawal"
  mkdir -p "${dir}"

  local payload response
  payload="$(jq -cn \
    --arg id "withdraw-request-$(date +%s)-$RANDOM" \
    --arg userId "${user_id}" \
    --arg asset "${WORKFLOW_ASSET}" \
    --arg amount "${WITHDRAW_AMOUNT}" \
    --arg toAddress "${to_address}" \
    '{jsonrpc:"2.0",id:$id,method:"withdrawal.request",params:{userId:$userId,asset:$asset,amount:$amount,toAddress:$toAddress}}')"
  printf '%s\n' "${payload}" > "${dir}/withdrawal.request.json"

  response="$(rpc_call_signed "${payload}" "withdrawal-request-$(date +%s)-$RANDOM")"
  printf '%s\n' "${response}" > "${dir}/withdrawal.response.json"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_WITHDRAWAL}" "withdrawal.request failed: $(jsonrpc_error_message "${response}")"
  fi

  local withdrawal_id
  withdrawal_id="$(printf '%s' "${response}" | jq -r '.result.id // empty')"
  if [[ -z "${withdrawal_id}" ]]; then
    fatal "${EXIT_WITHDRAWAL}" "withdrawal.request returned empty id"
  fi
  printf '%s' "${withdrawal_id}"
}

wait_withdrawal_completed() {
  local user_id="$1"
  local withdrawal_id="$2"
  local dir="${ARTIFACT_DIR}/withdrawal"
  local poll_log="${dir}/withdrawal-status.poll.log"
  : > "${poll_log}"
  local deadline=$(( $(date +%s) + WITHDRAWAL_TIMEOUT_SECONDS ))
  local attempt=0

  while [[ "$(date +%s)" -lt "${deadline}" ]]; do
    attempt=$((attempt + 1))
    local response state
    response="$(dashboard_summary "${user_id}" true)"
    printf '%s\n' "${response}" >> "${poll_log}"
    if contains_jsonrpc_error "${response}"; then
      fatal "${EXIT_WITHDRAWAL}" "dashboard.summary failed while polling withdrawal state: $(jsonrpc_error_message "${response}")"
    fi

    state="$(printf '%s' "${response}" | jq -r --arg wid "${withdrawal_id}" '.result.admin.withdrawals[]? | select(.id == $wid) | .state' | head -n1)"
    if [[ "${state}" == "COMPLETED" ]]; then
      printf '%s' "${state}"
      return 0
    fi
    if [[ "${state}" == "FAILED" ]]; then
      fatal "${EXIT_WITHDRAWAL}" "withdrawal ${withdrawal_id} reached FAILED"
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done

  fatal "${EXIT_WITHDRAWAL}" "timeout waiting withdrawal ${withdrawal_id} completion"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose)
      VERBOSE=1
      ;;
    --skip-services)
      SKIP_SERVICES=1
      ;;
    --skip-discourse)
      SKIP_DISCOURSE=1
      ;;
    --pause-at-step4)
      PAUSE_AT_STEP4=1
      ;;
    --with-ember-cli)
      START_EMBER_CLI=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fatal "${EXIT_USAGE}" "unknown option: $1"
      ;;
  esac
  shift
done

mkdir -p "${ARTIFACT_DIR}"

if [[ "${PAUSE_AT_STEP4}" -eq 1 ]]; then
  START_EMBER_CLI=1
fi

require_cmd docker
require_cmd git
require_cmd curl
require_cmd jq
require_cmd openssl
require_cmd awk
require_cmd python3

[[ -f "${COMPOSE_ENV_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing ${COMPOSE_ENV_FILE}; copy deploy/compose/.env.example first"
[[ "${WORKFLOW_ASSET}" == "CKB" ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_ASSET currently supports only CKB"
[[ "${TIP_AMOUNT}" =~ ^[0-9]+$ && "${TIP_AMOUNT}" -gt 0 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_TIP_AMOUNT must be a positive integer"
[[ "${WITHDRAW_AMOUNT}" =~ ^[0-9]+$ && "${WITHDRAW_AMOUNT}" -gt 0 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_AMOUNT must be a positive integer"
[[ "${WITHDRAW_AMOUNT}" -ge 61 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_AMOUNT must be >= 61 for CKB cell minimum"
if [[ -n "${WITHDRAW_TO_ADDRESS}" && ! "${WITHDRAW_TO_ADDRESS}" =~ ^(ckt|ckb)1[0-9a-zA-Z]+$ ]]; then
  fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_TO_ADDRESS must be a ckt1... or ckb1... address"
fi

APP_SECRET="${FIBER_LINK_APP_SECRET:-}"
if [[ -z "${APP_SECRET}" ]]; then
  APP_SECRET="$(get_env_value FIBER_LINK_HMAC_SECRET)"
fi
[[ -n "${APP_SECRET}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_LINK_HMAC_SECRET/FIBER_LINK_APP_SECRET is required"

WITHDRAWAL_PRIVATE_KEY="${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-}"
if [[ -z "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
  WITHDRAWAL_PRIVATE_KEY="$(get_env_value FIBER_WITHDRAWAL_CKB_PRIVATE_KEY)"
fi
[[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required for on-chain withdrawal"

APP_ID="${FIBER_LINK_APP_ID:-${E2E_APP_ID:-local-dev}}"
RPC_PORT="${RPC_PORT:-$(get_env_value RPC_PORT)}"
FNN2_RPC_PORT="${FNN2_RPC_PORT:-$(get_env_value FNN2_RPC_PORT)}"
RPC_PORT="${RPC_PORT:-3000}"
FNN2_RPC_PORT="${FNN2_RPC_PORT:-9227}"
CURRENCY="$(currency_for_asset "${WORKFLOW_ASSET}")"
DISCOURSE_SERVICE_URL="${FIBER_LINK_DISCOURSE_SERVICE_URL:-http://host.docker.internal:${RPC_PORT}}"

log "artifacts: ${ARTIFACT_DIR}"
vlog "rpc_port=${RPC_PORT} fnn2_rpc_port=${FNN2_RPC_PORT} app_id=${APP_ID} asset=${WORKFLOW_ASSET}"

if [[ "${SKIP_SERVICES}" -eq 0 ]]; then
  log "step 1/6 + 2/6: launching fiber services and bootstrapping channel"
  service_args=()
  if [[ "${VERBOSE}" -eq 1 ]]; then
    service_args+=(--verbose)
  fi
  "${ROOT_DIR}/scripts/local-dual-fnn-env.sh" "${service_args[@]}"
else
  log "skipping services bootstrap (--skip-services)"
fi

TIPPER_USER_ID="${WORKFLOW_TIPPER_USER_ID:-}"
AUTHOR_USER_ID="${WORKFLOW_AUTHOR_USER_ID:-}"
TOPIC_POST_ID="${WORKFLOW_TOPIC_POST_ID:-}"
REPLY_POST_ID="${WORKFLOW_REPLY_POST_ID:-}"

if [[ "${SKIP_DISCOURSE}" -eq 0 ]]; then
  log "step 1/6 + 3/6: launching discourse and installing plugin"
  if [[ ! -d "${DISCOURSE_DEV_ROOT}/.git" ]]; then
    git clone https://github.com/discourse/discourse.git "${DISCOURSE_DEV_ROOT}"
  fi

  (
    cd "${DISCOURSE_DEV_ROOT}"
    git fetch --depth=1 origin "${DISCOURSE_REF}"
    git checkout "${DISCOURSE_REF}"
    mkdir -p plugins tmp
    ln -sfn "${ROOT_DIR}/fiber-link-discourse-plugin" plugins/fiber-link
    ./bin/docker/boot_dev
    ./bin/docker/exec env \
      LOAD_PLUGINS=1 \
      RAILS_ENV=development \
      bundle exec rake db:migrate
  ) > "${ARTIFACT_DIR}/discourse-bootstrap.log" 2>&1 || fatal "${EXIT_DISCOURSE}" "failed to bootstrap discourse (see discourse-bootstrap.log)"

  cp "${ROOT_DIR}/scripts/discourse-seed-fiber-link.rb" "${DISCOURSE_DEV_ROOT}/tmp/fiber-link-seed.rb"
  (
    cd "${DISCOURSE_DEV_ROOT}"
    ./bin/docker/exec env \
      FLOW_TOPIC_TITLE="${TOPIC_LABEL}" \
      FLOW_TOPIC_RAW="${TOPIC_BODY}" \
      FLOW_REPLY_RAW="${REPLY_BODY}" \
      FIBER_LINK_DISCOURSE_SERVICE_URL="${DISCOURSE_SERVICE_URL}" \
      FIBER_LINK_APP_ID="${APP_ID}" \
      FIBER_LINK_APP_SECRET="${APP_SECRET}" \
      LOAD_PLUGINS=1 \
      RAILS_ENV=development \
      bin/rails runner tmp/fiber-link-seed.rb
  ) > "${ARTIFACT_DIR}/discourse-seed.log" 2>&1 || fatal "${EXIT_DISCOURSE}" "failed to seed discourse data (see discourse-seed.log)"

  seed_json="$(tr -d '\r' < "${ARTIFACT_DIR}/discourse-seed.log" | awk '/^\{.*\}$/ {line=$0} END {print line}')"
  [[ -n "${seed_json}" ]] || fatal "${EXIT_DISCOURSE}" "could not parse seed output JSON (see discourse-seed.log)"
  printf '%s\n' "${seed_json}" > "${ARTIFACT_DIR}/discourse-seed.json"

  TIPPER_USER_ID="$(printf '%s' "${seed_json}" | jq -r '.tipper.id // empty')"
  AUTHOR_USER_ID="$(printf '%s' "${seed_json}" | jq -r '.author.id // empty')"
  TOPIC_POST_ID="$(printf '%s' "${seed_json}" | jq -r '.topic.first_post_id // empty')"
  REPLY_POST_ID="$(printf '%s' "${seed_json}" | jq -r '.reply.post_id // empty')"
else
  log "skipping discourse bootstrap (--skip-discourse)"
fi

[[ -n "${TIPPER_USER_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_TIPPER_USER_ID"
[[ -n "${AUTHOR_USER_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_AUTHOR_USER_ID"
[[ -n "${TOPIC_POST_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_TOPIC_POST_ID"
[[ -n "${REPLY_POST_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_REPLY_POST_ID"

if [[ "${PAUSE_AT_STEP4}" -eq 1 ]]; then
  if [[ "${START_EMBER_CLI}" -eq 1 ]]; then
    ensure_ember_cli_proxy
  fi
  [[ -t 0 ]] || fatal "${EXIT_USAGE}" "--pause-at-step4 requires an interactive terminal"
  log "paused before step 4 (tip actions). Check browser now."
  if [[ "${START_EMBER_CLI}" -eq 1 ]]; then
    log "browser URL: http://127.0.0.1:4200/login (ember proxy)"
  fi
  read -r -p "Press Enter to continue workflow... " _
fi

log "step 4/6: tip post and tip reply"
TOPIC_INVOICE="$(create_tip_invoice "topic-post" "${TOPIC_POST_ID}" "${TIPPER_USER_ID}" "${AUTHOR_USER_ID}")"
TOPIC_TX_HASH="$(pay_invoice_from_payer "topic-post" "${TOPIC_INVOICE}" "${TIP_AMOUNT}")"
wait_tip_settled "topic-post" "${TOPIC_INVOICE}"

REPLY_INVOICE="$(create_tip_invoice "reply-post" "${REPLY_POST_ID}" "${TIPPER_USER_ID}" "${AUTHOR_USER_ID}")"
REPLY_TX_HASH="$(pay_invoice_from_payer "reply-post" "${REPLY_INVOICE}" "${TIP_AMOUNT}")"
wait_tip_settled "reply-post" "${REPLY_INVOICE}"

log "step 5/6: author checks balance"
DASHBOARD_RESPONSE="$(dashboard_summary "${AUTHOR_USER_ID}" false)"
printf '%s\n' "${DASHBOARD_RESPONSE}" > "${ARTIFACT_DIR}/author-dashboard.json"
if contains_jsonrpc_error "${DASHBOARD_RESPONSE}"; then
  fatal "${EXIT_BALANCE}" "dashboard.summary failed: $(jsonrpc_error_message "${DASHBOARD_RESPONSE}")"
fi

AUTHOR_BALANCE="$(printf '%s' "${DASHBOARD_RESPONSE}" | jq -r '.result.balance // empty')"
[[ -n "${AUTHOR_BALANCE}" ]] || fatal "${EXIT_BALANCE}" "dashboard.summary returned empty balance"

AUTHOR_TIP_COUNT="$(printf '%s' "${DASHBOARD_RESPONSE}" | jq -r '.result.tips | length')"
[[ "${AUTHOR_TIP_COUNT}" -ge 2 ]] || fatal "${EXIT_BALANCE}" "expected at least 2 tip entries, got ${AUTHOR_TIP_COUNT}"

AUTHOR_BALANCE_INTEGER="${AUTHOR_BALANCE%%.*}"
[[ "${AUTHOR_BALANCE_INTEGER}" =~ ^[0-9]+$ ]] || fatal "${EXIT_BALANCE}" "balance is not numeric: ${AUTHOR_BALANCE}"
if [[ "${AUTHOR_BALANCE_INTEGER}" -lt "${WITHDRAW_AMOUNT}" ]]; then
  fatal "${EXIT_BALANCE}" "author balance ${AUTHOR_BALANCE} is smaller than withdrawal amount ${WITHDRAW_AMOUNT}"
fi

log "step 6/6: withdraw to CKB on-chain address"
WITHDRAW_TO_ADDRESS_RESOLVED="$(resolve_withdraw_to_address)"
vlog "withdraw_to_address=${WITHDRAW_TO_ADDRESS_RESOLVED}"
WITHDRAWAL_ID="$(request_withdrawal "${AUTHOR_USER_ID}" "${WITHDRAW_TO_ADDRESS_RESOLVED}")"
WITHDRAWAL_STATE="$(wait_withdrawal_completed "${AUTHOR_USER_ID}" "${WITHDRAWAL_ID}")"

jq -n \
  --arg artifactDir "${ARTIFACT_DIR}" \
  --arg appId "${APP_ID}" \
  --arg tipperUserId "${TIPPER_USER_ID}" \
  --arg authorUserId "${AUTHOR_USER_ID}" \
  --arg topicPostId "${TOPIC_POST_ID}" \
  --arg replyPostId "${REPLY_POST_ID}" \
  --arg topicInvoice "${TOPIC_INVOICE}" \
  --arg topicTxHash "${TOPIC_TX_HASH}" \
  --arg replyInvoice "${REPLY_INVOICE}" \
  --arg replyTxHash "${REPLY_TX_HASH}" \
  --arg balance "${AUTHOR_BALANCE}" \
  --arg withdrawalId "${WITHDRAWAL_ID}" \
  --arg withdrawalState "${WITHDRAWAL_STATE}" \
  --arg withdrawalDestinationAddress "${WITHDRAW_TO_ADDRESS_RESOLVED}" \
  '{
    artifactDir: $artifactDir,
    appId: $appId,
    tipperUserId: $tipperUserId,
    authorUserId: $authorUserId,
    topicPostId: $topicPostId,
    replyPostId: $replyPostId,
    tips: [
      { label: "topic-post", invoice: $topicInvoice, txHash: $topicTxHash },
      { label: "reply-post", invoice: $replyInvoice, txHash: $replyTxHash }
    ],
    balanceAfterTips: $balance,
    withdrawal: {
      id: $withdrawalId,
      state: $withdrawalState,
      destinationAddress: $withdrawalDestinationAddress
    }
  }' > "${ARTIFACT_DIR}/summary.json"

printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${ARTIFACT_DIR}" "${ARTIFACT_DIR}/summary.json"
