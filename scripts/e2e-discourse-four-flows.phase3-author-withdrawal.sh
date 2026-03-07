#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase3"
VERBOSE=0
HEADED=1

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
set_worker_strategy subscription
ensure_discourse_ui_proxy

author_withdrawal_cmd=(
  env
  "PW_AUTHOR_WITHDRAWAL_HEADED=${HEADED}"
  "PW_AUTHOR_WITHDRAWAL_URL=${DISCOURSE_UI_BASE_URL:-http://127.0.0.1:4200}"
  "PW_AUTHOR_WITHDRAWAL_SESSION=fiber-aw"
  "PW_AUTHOR_WITHDRAWAL_ARTIFACT_DIR=${PHASE3_DIR}"
  "PW_AUTHOR_WITHDRAWAL_WITHDRAW_AMOUNT=${WORKFLOW_WITHDRAW_AMOUNT:-61}"
  "PW_AUTHOR_WITHDRAWAL_WITHDRAW_TO_ADDRESS=${WITHDRAW_TO_ADDRESS}"
  scripts/playwright-workflow-author-withdrawal.sh
)

record_cmd "${author_withdrawal_cmd[*]}"
(cd "${ROOT_DIR}" && "${author_withdrawal_cmd[@]}") > "${LOGS_DIR}/phase3.author-withdrawal.log" 2>&1 \
  || fatal "${EXIT_WITHDRAWAL}" "author browser withdrawal flow failed"

phase3_result_json="$(extract_result_json "${PHASE3_DIR}/playwright-author-withdrawal-result.log" || true)"
[[ -n "${phase3_result_json}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing author withdrawal result payload"

phase3_error="$(printf '%s' "${phase3_result_json}" | jq -r '.error // empty')"
[[ -z "${phase3_error}" ]] || fatal "${EXIT_WITHDRAWAL}" "author withdrawal returned error: ${phase3_error}"

WITHDRAWAL_ID="$(printf '%s' "${phase3_result_json}" | jq -r '.withdrawalId // empty')"
WITHDRAWAL_STATE="$(printf '%s' "${phase3_result_json}" | jq -r '.withdrawalRequestedState // empty')"
AUTHOR_BALANCE="$(printf '%s' "${phase3_result_json}" | jq -r '.authorBalance // empty')"
AUTHOR_TIP_HISTORY_COUNT="$(printf '%s' "${phase3_result_json}" | jq -r '.authorTipHistoryCount // empty')"
[[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_WITHDRAWAL}" "author withdrawal did not return an id"

withdraw_request_json="$(printf '%s' "${phase3_result_json}" | jq -c '.withdrawalRequestTrace.request // null')"
withdraw_response_json="$(printf '%s' "${phase3_result_json}" | jq -c '.withdrawalRequestTrace.response // null')"
printf '%s\n' "${withdraw_request_json}" > "${ARTIFACTS_DIR}/flow4-withdrawal-request.request.json"
printf '%s\n' "${withdraw_response_json}" > "${ARTIFACTS_DIR}/flow4-withdrawal-request.response.json"

WITHDRAW_REQUEST_SOURCE="browser"
persist_state_env

write_checklist "RUNNING" "phase3 complete"
printf 'RESULT=PASS CODE=0 PHASE=phase3 RUN_DIR=%s\n' "${RUN_DIR}"
