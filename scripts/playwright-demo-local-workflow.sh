#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR="${ROOT_DIR}/.tmp/playwright-workflow-demo/${TIMESTAMP}"
PAUSE_LOG="${ARTIFACT_DIR}/workflow.pause.log"
COMPLETE_LOG="${ARTIFACT_DIR}/workflow.complete.log"

SKIP_SERVICES=0
SKIP_DISCOURSE=0
HEADED=1
BROWSER_WITHDRAWAL=1

usage() {
  cat <<'EOF'
Usage: scripts/playwright-demo-local-workflow.sh [--skip-services] [--skip-discourse] [--headless] [--backend-withdrawal]

Runs an end-to-end local demo:
1) launch discourse + fiber services (unless skipped)
2) run local-workflow with --pause-at-step4
3) at pause, execute Playwright sequence: author checks balance -> tipper pays
4) continue backend workflow for settlement + author balance validation
5) login author again, check balance, initiate withdrawal, then login admin to observe status

Options:
  --skip-services   Skip service rebuild/bootstrap.
  --skip-discourse  Skip discourse bootstrap/seeding.
  --headless        Run Playwright browser in headless mode.
  --backend-withdrawal  Keep legacy behavior: backend step6 initiates withdrawal.
  -h, --help        Show this help text.

Required env:
  (none in default browser-withdrawal mode)

Required env with --backend-withdrawal:
  FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=0x... (or legacy alias FIBER_WITHDRAW_CKB_PRIVATE_KEY)

Required env when --skip-discourse is set:
  WORKFLOW_TIPPER_USER_ID
  WORKFLOW_AUTHOR_USER_ID
  WORKFLOW_TOPIC_POST_ID
  WORKFLOW_REPLY_POST_ID

Optional demo env (defaults are seed script values):
  PW_DEMO_TIPPER_USERNAME=fiber_tipper
  PW_DEMO_TIPPER_PASSWORD=fiber-local-pass-1
  PW_DEMO_AUTHOR_USERNAME=fiber_author
  PW_DEMO_AUTHOR_PASSWORD=fiber-local-pass-1
  PW_DEMO_ADMIN_USERNAME=fiber_tipper
  PW_DEMO_ADMIN_PASSWORD=fiber-local-pass-1
  PW_DEMO_TOPIC_TITLE="Fiber Link Local Workflow Topic"
  PW_DEMO_TOPIC_PATH="/t/fiber-link-local-workflow-topic/<id>"
  PW_DEMO_URL=http://127.0.0.1:4200
EOF
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
    --backend-withdrawal)
      BROWSER_WITHDRAWAL=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[playwright-demo] unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

if [[ -z "${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-}" && -n "${FIBER_WITHDRAW_CKB_PRIVATE_KEY:-}" ]]; then
  export FIBER_WITHDRAWAL_CKB_PRIVATE_KEY="${FIBER_WITHDRAW_CKB_PRIVATE_KEY}"
fi

if [[ "${BROWSER_WITHDRAWAL}" -eq 0 ]]; then
  [[ -n "${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-}" ]] || {
    echo "[playwright-demo] FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required with --backend-withdrawal" >&2
    exit 10
  }
fi

if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  for required in WORKFLOW_TIPPER_USER_ID WORKFLOW_AUTHOR_USER_ID WORKFLOW_TOPIC_POST_ID WORKFLOW_REPLY_POST_ID; do
    [[ -n "${!required:-}" ]] || {
      echo "[playwright-demo] ${required} is required when --skip-discourse is set" >&2
      exit 10
    }
  done
fi

mkdir -p "${ARTIFACT_DIR}"

PHASE1_WORKFLOW_ARTIFACT_DIR="${ARTIFACT_DIR}/workflow-phase1"
PHASE1_RESULT_METADATA_PATH="${PHASE1_WORKFLOW_ARTIFACT_DIR}/result.env"
PHASE2_WORKFLOW_ARTIFACT_DIR="${ARTIFACT_DIR}/workflow-phase2"
PHASE2_RESULT_METADATA_PATH="${PHASE2_WORKFLOW_ARTIFACT_DIR}/result.env"

load_workflow_result_metadata() {
  local metadata_path="$1"
  [[ -f "${metadata_path}" ]] || return 1
  unset WORKFLOW_RESULT_STATUS WORKFLOW_RESULT_CODE WORKFLOW_RESULT_MESSAGE \
    WORKFLOW_RESULT_ARTIFACT_DIR WORKFLOW_RESULT_SUMMARY_PATH WORKFLOW_RESULT_SEED_JSON_PATH
  # shellcheck disable=SC1090
  source "${metadata_path}"
  return 0
}

