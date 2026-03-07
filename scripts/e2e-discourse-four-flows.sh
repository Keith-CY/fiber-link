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
persist_state_env

phase1_script="$(phase_script e2e-discourse-four-flows.phase1-prepare-and-open.sh)"
phase2_script="$(phase_script e2e-discourse-four-flows.phase2-tip-and-settlement.sh)"
phase3_script="$(phase_script e2e-discourse-four-flows.phase3-author-withdrawal.sh)"
phase4_script="$(phase_script e2e-discourse-four-flows.phase4-postcheck.sh)"
phase5_script="$(phase_script e2e-discourse-four-flows.phase5-explorer-and-finalize.sh)"

require_phase_script "${phase1_script}"
require_phase_script "${phase2_script}"
require_phase_script "${phase3_script}"
require_phase_script "${phase4_script}"
require_phase_script "${phase5_script}"

log "artifacts: ${RUN_DIR}"
log "phase script dir: ${PHASE_SCRIPT_DIR}"
log "settlement modes: ${SETTLEMENT_MODES}"

phase1_cmd=("${phase1_script}" --run-dir "${RUN_DIR}")
phase2_cmd=("${phase2_script}" --run-dir "${RUN_DIR}" --settlement-modes "${SETTLEMENT_MODES}")
phase3_cmd=("${phase3_script}" --run-dir "${RUN_DIR}")
phase4_cmd=("${phase4_script}" --run-dir "${RUN_DIR}")
phase5_cmd=("${phase5_script}" --run-dir "${RUN_DIR}" --explorer-tx-url-template "${EXPLORER_TX_URL_TEMPLATE}")

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
fi

run_cmd "${phase1_cmd[@]}"
run_cmd "${phase2_cmd[@]}"
run_cmd "${phase3_cmd[@]}"
run_cmd "${phase4_cmd[@]}"
run_cmd "${phase5_cmd[@]}"
