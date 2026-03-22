#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_CAPTURE_FAILURE=11
EXIT_ARCHIVE_FAILURE=12

DRY_RUN=0
VERBOSE=0
RETENTION_DAYS=""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
ENV_FILE="${ENV_FILE:-${COMPOSE_ENV_FILE:-${ROOT_DIR}/deploy/compose/.env}}"
OUTPUT_ROOT="${ROOT_DIR}/deploy/compose/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR=""
ARCHIVE_FILE=""
COMMAND_LOG=""
STEP_RESULTS_FILE=""
OVERALL_FAILURE=0

POSTGRES_USER_DEFAULT="fiber"
POSTGRES_DB_DEFAULT="fiber_link"
WORKER_CURSOR_FILE_DEFAULT="/var/lib/fiber-link/settlement-cursor.json"

usage() {
  printf '%s\n' \
    "Usage: scripts/capture-compose-backup.sh [options]" \
    "" \
    "Options:" \
    "  --output-root <path>    Output root directory (default: deploy/compose/backups)." \
    "  --retention-days <n>    Retention policy in days (default: BACKUP_RETENTION_DAYS from .env or 30)." \
    "  --dry-run               Generate the bundle structure and command plan without docker side effects." \
    "  --verbose               Print progress logs." \
    "  -h, --help              Show this help message." \
    "" \
    "Exit codes:" \
    "  0   PASS" \
    "  2   invalid usage" \
    "  10  precheck failure" \
    "  11  one or more capture steps failed" \
    "  12  archive generation failure"
}

