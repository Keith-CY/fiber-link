#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase1"
SKIP_SERVICES=0
SKIP_DISCOURSE=0
HEADED=1
VERBOSE=0

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.phase1-prepare-and-open.sh [options]

Phase 1+2 of the discourse four-flows workflow:
1) bootstrap discourse + services + seed data
2) open forum UI and capture tip button/modal screenshots

Options:
  --run-dir <path>       Run directory to create or reuse.
  --skip-services        Reuse existing Docker/services bootstrap.
  --skip-discourse       Reuse existing discourse seed state (requires workflow IDs in state/env).
  --headless             Run Playwright in headless mode.
  --verbose              Print detailed logs.
  -h, --help             Show help.
USAGE
}

export_workflow_ids_from_state() {
  [[ -n "${TIPPER_USER_ID}" ]] && export WORKFLOW_TIPPER_USER_ID="${TIPPER_USER_ID}"
  [[ -n "${AUTHOR_USER_ID}" ]] && export WORKFLOW_AUTHOR_USER_ID="${AUTHOR_USER_ID}"
  [[ -n "${TOPIC_POST_ID}" ]] && export WORKFLOW_TOPIC_POST_ID="${TOPIC_POST_ID}"
  [[ -n "${REPLY_POST_ID}" ]] && export WORKFLOW_REPLY_POST_ID="${REPLY_POST_ID}"
  return 0
}

should_start_ember_cli() {
  local ui_base_url="${DISCOURSE_UI_BASE_URL%/}"
  local host_access_host="${E2E_HOST_ACCESS_HOST:-host.docker.internal}"
  local host_access_base_url="${E2E_HOST_ACCESS_BASE_URL:-http://127.0.0.1}"
  [[ "${ui_base_url}" == "http://${host_access_host}:4200" ]] \
    || [[ "${ui_base_url}" == "${host_access_base_url}:4200" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --skip-services)
      SKIP_SERVICES=1
      ;;
    --skip-discourse)
      SKIP_DISCOURSE=1
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

ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
ensure_topic_defaults
export_workflow_ids_from_state
persist_state_env

require_cmd jq
require_cmd awk
ensure_compose_files

log "run dir: ${RUN_DIR}"
log "app id: ${APP_ID}"

prepare_cmd=(
  env
  "FIBER_LINK_APP_ID=${APP_ID}"
  "RPC_PORT=${WORKFLOW_RPC_PORT}"
  "WORKFLOW_ARTIFACT_DIR=${PHASE1_DIR}"
  "WORKFLOW_RESULT_METADATA_PATH=${PHASE1_METADATA_PATH}"
  scripts/local-workflow-automation.sh
  --verbose
  --prepare-only
  --skip-withdrawal
)

if should_start_ember_cli; then
  prepare_cmd+=(--with-ember-cli)
fi

if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
  prepare_cmd+=(--skip-services)
fi
if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  prepare_cmd+=(--skip-discourse)
fi

export ROOT_DIR FLOW12_DIR PHASE1_DIR
export FLOW12_HEADED="${HEADED}"
export FLOW12_URL="${DISCOURSE_UI_BASE_URL}"

record_cmd "local-workflow prepare-only"
set +e
(
  cd "${ROOT_DIR}"
  "${prepare_cmd[@]}"
) 2>&1 | tee "${LOGS_DIR}/phase1.pause.log"
rc=${PIPESTATUS[0]}
set -e
[[ "${rc}" -eq 0 ]] || fatal "${EXIT_FLOW12}" "phase1 prepare-only failed (see ${LOGS_DIR}/phase1.pause.log)"

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
fi

TIPPER_USER_ID="${TIPPER_USER_ID:-${WORKFLOW_TIPPER_USER_ID:-}}"
AUTHOR_USER_ID="${AUTHOR_USER_ID:-${WORKFLOW_AUTHOR_USER_ID:-}}"
TOPIC_POST_ID="${TOPIC_POST_ID:-${WORKFLOW_TOPIC_POST_ID:-}}"
REPLY_POST_ID="${REPLY_POST_ID:-${WORKFLOW_REPLY_POST_ID:-}}"

[[ -n "${TIPPER_USER_ID}" && -n "${AUTHOR_USER_ID}" && -n "${TOPIC_POST_ID}" && -n "${REPLY_POST_ID}" ]] \
  || fatal "${EXIT_FLOW12}" "failed to resolve required workflow IDs"

export_workflow_ids_from_state

log "prepare-only completed; running flow1/flow2 playwright step"
flow12_topic_path="$(jq -r '.topic.relative_url // empty' "${phase1_seed_path}")"
if [[ -z "${flow12_topic_path}" ]]; then
  topic_id="$(jq -r '.topic.id // empty' "${phase1_seed_path}")"
  if [[ -n "${topic_id}" ]]; then
    flow12_topic_path="/t/-/${topic_id}"
  fi
fi

record_cmd "playwright flow12"
set +e
env \
  PW_FLOW12_ARTIFACT_DIR="${FLOW12_DIR}" \
  PW_FLOW12_HEADED="${FLOW12_HEADED}" \
  PW_FLOW12_URL="${FLOW12_URL}" \
  PW_FLOW12_TOPIC_PATH="${flow12_topic_path}" \
  "${ROOT_DIR}/scripts/playwright-workflow-flow12.sh" 2>&1 \
  | tee -a "${LOGS_DIR}/phase1.pause.log"
rc=${PIPESTATUS[0]}
set -e
[[ "${rc}" -eq 0 ]] || fatal "${EXIT_FLOW12}" "flow12 playwright step failed (see ${LOGS_DIR}/phase1.pause.log)"

FLOW12_RESULT_JSON="$(extract_result_json "${FLOW12_DIR}/playwright-flow12-result.log" || true)"
[[ -n "${FLOW12_RESULT_JSON}" ]] || fatal "${EXIT_FLOW12}" "missing flow12 result payload"

persist_state_env
printf 'RESULT=PASS CODE=0 RUN_DIR=%s STATE=%s\n' "${RUN_DIR}" "${STATE_ENV_PATH}"
