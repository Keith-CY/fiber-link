#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_RESTORE_FAILURE=11

BACKUP_SOURCE=""
DRY_RUN=0
VERBOSE=0
YES=0

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
TEMP_DIR=""
BACKUP_DIR=""
RESTORE_DIR=""
COMMAND_LOG=""
STEP_RESULTS_FILE=""
OVERALL_FAILURE=0

POSTGRES_USER_DEFAULT="fiber"
POSTGRES_DB_DEFAULT="fiber_link"
WORKER_CURSOR_FILE_DEFAULT="/var/lib/fiber-link/settlement-cursor.json"

usage() {
  printf '%s\n' \
    "Usage: scripts/restore-compose-backup.sh --backup <path> [options]" \
    "" \
    "Options:" \
    "  --backup <path>         Backup directory or .tar.gz archive created by capture-compose-backup.sh." \
    "  --dry-run               Generate the restore command plan without docker side effects." \
    "  --yes                   Confirm destructive restore execution." \
    "  --verbose               Print progress logs." \
    "  -h, --help              Show this help message." \
    "" \
    "Exit codes:" \
    "  0   PASS" \
    "  2   invalid usage" \
    "  10  precheck failure" \
    "  11  restore step failed"
}

log() {
  printf '[compose-restore] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}

trap cleanup EXIT

write_step_result() {
  local name="$1"
  local status="$2"
  local output_file="$3"
  local command="$4"
  printf '%s\t%s\t%s\t%s\n' "${name}" "${status}" "${output_file}" "${command}" >> "${STEP_RESULTS_FILE}"
}

run_restore_step() {
  local name="$1"
  local command="$2"
  local output_file="${RESTORE_DIR}/${name}.log"

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      BACKUP_SOURCE="$2"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --yes)
      YES=1
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

[[ -n "${BACKUP_SOURCE}" ]] || { usage >&2; exit "${EXIT_USAGE}"; }

if [[ "${DRY_RUN}" -eq 0 && "${YES}" -ne 1 ]]; then
  log "restore is destructive; rerun with --yes after verifying the backup source"
  exit "${EXIT_USAGE}"
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-${POSTGRES_USER_DEFAULT}}"
POSTGRES_DB="${POSTGRES_DB:-${POSTGRES_DB_DEFAULT}}"
WORKER_CURSOR_FILE="${WORKER_SETTLEMENT_CURSOR_FILE:-${WORKER_CURSOR_FILE_DEFAULT}}"

for binary in bash docker tar awk jq mktemp; do
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

if [[ -d "${BACKUP_SOURCE}" ]]; then
  BACKUP_DIR="${BACKUP_SOURCE}"
elif [[ -f "${BACKUP_SOURCE}" ]]; then
  TEMP_DIR="$(mktemp -d)"
  tar -xzf "${BACKUP_SOURCE}" -C "${TEMP_DIR}"
  extracted_root="$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [[ -n "${extracted_root}" ]] || {
    log "backup archive did not contain an extracted directory"
    exit "${EXIT_PRECHECK}"
  }
  BACKUP_DIR="${extracted_root}"
else
  log "backup source not found: ${BACKUP_SOURCE}"
  exit "${EXIT_PRECHECK}"
fi

for required in \
  "${BACKUP_DIR}/db/postgres.sql" \
  "${BACKUP_DIR}/runtime/worker-settlement-cursor.json" \
  "${BACKUP_DIR}/metadata/manifest.json"; do
  if [[ ! -f "${required}" ]]; then
    log "backup bundle missing required file: ${required}"
    exit "${EXIT_PRECHECK}"
  fi
done

RESTORE_DIR="${BACKUP_DIR}/restore"
COMMAND_LOG="${RESTORE_DIR}/command-index.log"
STEP_RESULTS_FILE="${RESTORE_DIR}/step-results.tsv"
mkdir -p "${RESTORE_DIR}"

printf 'step\tstatus\toutput_file\tcommand\n' > "${STEP_RESULTS_FILE}"
printf '# compose restore command log\n' > "${COMMAND_LOG}"

vlog "restoring compose backup from ${BACKUP_DIR}"

run_restore_step "compose-up-postgres" \
  "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" up -d postgres"

run_restore_step "compose-stop-apps" \
  "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" stop rpc worker || true"

run_restore_step "postgres-terminate-clients" \
  "docker exec fiber-link-postgres psql -v ON_ERROR_STOP=1 -U \"${POSTGRES_USER}\" -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();\""

run_restore_step "postgres-restore" \
  "cat \"${BACKUP_DIR}/db/postgres.sql\" | docker exec -i fiber-link-postgres psql -v ON_ERROR_STOP=1 -U \"${POSTGRES_USER}\" -d postgres"

if [[ "$(cat "${BACKUP_DIR}/runtime/worker-settlement-cursor.json")" == "UNSET" ]]; then
  run_restore_step "worker-cursor-restore" \
    "printf 'SKIPPED: worker cursor backup was UNSET\n'"
else
  run_restore_step "worker-cursor-restore" \
    "docker cp \"${BACKUP_DIR}/runtime/worker-settlement-cursor.json\" \"fiber-link-worker:${WORKER_CURSOR_FILE}\""
fi

run_restore_step "compose-up-apps" \
  "cd \"${ROOT_DIR}\" && docker compose -f \"${COMPOSE_FILE}\" up -d rpc worker"

if [[ "${OVERALL_FAILURE}" -eq 0 ]]; then
  mode="LIVE"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    mode="DRY_RUN"
  fi
  printf 'RESULT=PASS CODE=0 BACKUP_SOURCE=%s RESTORE_MODE=%s\n' "${BACKUP_DIR}" "${mode}"
  exit "${EXIT_OK}"
fi

printf 'RESULT=FAIL CODE=%s BACKUP_SOURCE=%s RESTORE_MODE=LIVE\n' "${EXIT_RESTORE_FAILURE}" "${BACKUP_DIR}"
exit "${EXIT_RESTORE_FAILURE}"