log() {
  printf '[compose-backup] %s\n' "$*"
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

run_capture_step() {
  local name="$1"
  local output_file="$2"
  local command="$3"
  local dry_run_content="$4"

  mkdir -p "$(dirname "${output_file}")"
  printf '[%s] %s\n' "${name}" "${command}" >> "${COMMAND_LOG}"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '%s\n' "${dry_run_content}" > "${output_file}"
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

bool_status() {
  if [[ "$1" -eq 0 ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${RETENTION_DAYS}" ]]; then
  RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
fi

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  log "--retention-days must be a non-negative integer"
  exit "${EXIT_USAGE}"
fi

POSTGRES_USER="${POSTGRES_USER:-${POSTGRES_USER_DEFAULT}}"
POSTGRES_DB="${POSTGRES_DB:-${POSTGRES_DB_DEFAULT}}"
WORKER_CURSOR_FILE="${WORKER_SETTLEMENT_CURSOR_FILE:-${WORKER_CURSOR_FILE_DEFAULT}}"

BACKUP_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${BACKUP_DIR}.tar.gz"
COMMAND_LOG="${BACKUP_DIR}/commands/command-index.log"
STEP_RESULTS_FILE="${BACKUP_DIR}/status/step-results.tsv"

for binary in bash docker git tar awk jq; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    log "missing required binary: ${binary}"
    exit "${EXIT_PRECHECK}"
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  log "docker compose v2 is required"
  exit "${EXIT_PRECHECK}"
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  log "missing compose file: ${COMPOSE_FILE}"
  exit "${EXIT_PRECHECK}"
fi

mkdir -p \
  "${BACKUP_DIR}/commands" \
  "${BACKUP_DIR}/db" \
  "${BACKUP_DIR}/runtime" \
  "${BACKUP_DIR}/snapshots" \
  "${BACKUP_DIR}/metadata" \
  "${BACKUP_DIR}/status"

printf 'step\tstatus\toutput_file\tcommand\n' > "${STEP_RESULTS_FILE}"
printf '# compose backup command log\n' > "${COMMAND_LOG}"

vlog "capturing compose backup into ${BACKUP_DIR}"

run_capture_step "git-head" \
  "${BACKUP_DIR}/snapshots/git-head.txt" \
  "cd \"${ROOT_DIR}\" && git rev-parse HEAD" \
  "DRY_RUN"

run_capture_step "compose-config" \
  "${BACKUP_DIR}/snapshots/compose-config.txt" \
  "cd \"${ROOT_DIR}\" && docker compose --env-file \"${ENV_FILE}\" -f \"${COMPOSE_FILE}\" config" \
  "DRY_RUN compose config"

run_capture_step "compose-ps" \
  "${BACKUP_DIR}/snapshots/compose-ps.txt" \
  "cd \"${ROOT_DIR}\" && docker compose --env-file \"${ENV_FILE}\" -f \"${COMPOSE_FILE}\" ps" \
  "DRY_RUN compose ps"

run_capture_step "postgres-inspect" \
  "${BACKUP_DIR}/runtime/postgres-container-inspect.json" \
  "docker inspect fiber-link-postgres" \
  "{}"

run_capture_step "worker-inspect" \
  "${BACKUP_DIR}/runtime/worker-container-inspect.json" \
  "docker inspect fiber-link-worker" \
  "{}"

run_capture_step "postgres-dump" \
  "${BACKUP_DIR}/db/postgres.sql" \
  "docker exec fiber-link-postgres pg_dump --clean --if-exists --create --format=plain --no-owner --no-privileges -U \"${POSTGRES_USER}\" -d \"${POSTGRES_DB}\"" \
  "-- DRY_RUN postgres dump placeholder"

run_capture_step "worker-cursor" \
  "${BACKUP_DIR}/runtime/worker-settlement-cursor.json" \
  "docker exec fiber-link-worker sh -lc 'if [ -f \"${WORKER_CURSOR_FILE}\" ]; then cat \"${WORKER_CURSOR_FILE}\"; else printf \"UNSET\\n\"; fi'" \
  "UNSET"

overall_status="$(bool_status "${OVERALL_FAILURE}")"

{
  printf '%s\n' "# Retention Policy"
  printf '\n'
  printf '%s\n' "- Recommended minimum local retention: ${RETENTION_DAYS} days."
  printf '%s\n' "- Keep the full backup directory immutable during the retention window."
  printf '%s\n' "- Rehearse restore from this bundle before treating it as a release gate artifact."
  printf '%s\n' "- Suggested cleanup command after retention: \`find \"$(dirname "${BACKUP_DIR}")\" -mindepth 1 -maxdepth 1 \\( -type d -o -name '*.tar.gz' \\) -mtime +${RETENTION_DAYS} -exec rm -rf {} +\`"
} > "${BACKUP_DIR}/metadata/retention-policy.md"

jq -n \
  --arg generatedAtUtc "${TIMESTAMP}" \
  --arg overallStatus "${overall_status}" \
  --arg postgresUser "${POSTGRES_USER}" \
  --arg postgresDb "${POSTGRES_DB}" \
  --arg workerCursorFile "${WORKER_CURSOR_FILE}" \
  --argjson retentionDays "${RETENTION_DAYS}" \
  --argjson dryRun "$([[ "${DRY_RUN}" -eq 1 ]] && printf 'true' || printf 'false')" \
  '{
    generatedAtUtc: $generatedAtUtc,
    retentionDays: $retentionDays,
    dryRun: $dryRun,
    overallStatus: $overallStatus,
    postgresUser: $postgresUser,
    postgresDb: $postgresDb,
    workerCursorFile: $workerCursorFile,
    files: {
      commandLog: "commands/command-index.log",
      stepResults: "status/step-results.tsv",
      postgresDump: "db/postgres.sql",
      workerCursor: "runtime/worker-settlement-cursor.json",
      composeConfig: "snapshots/compose-config.txt",
      composePs: "snapshots/compose-ps.txt",
      postgresInspect: "runtime/postgres-container-inspect.json",
      workerInspect: "runtime/worker-container-inspect.json"
    }
  }' > "${BACKUP_DIR}/metadata/manifest.json"

set +e
tar -czf "${ARCHIVE_FILE}" -C "$(dirname "${BACKUP_DIR}")" "$(basename "${BACKUP_DIR}")"
archive_rc=$?
set -e

if [[ "${archive_rc}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s BACKUP_DIR=%s BACKUP_ARCHIVE=%s\n' \
    "${EXIT_ARCHIVE_FAILURE}" "archive generation failed" "${BACKUP_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_ARCHIVE_FAILURE}"
fi

if [[ "${OVERALL_FAILURE}" -eq 0 ]]; then
  printf 'RESULT=PASS CODE=0 BACKUP_DIR=%s BACKUP_ARCHIVE=%s\n' "${BACKUP_DIR}" "${ARCHIVE_FILE}"
  exit "${EXIT_OK}"
fi

printf 'RESULT=FAIL CODE=%s MESSAGE=%s BACKUP_DIR=%s BACKUP_ARCHIVE=%s\n' \
  "${EXIT_CAPTURE_FAILURE}" "one or more capture steps failed" "${BACKUP_DIR}" "${ARCHIVE_FILE}"
exit "${EXIT_CAPTURE_FAILURE}"
