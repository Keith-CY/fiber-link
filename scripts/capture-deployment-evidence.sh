#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_CAPTURE_FAILURE=11
EXIT_ARCHIVE_FAILURE=12

DRY_RUN=0
VERBOSE=0
INVOICE_ID=""
SETTLEMENT_ID=""
RETENTION_DAYS=30

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
TEMPLATE_DIR="${ROOT_DIR}/docs/runbooks/evidence-template/deployment"
OUTPUT_ROOT="${ROOT_DIR}/deploy/compose/evidence"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"

COMMAND_LOG=""
STEP_RESULTS_FILE=""
OVERALL_FAILURE=0

usage() {
  printf '%s\n' \
    "Usage: scripts/capture-deployment-evidence.sh [options]" \
    "" \
    "Options:" \
    "  --invoice-id <id>       Invoice ID to include in evidence metadata." \
    "  --settlement-id <id>    Settlement ID/hash to include in evidence metadata." \
    "  --retention-days <n>    Retention policy in days (default: 30)." \
    "  --output-root <path>    Output root directory (default: deploy/compose/evidence)." \
    "  --dry-run               Generate structure + command plan without running capture commands." \
    "  --verbose               Print progress logs." \
    "  -h, --help              Show this help message." \
    "" \
    "Exit codes:" \
    "  0   PASS" \
    "  2   invalid usage" \
    "  10  precheck failure" \
    "  11  capture step failed (bundle still generated)" \
    "  12  archive generation failure"
}

log() {
  printf '[deployment-evidence] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

write_step_result() {
  local name="$1"
  local status="$2"
  local output_file="$3"
  local command="$4"
  printf '%s\t%s\t%s\t%s\n' "${name}" "${status}" "${output_file}" "${command}" >> "${STEP_RESULTS_FILE}"
}

run_step() {
  local name="$1"
  local output_file="$2"
  local command="$3"
  mkdir -p "$(dirname "${output_file}")"
  printf '[%s] %s\n' "${name}" "${command}" >> "${COMMAND_LOG}"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '[DRY-RUN] %s\n' "${command}" > "${output_file}"
    write_step_result "${name}" "DRY_RUN" "${output_file}" "${command}"
    return 0
  fi

  set +e
  bash -c "${command}" > "${output_file}" 2>&1
  local rc=$?
  set -e

  if [[ "${rc}" -eq 0 ]]; then
    write_step_result "${name}" "PASS" "${output_file}" "${command}"
    return 0
  fi

  write_step_result "${name}" "FAIL:${rc}" "${output_file}" "${command}"
  OVERALL_FAILURE=1
  return 0
}

step_status() {
  local step_name="$1"
  awk -F'\t' -v name="${step_name}" '$1 == name { print $2 }' "${STEP_RESULTS_FILE}" | tail -n1
}

step_is_success() {
  local status
  status="$(step_status "$1")"
  [[ "${status}" == "PASS" || "${status}" == "DRY_RUN" ]]
}

bool_status() {
  if [[ "$1" -eq 0 ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --invoice-id)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      INVOICE_ID="$2"
      shift
      ;;
    --settlement-id)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SETTLEMENT_ID="$2"
      shift
      ;;
    --retention-days)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RETENTION_DAYS="$2"
      shift
      ;;
    --output-root)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      OUTPUT_ROOT="$2"
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

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  log "--retention-days must be a non-negative integer"
  exit "${EXIT_USAGE}"
fi

EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"
COMMAND_LOG="${EVIDENCE_DIR}/commands/command-index.log"
STEP_RESULTS_FILE="${EVIDENCE_DIR}/status/step-results.tsv"

for binary in bash docker git tar awk jq; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    log "missing required binary: ${binary}"
    exit "${EXIT_PRECHECK}"
  fi
done

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  log "missing compose file: ${COMPOSE_FILE}"
  exit "${EXIT_PRECHECK}"
fi

if [[ ! -d "${TEMPLATE_DIR}" ]]; then
  log "missing evidence template directory: ${TEMPLATE_DIR}"
  exit "${EXIT_PRECHECK}"
fi

