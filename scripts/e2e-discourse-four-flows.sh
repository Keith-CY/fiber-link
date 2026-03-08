#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows"
SKIP_SERVICES=0
SKIP_DISCOURSE=0
HEADED=1
VERBOSE=0
PHASE_SCRIPT_DIR="${E2E_FOUR_FLOWS_PHASE_SCRIPT_DIR:-${ROOT_DIR}/scripts}"
RUN_DOUBLE_WITHDRAWAL_REGRESSION=0

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
  --liquidity-fallback-mode <mode>
                                Worker liquidity fallback mode: none | channel_rotation.
  --double-withdrawal-regression
                                Add a second 61 CKB browser withdrawal after the primary flow to
                                verify repeated LIQUIDITY_PENDING -> COMPLETED behavior.
  --explorer-tx-url-template <template>
                                Explorer URL template containing {txHash} or %s.
  --verbose                     Print detailed logs.
  -h, --help                    Show help.

Required env or option:
  E2E_EXPLORER_TX_URL_TEMPLATE (or --explorer-tx-url-template)
USAGE
}

phase_script() {
  local script_name="$1"
  printf '%s/%s' "${PHASE_SCRIPT_DIR}" "${script_name}"
}

require_phase_script() {
  local path="$1"
  [[ -x "${path}" ]] || fatal "${EXIT_PRECHECK}" "missing phase script: ${path}"
}

run_cmd() {
  record_cmd "${*}"
  (cd "${ROOT_DIR}" && "$@")
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
      RUN_DIR="$2"
      shift
      ;;
    --settlement-modes)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SETTLEMENT_MODES="$2"
      shift
      ;;
    --liquidity-fallback-mode)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      LIQUIDITY_FALLBACK_MODE="$2"
      shift
      ;;
    --double-withdrawal-regression)
      RUN_DOUBLE_WITHDRAWAL_REGRESSION=1
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

[[ -n "${EXPLORER_TX_URL_TEMPLATE}" ]] || fatal "${EXIT_USAGE}" "E2E_EXPLORER_TX_URL_TEMPLATE/--explorer-tx-url-template is required"

ensure_run_layout
ensure_app_context
parse_settlement_modes
case "${LIQUIDITY_FALLBACK_MODE}" in
  none|channel_rotation)
    ;;
  *)
    fatal "${EXIT_USAGE}" "invalid --liquidity-fallback-mode: ${LIQUIDITY_FALLBACK_MODE}"
    ;;
esac
export LIQUIDITY_FALLBACK_MODE
export FIBER_LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE}"
export FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-0}}"
export FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-0}}"
export FIBER_CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT:-${FIBER_CHANNEL_ROTATION_MAX_CONCURRENT:-1}}"
persist_state_env

phase1_script="$(phase_script e2e-discourse-four-flows.phase1-prepare-and-open.sh)"
phase2_script="$(phase_script e2e-discourse-four-flows.phase2-tip-and-settlement.sh)"
channel_rotation_seed_script="$(phase_script e2e-channel-rotation-seed-legacy-channel.sh)"
phase3_script="$(phase_script e2e-discourse-four-flows.phase3-author-withdrawal.sh)"
phase4_script="$(phase_script e2e-discourse-four-flows.phase4-postcheck.sh)"
phase5_script="$(phase_script e2e-discourse-four-flows.phase5-explorer-and-finalize.sh)"
liquidity_regression_script="$(phase_script e2e-discourse-four-flows.liquidity-double-withdrawal.sh)"

require_phase_script "${phase1_script}"
require_phase_script "${phase2_script}"
if [[ "${LIQUIDITY_FALLBACK_MODE}" == "channel_rotation" ]]; then
  require_phase_script "${channel_rotation_seed_script}"
fi
require_phase_script "${phase3_script}"
require_phase_script "${phase4_script}"
require_phase_script "${phase5_script}"
if [[ "${RUN_DOUBLE_WITHDRAWAL_REGRESSION}" -eq 1 ]]; then
  require_phase_script "${liquidity_regression_script}"
fi

if [[ "${RUN_DOUBLE_WITHDRAWAL_REGRESSION}" -eq 1 ]]; then
  export WORKFLOW_TIP_AMOUNT="${WORKFLOW_TIP_AMOUNT:-${WORKFLOW_WITHDRAW_AMOUNT:-61}}"
  export E2E_WITHDRAWAL_SIGNER_ROTATE="${E2E_DOUBLE_WITHDRAWAL_SIGNER_ROTATE:-0}"
  export E2E_WITHDRAWAL_SIGNER_SKIP_FAUCET=1
  export FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER:-1}"
  export FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE:-0}"
  export FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER="${FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER:-${WORKFLOW_WITHDRAW_AMOUNT:-61}}"
fi

log "artifacts: ${RUN_DIR}"
log "phase script dir: ${PHASE_SCRIPT_DIR}"
log "settlement modes: ${SETTLEMENT_MODES}"
log "liquidity fallback mode: ${LIQUIDITY_FALLBACK_MODE}"

phase1_cmd=("${phase1_script}" --run-dir "${RUN_DIR}")
phase2_cmd=("${phase2_script}" --run-dir "${RUN_DIR}" --settlement-modes "${SETTLEMENT_MODES}")
channel_rotation_seed_cmd=("${channel_rotation_seed_script}" --run-dir "${RUN_DIR}")
phase3_cmd=("${phase3_script}" --run-dir "${RUN_DIR}")
phase4_cmd=("${phase4_script}" --run-dir "${RUN_DIR}")
phase5_cmd=("${phase5_script}" --run-dir "${RUN_DIR}" --explorer-tx-url-template "${EXPLORER_TX_URL_TEMPLATE}")
liquidity_regression_cmd=("${liquidity_regression_script}" --run-dir "${RUN_DIR}" --explorer-tx-url-template "${EXPLORER_TX_URL_TEMPLATE}")

if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
  phase1_cmd+=(--skip-services)
fi
if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  phase1_cmd+=(--skip-discourse)
fi
if [[ "${HEADED}" -eq 0 ]]; then
  phase1_cmd+=(--headless)
  phase3_cmd+=(--headless)
  phase4_cmd+=(--headless)
fi
if [[ "${VERBOSE}" -eq 1 ]]; then
  phase1_cmd+=(--verbose)
  phase2_cmd+=(--verbose)
  phase3_cmd+=(--verbose)
  phase4_cmd+=(--verbose)
  phase5_cmd+=(--verbose)
  liquidity_regression_cmd+=(--verbose)
fi

run_cmd "${phase1_cmd[@]}"
run_cmd "${phase2_cmd[@]}"
if [[ "${LIQUIDITY_FALLBACK_MODE}" == "channel_rotation" ]]; then
  run_cmd "${channel_rotation_seed_cmd[@]}"
fi
run_cmd "${phase3_cmd[@]}"
run_cmd "${phase4_cmd[@]}"
run_cmd "${phase5_cmd[@]}"
if [[ "${RUN_DOUBLE_WITHDRAWAL_REGRESSION}" -eq 1 ]]; then
  if [[ "${HEADED}" -eq 0 ]]; then
    liquidity_regression_cmd+=(--headless)
  fi
  run_cmd "${liquidity_regression_cmd[@]}"
fi