WORKFLOW_PAUSE_CMD=(
  env
  WORKFLOW_ARTIFACT_DIR="${PHASE1_WORKFLOW_ARTIFACT_DIR}"
  WORKFLOW_RESULT_METADATA_PATH="${PHASE1_RESULT_METADATA_PATH}"
  scripts/local-workflow-automation.sh
  --verbose
  --with-ember-cli
  --pause-at-step4
)
WORKFLOW_COMPLETE_CMD=(
  env
  WORKFLOW_ARTIFACT_DIR="${PHASE2_WORKFLOW_ARTIFACT_DIR}"
  WORKFLOW_RESULT_METADATA_PATH="${PHASE2_RESULT_METADATA_PATH}"
  scripts/local-workflow-automation.sh
  --verbose
  --with-ember-cli
)
WORKFLOW_PAUSE_CMD+=(--skip-withdrawal)
if [[ "${BROWSER_WITHDRAWAL}" -eq 1 ]]; then
  WORKFLOW_COMPLETE_CMD+=(--skip-withdrawal)
fi
WORKFLOW_COMPLETE_CMD+=(--skip-discourse)
if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
  WORKFLOW_PAUSE_CMD+=(--skip-services)
  WORKFLOW_COMPLETE_CMD+=(--skip-services)
fi
if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  WORKFLOW_PAUSE_CMD+=(--skip-discourse)
  WORKFLOW_COMPLETE_CMD+=(--skip-discourse)
fi

if [[ "${SKIP_DISCOURSE}" -eq 0 && -z "${FIBER_LINK_APP_ID:-}" ]]; then
  export FIBER_LINK_APP_ID="local-dev-${TIMESTAMP}"
  echo "[playwright-demo] using isolated app id: ${FIBER_LINK_APP_ID}"
fi

WORKFLOW_PAUSE_CMD_ESCAPED="$(printf '%q ' "${WORKFLOW_PAUSE_CMD[@]}")"
WORKFLOW_COMPLETE_CMD_ESCAPED="$(printf '%q ' "${WORKFLOW_COMPLETE_CMD[@]}")"

export ROOT_DIR
export WORKFLOW_PAUSE_CMD_ESCAPED
export ARTIFACT_DIR
export PW_DEMO_HEADED="${HEADED}"
export PW_DEMO_STEP4_SESSION="${PW_DEMO_STEP4_SESSION:-fiber-workflow-step4-${TIMESTAMP}}"

echo "[playwright-demo] artifacts: ${ARTIFACT_DIR}"
echo "[playwright-demo] phase1 (playwright tip demo): ${WORKFLOW_PAUSE_CMD_ESCAPED}"
echo "[playwright-demo] phase2 (backend settlement/checks): ${WORKFLOW_COMPLETE_CMD_ESCAPED}"

set +e
expect <<'EXPECT' | tee "${PAUSE_LOG}"
set timeout -1
set ran_step4 0

spawn -noecho bash -lc "cd \"$env(ROOT_DIR)\" && $env(WORKFLOW_PAUSE_CMD_ESCAPED)"