mkdir -p \
  "${EVIDENCE_DIR}/commands" \
  "${EVIDENCE_DIR}/logs" \
  "${EVIDENCE_DIR}/node" \
  "${EVIDENCE_DIR}/ids" \
  "${EVIDENCE_DIR}/status" \
  "${EVIDENCE_DIR}/snapshots" \
  "${EVIDENCE_DIR}/metadata"

printf 'step\tstatus\toutput_file\tcommand\n' > "${STEP_RESULTS_FILE}"
printf '# deployment evidence command log\n' > "${COMMAND_LOG}"

cp -R "${TEMPLATE_DIR}" "${EVIDENCE_DIR}/metadata/template-reference"

if [[ -n "${INVOICE_ID}" ]]; then
  printf '%s\n' "${INVOICE_ID}" > "${EVIDENCE_DIR}/ids/invoice-id.txt"
else
  printf 'UNSET\n' > "${EVIDENCE_DIR}/ids/invoice-id.txt"
fi

if [[ -n "${SETTLEMENT_ID}" ]]; then
  printf '%s\n' "${SETTLEMENT_ID}" > "${EVIDENCE_DIR}/ids/settlement-id.txt"
else
  printf 'UNSET\n' > "${EVIDENCE_DIR}/ids/settlement-id.txt"
fi

vlog "capturing deployment evidence into ${EVIDENCE_DIR}"

run_step "git-head" "${EVIDENCE_DIR}/snapshots/git-head.txt" "cd \"${ROOT_DIR}\" && git rev-parse HEAD"
run_step "git-branch" "${EVIDENCE_DIR}/snapshots/git-branch.txt" "cd \"${ROOT_DIR}\" && git rev-parse --abbrev-ref HEAD"
run_step "docker-version" "${EVIDENCE_DIR}/snapshots/docker-version.txt" "docker version"
run_step "compose-config" "${EVIDENCE_DIR}/snapshots/compose-config.txt" "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" config"
run_step "compose-ps" "${EVIDENCE_DIR}/snapshots/compose-ps.txt" "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" ps"
run_step "compose-logs" "${EVIDENCE_DIR}/logs/compose-services.log" "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" logs --no-color --timestamps rpc worker fnn postgres redis"
run_step "node-fnn-metadata" "${EVIDENCE_DIR}/node/fnn-container-inspect.json" "docker inspect fiber-link-fnn"
run_step "node-rpc-metadata" "${EVIDENCE_DIR}/node/rpc-container-inspect.json" "docker inspect fiber-link-rpc"
run_step "node-worker-metadata" "${EVIDENCE_DIR}/node/worker-container-inspect.json" "docker inspect fiber-link-worker"

compose_logs_status=1
node_metadata_status=1
status_snapshot_status=1
command_output_mapping_status=1

if step_is_success "compose-logs"; then
  compose_logs_status=0
fi

if step_is_success "node-fnn-metadata" && step_is_success "node-rpc-metadata" && step_is_success "node-worker-metadata"; then
  node_metadata_status=0
fi

if step_is_success "compose-ps" && step_is_success "compose-config"; then
  status_snapshot_status=0
fi

if [[ -s "${COMMAND_LOG}" && -s "${STEP_RESULTS_FILE}" ]]; then
  command_output_mapping_status=0
fi

if [[ "${compose_logs_status}" -ne 0 || "${node_metadata_status}" -ne 0 || "${status_snapshot_status}" -ne 0 || "${command_output_mapping_status}" -ne 0 ]]; then
  OVERALL_FAILURE=1
fi

invoice_id_value="$(cat "${EVIDENCE_DIR}/ids/invoice-id.txt")"
settlement_id_value="$(cat "${EVIDENCE_DIR}/ids/settlement-id.txt")"
overall_status="$(bool_status "${OVERALL_FAILURE}")"
mapping_status="$(bool_status "${command_output_mapping_status}")"
compose_logs_mapping_status="$(bool_status "${compose_logs_status}")"
node_metadata_mapping_status="$(bool_status "${node_metadata_status}")"
snapshot_mapping_status="$(bool_status "${status_snapshot_status}")"

