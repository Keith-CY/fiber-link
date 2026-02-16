#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_DEMO_FAILURE=11
EXIT_VALIDATION_FAILURE=12
EXIT_ARCHIVE_FAILURE=13

MODE="dry-run"
FIXTURE_FILE=""
RETENTION_DAYS=30
OUTPUT_ROOT=""
DRY_RUN=0
VERBOSE=0
SCREENSHOT_PATHS=()

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${ROOT_DIR}/deploy/compose/evidence/w5-demo"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"

COMMAND_LOG=""
STEP_RESULTS_FILE=""
OVERALL_FAILURE=0

EVIDENCE_JSON="${EVIDENCE_DIR}/artifacts/01-w5-demo.evidence.json"
SUMMARY_JSON="${EVIDENCE_DIR}/artifacts/02-w5-demo.summary.json"
TRACE_JSONL="${EVIDENCE_DIR}/artifacts/03-w5-demo.trace.jsonl"

usage() {
  cat <<'USAGE'
Usage: scripts/capture-w5-demo-evidence.sh [options]

Options:
  --mode <dry-run|live>     Demo mode passed to w5-demo.ts (default: dry-run).
  --fixture-file <path>     Optional fixture file passed through to w5-demo.ts.
  --screenshot <path>       Optional screenshot file to include (can repeat).
  --output-root <path>      Output root (default: deploy/compose/evidence/w5-demo).
  --retention-days <n>      Retention days recorded in metadata (default: 30).
  --dry-run                 Build bundle structure + command plan without running demo.
  --verbose                 Print extra progress logs.
  -h, --help               Show this help message.

Exit codes:
  0   PASS
  2   invalid usage
  10  precheck failure
  11  demo command failure
  12  evidence validation failure
  13  archive generation failure
USAGE
}

