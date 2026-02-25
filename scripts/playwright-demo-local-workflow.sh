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

usage() {
  cat <<'EOF'
Usage: scripts/playwright-demo-local-workflow.sh [--skip-services] [--skip-discourse] [--headless]

Runs an end-to-end local demo:
1) launch discourse + fiber services (unless skipped)
2) run local-workflow with --pause-at-step4
3) at pause, execute Playwright login + tip modal flow automatically
4) continue workflow until withdrawal completes
5) execute Playwright post-check for author balance and withdrawal row

Options:
  --skip-services   Skip service rebuild/bootstrap.
  --skip-discourse  Skip discourse bootstrap/seeding.
  --headless        Run Playwright browser in headless mode.
  -h, --help        Show this help text.

Required env:
  FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=0x...

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

[[ -n "${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-}" ]] || {
  echo "[playwright-demo] FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required" >&2
  exit 10
}

if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  for required in WORKFLOW_TIPPER_USER_ID WORKFLOW_AUTHOR_USER_ID WORKFLOW_TOPIC_POST_ID WORKFLOW_REPLY_POST_ID; do
    [[ -n "${!required:-}" ]] || {
      echo "[playwright-demo] ${required} is required when --skip-discourse is set" >&2
      exit 10
    }
  done
fi

mkdir -p "${ARTIFACT_DIR}"

WORKFLOW_PAUSE_CMD=(scripts/local-workflow-automation.sh --verbose --with-ember-cli --pause-at-step4)
WORKFLOW_COMPLETE_CMD=(scripts/local-workflow-automation.sh --verbose --with-ember-cli)
if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
  WORKFLOW_PAUSE_CMD+=(--skip-services)
  WORKFLOW_COMPLETE_CMD+=(--skip-services)
fi
if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
  WORKFLOW_PAUSE_CMD+=(--skip-discourse)
  WORKFLOW_COMPLETE_CMD+=(--skip-discourse)
fi

WORKFLOW_PAUSE_CMD_ESCAPED="$(printf '%q ' "${WORKFLOW_PAUSE_CMD[@]}")"
WORKFLOW_COMPLETE_CMD_ESCAPED="$(printf '%q ' "${WORKFLOW_COMPLETE_CMD[@]}")"

export ROOT_DIR
export WORKFLOW_PAUSE_CMD_ESCAPED
export ARTIFACT_DIR
export PW_DEMO_HEADED="${HEADED}"
export PW_DEMO_STEP4_SESSION="${PW_DEMO_STEP4_SESSION:-fiber-workflow-step4}"

echo "[playwright-demo] artifacts: ${ARTIFACT_DIR}"
echo "[playwright-demo] phase1 (playwright tip demo): ${WORKFLOW_PAUSE_CMD_ESCAPED}"
echo "[playwright-demo] phase2 (backend completion): ${WORKFLOW_COMPLETE_CMD_ESCAPED}"

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

set +e
(cd "${ROOT_DIR}" && "${WORKFLOW_COMPLETE_CMD[@]}") | tee "${COMPLETE_LOG}"
workflow_status=${PIPESTATUS[0]}
set -e

result_line="$(rg 'RESULT=(PASS|FAIL)' "${COMPLETE_LOG}" | tail -n1 || true)"
workflow_artifact_dir=""
summary_path=""

if [[ -n "${result_line}" ]]; then
  echo "[playwright-demo] workflow result: ${result_line}"
  workflow_artifact_dir="$(printf '%s\n' "${result_line}" | sed -n 's/.*ARTIFACT_DIR=\([^ ]*\).*/\1/p')"
  summary_path="$(printf '%s\n' "${result_line}" | sed -n 's/.*SUMMARY=\([^ ]*\).*/\1/p')"
else
  workflow_artifact_dir="$(sed -n 's/^\[local-workflow\] artifacts: //p' "${COMPLETE_LOG}" | tail -n1)"
  echo "[playwright-demo] RESULT line missing; fallback artifact dir: ${workflow_artifact_dir}"
fi

[[ -n "${workflow_artifact_dir}" ]] || {
  echo "[playwright-demo] failed to parse workflow artifact directory from ${COMPLETE_LOG}" >&2
  exit 11
}

withdrawal_id=""
withdrawal_state=""

if [[ -n "${summary_path}" && -f "${summary_path}" ]]; then
  withdrawal_id="$(jq -r '.withdrawal.id // empty' "${summary_path}")"
  withdrawal_state="$(jq -r '.withdrawal.state // empty' "${summary_path}")"
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
  if [[ "${result_line}" == *"CODE=15"* || -z "${result_line}" ]] && [[ "${withdrawal_state}" == "PENDING" || "${withdrawal_state}" == "PROCESSING" || "${withdrawal_state}" == "RETRY_PENDING" || -n "${withdrawal_id}" ]]; then
    soft_failure=1
    echo "[playwright-demo] workflow ended without PASS result; continuing demo with withdrawal id/state=${withdrawal_id}/${withdrawal_state}"
  else
    exit "${workflow_status}"
  fi
fi

postcheck_dir="${ARTIFACT_DIR}/postcheck"
mkdir -p "${postcheck_dir}"

PW_DEMO_HEADED="${HEADED}" \
PW_DEMO_SESSION="${PW_DEMO_POSTCHECK_SESSION:-fiber-workflow-postcheck}" \
PW_DEMO_ARTIFACT_DIR="${postcheck_dir}" \
PW_DEMO_WITHDRAWAL_ID="${withdrawal_id}" \
  "${ROOT_DIR}/scripts/playwright-workflow-postcheck.sh"

echo "[playwright-demo] workflow artifact dir: ${workflow_artifact_dir}"
if [[ -n "${summary_path}" ]]; then
  echo "[playwright-demo] workflow summary: ${summary_path}"
else
  echo "[playwright-demo] workflow summary: <none>"
fi
echo "[playwright-demo] withdrawal id/state: ${withdrawal_id} / ${withdrawal_state}"
echo "[playwright-demo] playwright artifacts: ${ARTIFACT_DIR}"

if [[ "${soft_failure}" -eq 1 ]]; then
  exit 0
fi