{
  printf '%s\n' "# Deployment Evidence Acceptance Mapping"
  printf '\n'
  printf 'Generated at: %s\n' "${TIMESTAMP}"
  printf '\n'
  printf '%s\n' "| Acceptance Criterion | Status | Evidence |"
  printf '%s\n' "| --- | --- | --- |"
  printf '| Evidence bundle can be produced for one deployment in one command | %s | `scripts/capture-deployment-evidence.sh` output, `metadata/manifest.json` |\n' "${overall_status}"
  printf '| Evidence contains command + output + status mapping to acceptance criteria | %s | `commands/command-index.log`, `status/step-results.tsv`, `status/acceptance-mapping.md` |\n' "${mapping_status}"
  printf '| Required compose logs captured | %s | `logs/compose-services.log` |\n' "${compose_logs_mapping_status}"
  printf '| Required node metadata captured | %s | `node/fnn-container-inspect.json`, `node/rpc-container-inspect.json`, `node/worker-container-inspect.json` |\n' "${node_metadata_mapping_status}"
  printf '%s\n' '| Invoice and settlement IDs recorded | PASS | `ids/invoice-id.txt`, `ids/settlement-id.txt` |'
  printf '| Status snapshots captured | %s | `snapshots/compose-ps.txt`, `snapshots/compose-config.txt` |\n' "${snapshot_mapping_status}"
  printf '\n'
  printf 'Invoice ID value: %s\n' "${invoice_id_value}"
  printf 'Settlement ID value: %s\n' "${settlement_id_value}"
} > "${EVIDENCE_DIR}/status/acceptance-mapping.md"

{
  printf '%s\n' "# Retention Policy"
  printf '\n'
  printf '%s\n' "- Recommended minimum local retention: ${RETENTION_DAYS} days."
  printf '%s\n' "- Keep the full evidence directory immutable during the retention window."
  printf '%s\n' "- Before cleanup, archive this bundle to long-term ticket/project evidence storage."
  printf '%s\n' "- Suggested cleanup command after retention: \`find \"$(dirname "${EVIDENCE_DIR}")\" -mindepth 1 -maxdepth 1 -type d -mtime +${RETENTION_DAYS} -exec rm -rf {} +\`"
} > "${EVIDENCE_DIR}/metadata/retention-policy.md"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  dry_run_json=true
else
  dry_run_json=false
fi

jq -n \
  --arg generatedAtUtc "${TIMESTAMP}" \
  --argjson retentionDays "${RETENTION_DAYS}" \
  --arg invoiceId "${invoice_id_value}" \
  --arg settlementId "${settlement_id_value}" \
  --argjson dryRun "${dry_run_json}" \
  --arg overallStatus "${overall_status}" \
  '{
    generatedAtUtc: $generatedAtUtc,
    retentionDays: $retentionDays,
    invoiceId: $invoiceId,
    settlementId: $settlementId,
    dryRun: $dryRun,
    overallStatus: $overallStatus,
    files: {
      commands: "commands/command-index.log",
      stepResults: "status/step-results.tsv",
      acceptanceMapping: "status/acceptance-mapping.md",
      composeLogs: "logs/compose-services.log",
      fnnMetadata: "node/fnn-container-inspect.json",
      rpcMetadata: "node/rpc-container-inspect.json",
      workerMetadata: "node/worker-container-inspect.json",
      composeStatusSnapshot: "snapshots/compose-ps.txt",
      composeConfigSnapshot: "snapshots/compose-config.txt"
    }
  }' > "${EVIDENCE_DIR}/metadata/manifest.json"

set +e
tar -czf "${ARCHIVE_FILE}" -C "$(dirname "${EVIDENCE_DIR}")" "$(basename "${EVIDENCE_DIR}")"
archive_rc=$?
set -e

if [[ "${archive_rc}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' \
    "${EXIT_ARCHIVE_FAILURE}" "archive generation failed" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_ARCHIVE_FAILURE}"
fi

if [[ "${OVERALL_FAILURE}" -eq 0 ]]; then
  printf 'RESULT=PASS CODE=0 EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_OK}"
fi

printf 'RESULT=FAIL CODE=%s MESSAGE=%s EVIDENCE_DIR=%s EVIDENCE_BUNDLE=%s\n' \
  "${EXIT_CAPTURE_FAILURE}" "one or more capture steps failed" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}"
exit "${EXIT_CAPTURE_FAILURE}"
