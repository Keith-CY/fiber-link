#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase2"
VERBOSE=0
SETTLEMENT_MODES="${E2E_SETTLEMENT_MODES:-subscription}"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.phase2-tip-and-settlement.sh [options]

Phase 3 of the discourse four-flows workflow:
- execute tip flows
- verify settlement in subscription mode
- optionally verify settlement in polling mode

Options:
  --run-dir <path>            Existing run directory from phase1.
  --settlement-modes <modes>  subscription | polling | subscription,polling.
  --verbose                   Print detailed logs.
  -h, --help                  Show help.
USAGE
}

export_workflow_ids() {
  export FIBER_LINK_APP_ID="${APP_ID}"
  export WORKFLOW_TIPPER_USER_ID="${TIPPER_USER_ID}"
  export WORKFLOW_AUTHOR_USER_ID="${AUTHOR_USER_ID}"
  export WORKFLOW_TOPIC_POST_ID="${TOPIC_POST_ID}"
  export WORKFLOW_REPLY_POST_ID="${REPLY_POST_ID}"
}

run_subscription_phase() {
  if should_use_unique_withdraw_to_address; then
    WITHDRAW_TO_ADDRESS="$(generate_unique_testnet_withdraw_to_address primary)"
  fi

  local cmd=(
    env
    "FIBER_LINK_APP_ID=${APP_ID}"
    "RPC_PORT=${WORKFLOW_RPC_PORT}"
    "WORKFLOW_ARTIFACT_DIR=${PHASE2_DIR}"
    "WORKFLOW_RESULT_METADATA_PATH=${PHASE2_METADATA_PATH}"
    "WORKFLOW_WITHDRAW_TO_ADDRESS=${WITHDRAW_TO_ADDRESS:-}"
    scripts/local-workflow-automation.sh
    --verbose
    --skip-services
    --skip-discourse
    --skip-withdrawal
  )

  record_cmd "${cmd[*]}"
  (cd "${ROOT_DIR}" && "${cmd[@]}") 2>&1 | tee "${LOGS_DIR}/phase2.subscription.log" >/dev/null \
    || fatal "${EXIT_PHASE2}" "phase2 subscription workflow failed"

  local summary_path
  if load_result_metadata "${PHASE2_METADATA_PATH}"; then
    summary_path="${WORKFLOW_RESULT_SUMMARY_PATH:-${PHASE2_DIR}/summary.json}"
  else
    summary_path="${PHASE2_DIR}/summary.json"
  fi
  [[ -f "${summary_path}" ]] || fatal "${EXIT_PHASE2}" "missing phase2 summary: ${summary_path}"

  local resolved_withdraw_to_address
  resolved_withdraw_to_address="$(jq -r '.withdrawal.destinationAddress // empty' "${summary_path}")"
  if [[ -n "${resolved_withdraw_to_address}" ]]; then
    WITHDRAW_TO_ADDRESS="${resolved_withdraw_to_address}"
  fi
  TOPIC_TX_HASH="$(jq -r '.tips[]? | select(.label == "topic-post") | .txHash // empty' "${summary_path}" | head -n1)"
  REPLY_TX_HASH="$(jq -r '.tips[]? | select(.label == "reply-post") | .txHash // empty' "${summary_path}" | head -n1)"
  AUTHOR_BALANCE="$(jq -r '.balanceAfterTips // empty' "${summary_path}")"
  [[ -n "${WITHDRAW_TO_ADDRESS}" ]] || fatal "${EXIT_PHASE2}" "missing withdrawal destination address in phase2 summary"

  local subscription_topic_settled=false
  local subscription_reply_settled=false
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
}

run_polling_phase() {
  local polling_app_id="${APP_ID}-polling"
  local cmd=(
    env
    "FIBER_LINK_APP_ID=${polling_app_id}"
    "RPC_PORT=${WORKFLOW_RPC_PORT}"
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

  local polling_topic_settled=false
  local polling_reply_settled=false
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
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --settlement-modes)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SETTLEMENT_MODES="$2"
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

[[ -n "${RUN_DIR}" ]] || { usage >&2; exit "${EXIT_USAGE}"; }
ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
parse_settlement_modes
persist_state_env

[[ -n "${TIPPER_USER_ID}" && -n "${AUTHOR_USER_ID}" && -n "${TOPIC_POST_ID}" && -n "${REPLY_POST_ID}" ]] \
  || fatal "${EXIT_PHASE2}" "phase2 requires workflow IDs from phase1 state"

require_cmd jq
require_cmd docker
require_cmd curl
ensure_compose_files
ensure_app_secret
export_workflow_ids

log "run dir: ${RUN_DIR}"
log "settlement modes: ${SETTLEMENT_MODES}"

if [[ "${RUN_SUBSCRIPTION}" -eq 1 ]]; then
  run_subscription_phase
else
  jq -n \
    --arg mode "subscription" \
    --arg artifactDir "${PHASE2_DIR}" \
    '{mode:$mode, artifactDir:$artifactDir, skipped:true, checks:{topicPostSettled:null, replyPostSettled:null, pass:true}}' \
    > "${ARTIFACTS_DIR}/flow3-subscription.json"
fi

if [[ "${RUN_POLLING}" -eq 1 ]]; then
  run_polling_phase
else
  jq -n \
    --arg mode "polling" \
    --arg artifactDir "${POLLING_DIR}" \
    '{mode:$mode, artifactDir:$artifactDir, skipped:true, checks:{topicPostSettled:null, replyPostSettled:null, pass:true}}' \
    > "${ARTIFACTS_DIR}/flow3-polling.json"
fi

persist_state_env
printf 'RESULT=PASS CODE=0 RUN_DIR=%s STATE=%s\n' "${RUN_DIR}" "${STATE_ENV_PATH}"
