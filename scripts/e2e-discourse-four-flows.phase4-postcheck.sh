#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase4"
VERBOSE=0
HEADED=1
ATTEMPT_LABEL="primary"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.phase4-postcheck.sh [options]

Phase 5 of the discourse four-flows workflow:
- verify author/admin dashboard state after withdrawal exists
- capture author/admin screenshots

Options:
  --run-dir <path>  Existing run directory from phase3.
  --attempt-label <id> Attempt label. Default: primary.
  --headless        Run Playwright in headless mode.
  --verbose         Print detailed logs.
  -h, --help        Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
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
ensure_discourse_ui_proxy

[[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_POSTCHECK}" "phase4 requires withdrawal id from phase3"

attempt_dir="${POSTCHECK_DIR}"
if [[ "${ATTEMPT_LABEL}" != "primary" ]]; then
  attempt_dir="${RUN_DIR}/postcheck-${ATTEMPT_LABEL}"
  mkdir -p "${attempt_dir}"
fi
attempt_prefix="withdrawal-${ATTEMPT_LABEL}"

cmd=(
  env
  "PW_DEMO_HEADED=${HEADED}"
  "PW_DEMO_URL=${DISCOURSE_UI_BASE_URL}"
  "PW_DEMO_SESSION=fiber-pc"
  "PW_DEMO_ARTIFACT_DIR=${attempt_dir}"
  "PW_DEMO_WITHDRAWAL_ID=${WITHDRAWAL_ID}"
  "PW_DEMO_WITHDRAW_AMOUNT=${WORKFLOW_WITHDRAW_AMOUNT:-61}"
  "PW_DEMO_WITHDRAW_TO_ADDRESS=${WITHDRAW_TO_ADDRESS}"
  "PW_DEMO_INITIATE_WITHDRAWAL=0"
  scripts/playwright-workflow-postcheck.sh
)
record_cmd "${cmd[*]}"
(cd "${ROOT_DIR}" && "${cmd[@]}") > "${LOGS_DIR}/phase4.postcheck.${ATTEMPT_LABEL}.log" 2>&1 \
  || fatal "${EXIT_POSTCHECK}" "postcheck flow failed"

POSTCHECK_RESULT_JSON="$(extract_result_json "${attempt_dir}/playwright-postcheck-result.log" || true)"
[[ -n "${POSTCHECK_RESULT_JSON}" ]] || fatal "${EXIT_POSTCHECK}" "missing postcheck result payload"

postcheck_error="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.error // empty')"
[[ -z "${postcheck_error}" ]] || fatal "${EXIT_POSTCHECK}" "postcheck returned error: ${postcheck_error}"

postcheck_withdrawal_id="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.withdrawalId // empty')"
if [[ -n "${postcheck_withdrawal_id}" ]]; then
  WITHDRAWAL_ID="${postcheck_withdrawal_id}"
fi
AUTHOR_BALANCE="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.authorBalance // empty')"
AUTHOR_TIP_HISTORY_COUNT="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.authorTipHistoryCount // empty')"

postcheck_state="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.adminExtractedState // .withdrawalRequestedState // empty')"
if [[ -n "${postcheck_state}" ]]; then
  WITHDRAWAL_STATE="${postcheck_state}"
fi
postcheck_tx_hash="$(printf '%s' "${POSTCHECK_RESULT_JSON}" | jq -r '.withdrawalTxHash // empty')"
if [[ -n "${postcheck_tx_hash}" ]]; then
  WITHDRAWAL_TX_HASH="${postcheck_tx_hash}"
fi
printf '%s\n' "${POSTCHECK_RESULT_JSON}" > "${ARTIFACTS_DIR}/${attempt_prefix}.postcheck.json"
capture_withdrawal_liquidity_snapshot "${WITHDRAWAL_ID}" "${ARTIFACTS_DIR}/${attempt_prefix}.postcheck.snapshot.json"

persist_state_env
printf 'RESULT=PASS CODE=0 ATTEMPT=%s RUN_DIR=%s WITHDRAWAL_ID=%s\n' "${ATTEMPT_LABEL}" "${RUN_DIR}" "${WITHDRAWAL_ID}"
