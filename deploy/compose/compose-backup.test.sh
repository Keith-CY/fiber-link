#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_SCRIPT="${ROOT_DIR}/scripts/capture-compose-backup.sh"
RESTORE_SCRIPT="${ROOT_DIR}/scripts/restore-compose-backup.sh"
BACKUP_RUNBOOK_FILE="${ROOT_DIR}/docs/runbooks/compose-backup-recovery.md"
MAINNET_CHECKLIST_FILE="${ROOT_DIR}/docs/runbooks/mainnet-deployment-checklist.md"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env.example"
GITIGNORE_FILE="${ROOT_DIR}/.gitignore"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  printf '[compose-backup-test] FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "${haystack}" == *"${needle}"* ]] || fail "expected output to contain '${needle}'"
}

assert_file_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq "${needle}" "${file}" || fail "expected ${file} to contain '${needle}'"
}

make_fake_docker() {
  local fake_bin="$1"
  mkdir -p "${fake_bin}"
  cat > "${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '[fake-docker] %s\n' "$*" >> "${FAKE_DOCKER_LOG}"

if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
  printf 'Docker Compose version v2.0.0\n'
  exit 0
fi

exit 0
EOF
  chmod +x "${fake_bin}/docker"
}

run_help_checks() {
  local output

  output="$("${BACKUP_SCRIPT}" --help 2>&1 || true)"
  assert_contains "${output}" "Usage:"
  assert_contains "${output}" "capture-compose-backup.sh"

  output="$("${RESTORE_SCRIPT}" --help 2>&1 || true)"
  assert_contains "${output}" "Usage:"
  assert_contains "${output}" "restore-compose-backup.sh"
}

run_backup_dry_run() {
  local fake_bin="${TMP_DIR}/fake-bin"
  local output_root="${TMP_DIR}/backup-output"
  local output

  export FAKE_DOCKER_LOG="${TMP_DIR}/fake-docker.log"
  make_fake_docker "${fake_bin}"

  output="$(
    PATH="${fake_bin}:${PATH}" \
      "${BACKUP_SCRIPT}" \
      --dry-run \
      --retention-days 45 \
      --output-root "${output_root}"
  )"

  assert_contains "${output}" "RESULT=PASS CODE=0"
  assert_contains "${output}" "BACKUP_DIR=${output_root}/"
  assert_contains "${output}" "BACKUP_ARCHIVE=${output_root}/"

  local backup_dir
  backup_dir="$(printf '%s\n' "${output}" | sed -n 's/.*BACKUP_DIR=\([^ ]*\).*/\1/p')"
  [[ -n "${backup_dir}" ]] || fail "failed to parse BACKUP_DIR from output"

  [[ -f "${backup_dir}/db/postgres.sql" ]] || fail "missing postgres.sql in dry-run backup"
  [[ -f "${backup_dir}/runtime/worker-settlement-cursor.json" ]] || fail "missing worker cursor placeholder in dry-run backup"
  [[ -f "${backup_dir}/metadata/manifest.json" ]] || fail "missing backup manifest in dry-run backup"
  [[ -f "${backup_dir}/metadata/retention-policy.md" ]] || fail "missing backup retention policy in dry-run backup"
  [[ -f "${backup_dir}/status/step-results.tsv" ]] || fail "missing step-results.tsv in dry-run backup"

  assert_file_contains "${backup_dir}/commands/command-index.log" "pg_dump"
  assert_file_contains "${backup_dir}/metadata/retention-policy.md" "45 days"
  assert_file_contains "${backup_dir}/status/step-results.tsv" "DRY_RUN"

  printf '%s\n' "${backup_dir}" > "${TMP_DIR}/backup-dir.txt"
}

run_restore_dry_run() {
  local fake_bin="${TMP_DIR}/fake-bin"
  local backup_dir
  local output

  backup_dir="$(cat "${TMP_DIR}/backup-dir.txt")"

  output="$(
    PATH="${fake_bin}:${PATH}" \
      "${RESTORE_SCRIPT}" \
      --backup "${backup_dir}" \
      --dry-run \
      --yes
  )"

  assert_contains "${output}" "RESULT=PASS CODE=0"
  assert_contains "${output}" "BACKUP_SOURCE=${backup_dir}"
  assert_contains "${output}" "RESTORE_MODE=DRY_RUN"

  [[ -f "${backup_dir}/restore/command-index.log" ]] || fail "missing restore command log"
  [[ -f "${backup_dir}/restore/step-results.tsv" ]] || fail "missing restore step results"
  assert_file_contains "${backup_dir}/restore/command-index.log" "docker compose"
  assert_file_contains "${backup_dir}/restore/step-results.tsv" "DRY_RUN"
}

assert_repo_wiring() {
  [[ -f "${BACKUP_RUNBOOK_FILE}" ]] || fail "missing backup runbook"
  [[ -x "${BACKUP_SCRIPT}" ]] || fail "backup script is not executable"
  [[ -x "${RESTORE_SCRIPT}" ]] || fail "restore script is not executable"
  assert_file_contains "${ENV_FILE}" "BACKUP_RETENTION_DAYS="
  assert_file_contains "${GITIGNORE_FILE}" "deploy/compose/backups/"
  assert_file_contains "${MAINNET_CHECKLIST_FILE}" "capture-compose-backup.sh"
  assert_file_contains "${MAINNET_CHECKLIST_FILE}" "restore-compose-backup.sh"
  assert_file_contains "${BACKUP_RUNBOOK_FILE}" "capture-compose-backup.sh"
  assert_file_contains "${BACKUP_RUNBOOK_FILE}" "restore-compose-backup.sh"
}

run_help_checks
assert_repo_wiring
run_backup_dry_run
run_restore_dry_run

printf 'compose-backup checks passed\n'