while {1} {
  expect {
    -re "Press Enter to continue workflow\\.\\.\\." {
      set ran_step4 1
      puts ""
      puts {[playwright-demo] pause-at-step4 reached; running Playwright tip flow...}
      puts ""
      set rc [catch {exec env PW_DEMO_HEADED=$env(PW_DEMO_HEADED) PW_DEMO_SESSION=$env(PW_DEMO_STEP4_SESSION) PW_DEMO_ARTIFACT_DIR=$env(ARTIFACT_DIR) $env(ROOT_DIR)/scripts/playwright-workflow-step4.sh} out]
      puts $out
      if {$rc != 0} {
        puts stderr {[playwright-demo] step4 Playwright automation failed.}
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

if {$ran_step4 == 0} {
  puts stderr {[playwright-demo] step4 pause was not reached.}
  exit 96
}

exit 0
EXPECT
pause_status=$?
set -e

if [[ "${pause_status}" -ne 0 ]]; then
  echo "[playwright-demo] phase1 failed; see ${PAUSE_LOG}" >&2
  exit "${pause_status}"
fi

load_workflow_result_metadata "${PHASE1_RESULT_METADATA_PATH}" || {
  echo "[playwright-demo] missing phase1 workflow metadata: ${PHASE1_RESULT_METADATA_PATH}" >&2
  exit 11
}
phase1_status="${WORKFLOW_RESULT_STATUS:-unknown}"
if [[ "${phase1_status}" != "RUNNING" && "${phase1_status}" != "PASS" ]]; then
  echo "[playwright-demo] phase1 workflow metadata status is unexpected (status=${phase1_status} code=${WORKFLOW_RESULT_CODE:-unknown})" >&2
  exit 11
fi

phase1_workflow_artifact_dir="${WORKFLOW_RESULT_ARTIFACT_DIR:-${PHASE1_WORKFLOW_ARTIFACT_DIR}}"

if [[ "${SKIP_DISCOURSE}" -eq 0 ]]; then
  seed_json_path="${WORKFLOW_RESULT_SEED_JSON_PATH:-${phase1_workflow_artifact_dir}/discourse-seed.json}"
  [[ -f "${seed_json_path}" ]] || {
    echo "[playwright-demo] missing discourse seed output: ${seed_json_path}" >&2
    exit 11
  }

  export WORKFLOW_TIPPER_USER_ID="$(jq -r '.tipper.id // empty' "${seed_json_path}")"
  export WORKFLOW_AUTHOR_USER_ID="$(jq -r '.author.id // empty' "${seed_json_path}")"
  export WORKFLOW_TOPIC_POST_ID="$(jq -r '.topic.first_post_id // empty' "${seed_json_path}")"
  export WORKFLOW_REPLY_POST_ID="$(jq -r '.reply.post_id // empty' "${seed_json_path}")"

  for required in WORKFLOW_TIPPER_USER_ID WORKFLOW_AUTHOR_USER_ID WORKFLOW_TOPIC_POST_ID WORKFLOW_REPLY_POST_ID; do
    [[ -n "${!required:-}" ]] || {
      echo "[playwright-demo] failed to parse ${required} from ${seed_json_path}" >&2
      exit 11
    }
  done
fi

author_balance_before=""
step4_result_log="${ARTIFACT_DIR}/playwright-step4-result.log"
if [[ -f "${step4_result_log}" ]]; then
  step4_result_json="$(awk '/^### Result/{getline; print; exit}' "${step4_result_log}" || true)"
  if [[ -n "${step4_result_json}" ]]; then
    author_balance_before="$(printf '%s\n' "${step4_result_json}" | jq -r '.authorBalanceBefore // empty' 2>/dev/null || true)"
  fi
fi

set +e
(cd "${ROOT_DIR}" && "${WORKFLOW_COMPLETE_CMD[@]}") | tee "${COMPLETE_LOG}"
workflow_status=${PIPESTATUS[0]}
set -e

load_workflow_result_metadata "${PHASE2_RESULT_METADATA_PATH}" || {
  echo "[playwright-demo] missing phase2 workflow metadata: ${PHASE2_RESULT_METADATA_PATH}" >&2
  exit 11
}
workflow_result_status="${WORKFLOW_RESULT_STATUS:-UNKNOWN}"
workflow_result_code="${WORKFLOW_RESULT_CODE:-}"
workflow_result_message="${WORKFLOW_RESULT_MESSAGE:-}"
workflow_artifact_dir="${WORKFLOW_RESULT_ARTIFACT_DIR:-${PHASE2_WORKFLOW_ARTIFACT_DIR}}"
summary_path="${WORKFLOW_RESULT_SUMMARY_PATH:-}"

echo "[playwright-demo] workflow result: status=${workflow_result_status} code=${workflow_result_code} artifact=${workflow_artifact_dir}"
if [[ -n "${workflow_result_message}" ]]; then
  echo "[playwright-demo] workflow message: ${workflow_result_message}"
fi

[[ -n "${workflow_artifact_dir}" ]] || {
  echo "[playwright-demo] failed to parse workflow artifact directory from ${COMPLETE_LOG}" >&2
  exit 11
}

withdrawal_id=""
withdrawal_state=""
withdrawal_destination_address="${WORKFLOW_WITHDRAW_TO_ADDRESS:-}"
author_balance_after=""

if [[ -n "${summary_path}" && -f "${summary_path}" ]]; then
  withdrawal_id="$(jq -r '.withdrawal.id // empty' "${summary_path}")"
  withdrawal_state="$(jq -r '.withdrawal.state // empty' "${summary_path}")"
  parsed_destination_address="$(jq -r '.withdrawal.destinationAddress // empty' "${summary_path}")"
  if [[ -z "${withdrawal_destination_address}" && -n "${parsed_destination_address}" ]]; then
    withdrawal_destination_address="${parsed_destination_address}"
  fi
fi

if [[ -z "${withdrawal_id}" && -f "${workflow_artifact_dir}/withdrawal/withdrawal.response.json" ]]; then
  withdrawal_id="$(jq -r '.result.id // empty' "${workflow_artifact_dir}/withdrawal/withdrawal.response.json")"
fi

if [[ -z "${withdrawal_state}" && -n "${withdrawal_id}" && -f "${workflow_artifact_dir}/withdrawal/withdrawal-status.poll.log" ]]; then
  withdrawal_state="$(
    jq -r --arg wid "${withdrawal_id}" \
      '.result.admin.withdrawals[]? | select(.id == $wid) | .state' \
      "${workflow_artifact_dir}/withdrawal/withdrawal-status.poll.log" | tail -n1
  )"
fi

soft_failure=0
if [[ "${workflow_status}" -ne 0 ]]; then
  if [[ "${workflow_result_code}" == "15" ]] && [[ "${withdrawal_state}" == "PENDING" || "${withdrawal_state}" == "PROCESSING" || "${withdrawal_state}" == "RETRY_PENDING" || -n "${withdrawal_id}" ]]; then
    soft_failure=1
    echo "[playwright-demo] workflow ended without PASS result; continuing demo with withdrawal id/state=${withdrawal_id}/${withdrawal_state}"
  else
    exit "${workflow_status}"
  fi
fi

postcheck_dir="${ARTIFACT_DIR}/postcheck"
mkdir -p "${postcheck_dir}"

PW_DEMO_HEADED="${HEADED}" \
PW_DEMO_SESSION="${PW_DEMO_POSTCHECK_SESSION:-fiber-workflow-postcheck-${TIMESTAMP}}" \
PW_DEMO_ARTIFACT_DIR="${postcheck_dir}" \
PW_DEMO_WITHDRAWAL_ID="${withdrawal_id}" \
PW_DEMO_WITHDRAW_AMOUNT="${WORKFLOW_WITHDRAW_AMOUNT:-61}" \
PW_DEMO_WITHDRAW_TO_ADDRESS="${withdrawal_destination_address}" \
PW_DEMO_INITIATE_WITHDRAWAL="$([[ "${BROWSER_WITHDRAWAL}" -eq 1 && -z "${withdrawal_id}" ]] && echo 1 || echo 0)" \
  "${ROOT_DIR}/scripts/playwright-workflow-postcheck.sh"

postcheck_result_log="${postcheck_dir}/playwright-postcheck-result.log"
postcheck_error=""
if [[ -f "${postcheck_result_log}" ]]; then
  postcheck_result_json="$(awk '/^### Result/{getline; print; exit}' "${postcheck_result_log}" || true)"
  if [[ -n "${postcheck_result_json}" ]]; then
    postcheck_withdrawal_id="$(printf '%s\n' "${postcheck_result_json}" | jq -r '.withdrawalId // empty' 2>/dev/null || true)"
    postcheck_withdrawal_state="$(printf '%s\n' "${postcheck_result_json}" | jq -r '.adminExtractedState // .withdrawalRequestedState // empty' 2>/dev/null || true)"
    postcheck_author_balance="$(printf '%s\n' "${postcheck_result_json}" | jq -r '.authorBalance // empty' 2>/dev/null || true)"
    postcheck_error="$(printf '%s\n' "${postcheck_result_json}" | jq -r '.error // empty' 2>/dev/null || true)"
    if [[ -z "${withdrawal_id}" && -n "${postcheck_withdrawal_id}" ]]; then
      withdrawal_id="${postcheck_withdrawal_id}"
    fi
    if [[ ( -z "${withdrawal_state}" || "${withdrawal_state}" == "SKIPPED" ) && -n "${postcheck_withdrawal_state}" ]]; then
      withdrawal_state="${postcheck_withdrawal_state}"
    fi
    if [[ -n "${postcheck_author_balance}" ]]; then
      author_balance_after="${postcheck_author_balance}"
    fi
  fi
fi

echo "[playwright-demo] workflow artifact dir: ${workflow_artifact_dir}"
if [[ -n "${summary_path}" ]]; then
  echo "[playwright-demo] workflow summary: ${summary_path}"
else
  echo "[playwright-demo] workflow summary: <none>"
fi
echo "[playwright-demo] author balance before tip: ${author_balance_before:-<unknown>}"
echo "[playwright-demo] author balance after tip: ${author_balance_after:-<unknown>}"
echo "[playwright-demo] withdrawal id/state: ${withdrawal_id} / ${withdrawal_state}"
echo "[playwright-demo] playwright artifacts: ${ARTIFACT_DIR}"

if [[ -n "${postcheck_error}" ]]; then
  echo "[playwright-demo] postcheck failed: ${postcheck_error}" >&2
  exit 12
fi

if [[ "${soft_failure}" -eq 1 ]]; then
  exit 0
fi