log() {
  printf '[w5-evidence] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

write_step_result() {
  local name="$1"
  local status="$2"
  local stdout_file="$3"
  local stderr_file="$4"
  local command="$5"
  printf '%s\t%s\t%s\t%s\t%s\n' "${name}" "${status}" "${stdout_file}" "${stderr_file}" "${command}" >> "${STEP_RESULTS_FILE}"
}

run_step() {
  local name="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local command="$4"

  mkdir -p "$(dirname "${stdout_file}")" "$(dirname "${stderr_file}")"
  printf '[%s] %s\n' "${name}" "${command}" >> "${COMMAND_LOG}"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '[DRY-RUN] %s\n' "${command}" > "${stdout_file}"
    : > "${stderr_file}"
    write_step_result "${name}" "DRY_RUN" "${stdout_file}" "${stderr_file}" "${command}"
    return 0
  fi

  set +e
  bash -c "${command}" > "${stdout_file}" 2> "${stderr_file}"
  local rc=$?
  set -e

  if [[ "${rc}" -eq 0 ]]; then
    write_step_result "${name}" "PASS" "${stdout_file}" "${stderr_file}" "${command}"
    return 0
  fi

  write_step_result "${name}" "FAIL:${rc}" "${stdout_file}" "${stderr_file}" "${command}"
  OVERALL_FAILURE=1
  return "${rc}"
}

status_for_bool() {
  if [[ "$1" == "true" ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

status_for_presence() {
  if [[ -n "$1" && "$1" != "null" ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      MODE="$2"
      shift
      ;;
    --fixture-file)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      FIXTURE_FILE="$2"
      shift
      ;;
    --screenshot)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SCREENSHOT_PATHS+=("$2")
      shift
      ;;
    --output-root)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      OUTPUT_ROOT="$2"
      shift
      ;;
    --retention-days)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RETENTION_DAYS="$2"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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

if [[ "${MODE}" != "dry-run" && "${MODE}" != "live" ]]; then
  log "--mode must be dry-run or live"
  exit "${EXIT_USAGE}"
fi

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  log "--retention-days must be a non-negative integer"
  exit "${EXIT_USAGE}"
fi

EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"
COMMAND_LOG="${EVIDENCE_DIR}/commands/command-index.log"
STEP_RESULTS_FILE="${EVIDENCE_DIR}/status/step-results.tsv"

for binary in bash bun jq tar awk; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    log "missing required binary: ${binary}"
    exit "${EXIT_PRECHECK}"
  fi
done

WORKER_SCRIPT="${ROOT_DIR}/fiber-link-service/apps/worker/src/scripts/w5-demo.ts"
if [[ ! -f "${WORKER_SCRIPT}" ]]; then
  log "missing w5 demo script: ${WORKER_SCRIPT}"
  exit "${EXIT_PRECHECK}"
fi

mkdir -p \
  "${EVIDENCE_DIR}/commands" \
  "${EVIDENCE_DIR}/logs" \
  "${EVIDENCE_DIR}/status" \
  "${EVIDENCE_DIR}/artifacts" \
  "${EVIDENCE_DIR}/screenshots" \
  "${EVIDENCE_DIR}/metadata"

printf 'step\tstatus\tstdout\tstderr\tcommand\n' > "${STEP_RESULTS_FILE}"
printf '# w5 demo evidence command log\n' > "${COMMAND_LOG}"

run_step \
  "git-head" \
  "${EVIDENCE_DIR}/logs/00-git-head.stdout.log" \
  "${EVIDENCE_DIR}/logs/00-git-head.stderr.log" \
  "cd \"${ROOT_DIR}\" && git rev-parse HEAD"

run_step \
  "git-branch" \
  "${EVIDENCE_DIR}/logs/00-git-branch.stdout.log" \
  "${EVIDENCE_DIR}/logs/00-git-branch.stderr.log" \
  "cd \"${ROOT_DIR}\" && git rev-parse --abbrev-ref HEAD"

DEMO_CMD="cd \"${ROOT_DIR}/fiber-link-service/apps/worker\" && bun run src/scripts/w5-demo.ts -- --mode=${MODE} --evidence-file=\"${EVIDENCE_JSON}\""
if [[ -n "${FIXTURE_FILE}" ]]; then
  DEMO_CMD+=" --fixture-file=\"${FIXTURE_FILE}\""
fi

set +e
run_step \
  "run-w5-demo" \
  "${EVIDENCE_DIR}/logs/01-w5-demo.stdout.log" \
  "${EVIDENCE_DIR}/logs/01-w5-demo.stderr.log" \
  "${DEMO_CMD}"
DEMO_RC=$?
set -e

if [[ "${DRY_RUN}" -eq 1 ]]; then
  cat > "${EVIDENCE_DIR}/status/verification-checklist.md" <<'DRYRUN'
# W5 Demo Verification Checklist

Dry-run mode: command plan only. No live evidence validation executed.
DRYRUN
else
  if [[ "${DEMO_RC}" -eq 0 && -s "${EVIDENCE_JSON}" ]]; then
    jq '.summary' "${EVIDENCE_JSON}" > "${SUMMARY_JSON}"
    jq -c '.trace[]?' "${EVIDENCE_JSON}" > "${TRACE_JSONL}"

    settlement_settled="$(jq -r '.summary.settlement.settled // false' "${EVIDENCE_JSON}")"
    settlement_credit_verified="$(jq -r '.summary.accounting.settlementCreditVerified // false' "${EVIDENCE_JSON}")"
    final_balance_verified="$(jq -r '.summary.accounting.finalBalanceVerified // false' "${EVIDENCE_JSON}")"
    withdrawal_state="$(jq -r '.summary.accounting.withdrawalState // ""' "${EVIDENCE_JSON}")"

    invoice_id="$(jq -r '.summary.invoice.id // ""' "${EVIDENCE_JSON}")"
    tip_intent_id="$(jq -r '.summary.invoice.tipIntentId // ""' "${EVIDENCE_JSON}")"
    payment_request_id="$(jq -r '.summary.payment.requestId // ""' "${EVIDENCE_JSON}")"
    payment_tx_hash="$(jq -r '.summary.payment.txHash // ""' "${EVIDENCE_JSON}")"
    withdrawal_request_id="$(jq -r '.summary.accounting.withdrawalRequestId // ""' "${EVIDENCE_JSON}")"
    withdrawal_tx_hash="$(jq -r '.summary.accounting.withdrawalTxHash // ""' "${EVIDENCE_JSON}")"

    settled_status="$(status_for_bool "${settlement_settled}")"
    credit_status="$(status_for_bool "${settlement_credit_verified}")"
    final_balance_status="$(status_for_bool "${final_balance_verified}")"
    if [[ "${withdrawal_state}" == "COMPLETED" ]]; then
      withdrawal_status="PASS"
    else
      withdrawal_status="FAIL"
    fi

    invoice_status="$(status_for_presence "${invoice_id}")"
    tip_intent_status="$(status_for_presence "${tip_intent_id}")"
    payment_request_status="$(status_for_presence "${payment_request_id}")"
    payment_tx_status="$(status_for_presence "${payment_tx_hash}")"
    withdrawal_request_status="$(status_for_presence "${withdrawal_request_id}")"
    withdrawal_tx_status="$(status_for_presence "${withdrawal_tx_hash}")"

    if [[ "${settled_status}" != "PASS" || "${credit_status}" != "PASS" || "${final_balance_status}" != "PASS" || "${withdrawal_status}" != "PASS" || "${invoice_status}" != "PASS" || "${tip_intent_status}" != "PASS" || "${payment_request_status}" != "PASS" || "${payment_tx_status}" != "PASS" || "${withdrawal_request_status}" != "PASS" || "${withdrawal_tx_status}" != "PASS" ]]; then
      OVERALL_FAILURE=1
      VALIDATION_FAILURE=1
    else
      VALIDATION_FAILURE=0
    fi

    cat > "${EVIDENCE_DIR}/status/verification-checklist.md" <<CHECKLIST
# W5 Demo Verification Checklist

| Check | Status | Evidence |
| --- | --- | --- |
| Demo command completed | PASS | \
\`logs/01-w5-demo.stdout.log\`, \
\`logs/01-w5-demo.stderr.log\` |
| Settlement reached terminal settled state | ${settled_status} | \`artifacts/02-w5-demo.summary.json\` |
| Settlement credit verification passed | ${credit_status} | \`artifacts/02-w5-demo.summary.json\` |
| Withdrawal completed | ${withdrawal_status} | \`artifacts/02-w5-demo.summary.json\` |
| Final balance verification passed | ${final_balance_status} | \`artifacts/02-w5-demo.summary.json\` |
| Invoice ID captured | ${invoice_status} | \`artifacts/02-w5-demo.summary.json\` |
| Tip intent ID captured | ${tip_intent_status} | \`artifacts/02-w5-demo.summary.json\` |
| Payment request ID captured | ${payment_request_status} | \`artifacts/02-w5-demo.summary.json\` |
| Payment tx hash captured | ${payment_tx_status} | \`artifacts/02-w5-demo.summary.json\` |
| Withdrawal request ID captured | ${withdrawal_request_status} | \`artifacts/02-w5-demo.summary.json\` |
| Withdrawal tx hash captured | ${withdrawal_tx_status} | \`artifacts/02-w5-demo.summary.json\` |

## Key IDs

- Invoice ID: ${invoice_id:-<missing>}
- Tip Intent ID: ${tip_intent_id:-<missing>}
- Payment Request ID: ${payment_request_id:-<missing>}
- Payment Tx Hash: ${payment_tx_hash:-<missing>}
- Withdrawal Request ID: ${withdrawal_request_id:-<missing>}
- Withdrawal Tx Hash: ${withdrawal_tx_hash:-<missing>}
CHECKLIST

    jq -n \
      --arg generatedAtUtc "${TIMESTAMP}" \
      --arg mode "${MODE}" \
      --arg evidenceJson "artifacts/01-w5-demo.evidence.json" \
      --arg summaryJson "artifacts/02-w5-demo.summary.json" \
      --arg traceJsonl "artifacts/03-w5-demo.trace.jsonl" \
      --arg commandLog "commands/command-index.log" \
      --arg stepResults "status/step-results.tsv" \
      --arg checklist "status/verification-checklist.md" \
      --arg invoiceId "${invoice_id}" \
      --arg tipIntentId "${tip_intent_id}" \
      --arg paymentRequestId "${payment_request_id}" \
      --arg paymentTxHash "${payment_tx_hash}" \
      --arg withdrawalRequestId "${withdrawal_request_id}" \
      --arg withdrawalTxHash "${withdrawal_tx_hash}" \
      --arg settlementSettled "${settlement_settled}" \
      --arg settlementCreditVerified "${settlement_credit_verified}" \
      --arg finalBalanceVerified "${final_balance_verified}" \
      --arg withdrawalState "${withdrawal_state}" \
      --argjson retentionDays "${RETENTION_DAYS}" \
      '{
        generatedAtUtc: $generatedAtUtc,
        mode: $mode,
        retentionDays: $retentionDays,
        files: {
          evidenceJson: $evidenceJson,
          summaryJson: $summaryJson,
          traceJsonl: $traceJsonl,
          commandLog: $commandLog,
          stepResults: $stepResults,
          checklist: $checklist
        },
        ids: {
          invoiceId: $invoiceId,
          tipIntentId: $tipIntentId,
          paymentRequestId: $paymentRequestId,
          paymentTxHash: $paymentTxHash,
          withdrawalRequestId: $withdrawalRequestId,
          withdrawalTxHash: $withdrawalTxHash
        },
        checks: {
          settlementSettled: ($settlementSettled == "true"),
          settlementCreditVerified: ($settlementCreditVerified == "true"),
          finalBalanceVerified: ($finalBalanceVerified == "true"),
          withdrawalCompleted: ($withdrawalState == "COMPLETED")
        }
      }' > "${EVIDENCE_DIR}/metadata/manifest.json"
  else
    OVERALL_FAILURE=1
    VALIDATION_FAILURE=1
    cat > "${EVIDENCE_DIR}/status/verification-checklist.md" <<'FAILED'
# W5 Demo Verification Checklist

Demo command failed before evidence validation could complete.
Review:
- logs/01-w5-demo.stdout.log
- logs/01-w5-demo.stderr.log
FAILED
  fi
fi

if [[ ${#SCREENSHOT_PATHS[@]} -gt 0 ]]; then
  screenshot_index=1
  for screenshot_path in "${SCREENSHOT_PATHS[@]}"; do
    if [[ ! -f "${screenshot_path}" ]]; then
      log "warning: screenshot path not found, skipping: ${screenshot_path}"
      continue
    fi

    file_ext="${screenshot_path##*.}"
    if [[ "${file_ext}" == "${screenshot_path}" ]]; then
      file_ext="png"
    fi

    target="${EVIDENCE_DIR}/screenshots/$(printf '%02d' "${screenshot_index}")-stakeholder-capture.${file_ext}"
    cp "${screenshot_path}" "${target}"
    screenshot_index=$((screenshot_index + 1))
  done
fi

cat > "${EVIDENCE_DIR}/metadata/retention-policy.md" <<RETENTION
# Retention Policy

- Minimum retention: ${RETENTION_DAYS} days.
- Keep this bundle immutable during the retention window.
- Archive this bundle in release/issue evidence before cleanup.
- Suggested cleanup command:
  \`find \"$(dirname "${EVIDENCE_DIR}")\" -mindepth 1 -maxdepth 1 -type d -mtime +${RETENTION_DAYS} -exec rm -rf {} +\`
RETENTION

set +e
tar -czf "${ARCHIVE_FILE}" -C "$(dirname "${EVIDENCE_DIR}")" "$(basename "${EVIDENCE_DIR}")"
archive_rc=$?
set -e

if [[ "${archive_rc}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' \
    "${EXIT_ARCHIVE_FAILURE}" "archive generation failed" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_ARCHIVE_FAILURE}"
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  printf 'RESULT=PASS CODE=0 MODE=DRY_RUN EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_OK}"
fi

if [[ "${DEMO_RC}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' \
    "${EXIT_DEMO_FAILURE}" "w5 demo command failed" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_DEMO_FAILURE}"
fi

if [[ "${OVERALL_FAILURE}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' \
    "${EXIT_VALIDATION_FAILURE}" "evidence validation failed" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_VALIDATION_FAILURE}"
fi

printf 'RESULT=PASS CODE=0 EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
exit "${EXIT_OK}"
