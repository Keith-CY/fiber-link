#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase3"
VERBOSE=0
HEADED=1
ATTEMPT_LABEL="primary"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.phase3-author-withdrawal.sh [options]

Phase 4 of the split workflow:
1) prepare the withdrawal signer/worker
2) log in as author in Discourse
3) initiate withdrawal from the browser session and persist its artifacts

Options:
  --run-dir <path>       Shared run directory. Required.
  --artifact-dir <path>  Alias of --run-dir.
  --attempt-label <id>   Attempt label. Default: primary.
  --headless             Run browser automation in headless mode.
  --verbose              Print detailed logs.
  -h, --help             Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir|--artifact-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --attempt-label)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      ATTEMPT_LABEL="$2"
      shift
      ;;
    --headless)
      HEADED=0
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

[[ -n "${RUN_DIR}" ]] || { usage >&2; exit "${EXIT_USAGE}"; }
ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
persist_state_env

[[ -n "${APP_ID:-}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing APP_ID in state"
[[ -n "${WITHDRAW_TO_ADDRESS:-}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing WITHDRAW_TO_ADDRESS in state"

ensure_withdrawal_signer_private_key
restart_withdrawal_runtime subscription
ensure_discourse_ui_proxy

attempt_dir="${PHASE3_DIR}"
if [[ "${ATTEMPT_LABEL}" != "primary" ]]; then
  attempt_dir="${RUN_DIR}/withdrawal-browser-${ATTEMPT_LABEL}"
  mkdir -p "${attempt_dir}"
fi
attempt_prefix="withdrawal-${ATTEMPT_LABEL}"

jq -n \
  --arg address "${WITHDRAWAL_SIGNER_ADDRESS}" \
  --arg rotateRequested "${E2E_WITHDRAWAL_SIGNER_ROTATE:-0}" \
  --arg skipFaucet "${E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET:-0}" \
  '{
    withdrawalSignerAddress: $address,
    rotateRequested: ($rotateRequested == "1"),
    skipFaucet: ($skipFaucet == "1")
  }' > "${ARTIFACTS_DIR}/${attempt_prefix}.signer.json"

capture_hot_wallet_inventory "${ARTIFACTS_DIR}/${attempt_prefix}.hot-wallet.before.json"

author_withdrawal_cmd=(
  env
  "PW_AUTHOR_WITHDRAWAL_HEADED=${HEADED}"
  "PW_AUTHOR_WITHDRAWAL_URL=${DISCOURSE_UI_BASE_URL:-http://127.0.0.1:4200}"
  "PW_AUTHOR_WITHDRAWAL_SESSION=fiber-aw"
  "PW_AUTHOR_WITHDRAWAL_ARTIFACT_DIR=${attempt_dir}"
  "PW_AUTHOR_WITHDRAWAL_WITHDRAW_AMOUNT=${WORKFLOW_WITHDRAW_AMOUNT:-61}"
  "PW_AUTHOR_WITHDRAWAL_WITHDRAW_TO_ADDRESS=${WITHDRAW_TO_ADDRESS}"
  scripts/playwright-workflow-author-withdrawal.sh
)

record_cmd "${author_withdrawal_cmd[*]}"
(cd "${ROOT_DIR}" && "${author_withdrawal_cmd[@]}") > "${LOGS_DIR}/phase3.author-withdrawal.${ATTEMPT_LABEL}.log" 2>&1 \
  || fatal "${EXIT_WITHDRAWAL}" "author browser withdrawal flow failed"

phase3_result_json="$(extract_result_json "${attempt_dir}/playwright-author-withdrawal-result.log" || true)"
[[ -n "${phase3_result_json}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing author withdrawal result payload"

phase3_error="$(printf '%s' "${phase3_result_json}" | jq -r '.error // empty')"
[[ -z "${phase3_error}" ]] || fatal "${EXIT_WITHDRAWAL}" "author withdrawal returned error: ${phase3_error}"

WITHDRAWAL_ID="$(printf '%s' "${phase3_result_json}" | jq -r '.withdrawalId // empty')"
WITHDRAWAL_REQUESTED_STATE="$(printf '%s' "${phase3_result_json}" | jq -r '.withdrawalRequestedState // empty')"
WITHDRAWAL_STATE="${WITHDRAWAL_REQUESTED_STATE}"
AUTHOR_BALANCE="$(printf '%s' "${phase3_result_json}" | jq -r '.authorBalance // empty')"
AUTHOR_TIP_HISTORY_COUNT="$(printf '%s' "${phase3_result_json}" | jq -r '.authorTipHistoryCount // empty')"
[[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_WITHDRAWAL}" "author withdrawal did not return an id"

withdraw_request_json="$(printf '%s' "${phase3_result_json}" | jq -c '.withdrawalRequestTrace.request // null')"
withdraw_response_json="$(printf '%s' "${phase3_result_json}" | jq -c '.withdrawalRequestTrace.response // null')"
printf '%s\n' "${withdraw_request_json}" > "${ARTIFACTS_DIR}/${attempt_prefix}.request.json"
printf '%s\n' "${withdraw_response_json}" > "${ARTIFACTS_DIR}/${attempt_prefix}.response.json"
if [[ "${ATTEMPT_LABEL}" == "primary" ]]; then
  cp "${ARTIFACTS_DIR}/${attempt_prefix}.request.json" "${ARTIFACTS_DIR}/flow4-withdrawal-request.request.json"
  cp "${ARTIFACTS_DIR}/${attempt_prefix}.response.json" "${ARTIFACTS_DIR}/flow4-withdrawal-request.response.json"
fi
capture_withdrawal_liquidity_snapshot "${WITHDRAWAL_ID}" "${ARTIFACTS_DIR}/${attempt_prefix}.snapshot.json"
printf '%s\n' "${phase3_result_json}" > "${ARTIFACTS_DIR}/${attempt_prefix}.result.json"

WITHDRAW_REQUEST_SOURCE="browser"
persist_state_env

write_checklist "RUNNING" "phase3(${ATTEMPT_LABEL}) complete"
printf 'RESULT=PASS CODE=0 PHASE=phase3 ATTEMPT=%s RUN_DIR=%s\n' "${ATTEMPT_LABEL}" "${RUN_DIR}"
