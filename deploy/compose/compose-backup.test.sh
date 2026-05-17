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
  grep -Fq -- "${needle}" "${file}" || fail "expected ${file} to contain '${needle}'"
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

if [[ "${1:-}" == "run" ]]; then
  backup_mount=""
  for arg in "$@"; do
    case "${arg}" in
      *:/backup)
        backup_mount="${arg%%:/backup}"
        ;;
    esac
  done
  if [[ -n "${backup_mount}" ]]; then
    printf 'tarball-bytes-from-fake-docker\n' > "${backup_mount}/data.tar.gz"
    printf 'fake docker command log on stdout\n'
  fi
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
  [[ -f "${backup_dir}/metadata/checksums.sha256" ]] || fail "missing backup checksums in dry-run backup"
  [[ -f "${backup_dir}/metadata/retention-policy.md" ]] || fail "missing backup retention policy in dry-run backup"
  [[ -f "${backup_dir}/status/step-results.tsv" ]] || fail "missing step-results.tsv in dry-run backup"
  [[ -f "${backup_dir}/fnn/README.txt" ]] || fail "missing fnn state opt-in marker in dry-run backup"
  [[ -f "${backup_dir}/fnn2/README.txt" ]] || fail "missing fnn2 state opt-in marker in dry-run backup"

  assert_file_contains "${backup_dir}/commands/command-index.log" "pg_dump"
  assert_file_contains "${backup_dir}/metadata/retention-policy.md" "45 days"
  assert_file_contains "${backup_dir}/status/step-results.tsv" "DRY_RUN"
  assert_file_contains "${backup_dir}/status/step-results.tsv" $'fnn-state\tSKIPPED'
  assert_file_contains "${backup_dir}/metadata/manifest.json" '"schemaVersion": 1'
  assert_file_contains "${backup_dir}/metadata/manifest.json" '"includeFnnState": false'
  (cd "${backup_dir}" && sha256sum -c metadata/checksums.sha256 >/dev/null) || fail "checksum validation failed for dry-run backup"

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

  set +e
  output="$(
    PATH="${fake_bin}:${PATH}" \
      "${RESTORE_SCRIPT}" \
      --backup "${backup_dir}" \
      --yes 2>&1
  )"
  local rc=$?
  set -e
  [[ "${rc}" -eq 10 ]] || fail "expected live restore from dry-run bundle to fail precheck, got ${rc}: ${output}"
  assert_contains "${output}" "refusing live restore from a dry-run backup bundle"
}

run_backup_dry_run_with_fnn_state() {
  local fake_bin="${TMP_DIR}/fake-bin-fnn-state"
  local output_root="${TMP_DIR}/backup-output-fnn-state"
  local output
  local backup_dir

  export FAKE_DOCKER_LOG="${TMP_DIR}/fake-docker-fnn-state.log"
  make_fake_docker "${fake_bin}"

  output="$(
    PATH="${fake_bin}:${PATH}" \
      "${BACKUP_SCRIPT}" \
      --dry-run \
      --include-fnn-state \
      --output-root "${output_root}"
  )"

  assert_contains "${output}" "RESULT=PASS CODE=0"
  backup_dir="$(printf '%s\n' "${output}" | sed -n 's/.*BACKUP_DIR=\([^ ]*\).*/\1/p')"
  [[ -n "${backup_dir}" ]] || fail "failed to parse BACKUP_DIR from fnn-state output"
  [[ -f "${backup_dir}/fnn/data.tar.gz" ]] || fail "missing fnn state tarball placeholder"
  [[ -f "${backup_dir}/fnn2/data.tar.gz" ]] || fail "missing fnn2 state tarball placeholder"
  assert_file_contains "${backup_dir}/metadata/manifest.json" '"includeFnnState": true'
  assert_file_contains "${backup_dir}/commands/command-index.log" "--volumes-from fiber-link-fnn"
  assert_file_contains "${backup_dir}/commands/command-index.log" "--volumes-from fiber-link-fnn2"
  (cd "${backup_dir}" && sha256sum -c metadata/checksums.sha256 >/dev/null) || fail "checksum validation failed for fnn-state backup"
}

run_backup_dry_run_with_env_override() {
  local fake_bin="${TMP_DIR}/fake-bin-env-override"
  local output_root="${TMP_DIR}/backup-output-env-override"
  local custom_env_file="${TMP_DIR}/runtime-compose.env"
  local output
  local backup_dir

  cat > "${custom_env_file}" <<'EOF_ENV'
POSTGRES_USER=fiber
POSTGRES_DB=fiber_link
POSTGRES_PASSWORD=test-password
BACKUP_RETENTION_DAYS=12
EOF_ENV

  export FAKE_DOCKER_LOG="${TMP_DIR}/fake-docker-env-override.log"
  make_fake_docker "${fake_bin}"

  output="$(
    PATH="${fake_bin}:${PATH}" \
    ENV_FILE="${custom_env_file}" \
    "${BACKUP_SCRIPT}" \
    --dry-run \
    --output-root "${output_root}"
  )"

  assert_contains "${output}" "RESULT=PASS CODE=0"
  backup_dir="$(printf '%s\n' "${output}" | sed -n 's/.*BACKUP_DIR=\([^ ]*\).*/\1/p')"
  [[ -n "${backup_dir}" ]] || fail "failed to parse BACKUP_DIR from env override output"
  grep -Fq -- "--env-file \"${custom_env_file}\"" "${backup_dir}/commands/command-index.log" \
    || fail "expected ${backup_dir}/commands/command-index.log to contain '--env-file \"${custom_env_file}\"'"
}

run_backup_live_fnn_state_uses_separate_log() {
  local fake_bin="${TMP_DIR}/fake-bin-live-fnn-state"
  local output_root="${TMP_DIR}/backup-output-live-fnn-state"
  local output
  local backup_dir

  export FAKE_DOCKER_LOG="${TMP_DIR}/fake-docker-live-fnn-state.log"
  make_fake_docker "${fake_bin}"

  output="$(
    PATH="${fake_bin}:${PATH}" \
      "${BACKUP_SCRIPT}" \
      --include-fnn-state \
      --output-root "${output_root}"
  )"

  assert_contains "${output}" "RESULT=PASS CODE=0"
  backup_dir="$(printf '%s\n' "${output}" | sed -n 's/.*BACKUP_DIR=\([^ ]*\).*/\1/p')"
  [[ -n "${backup_dir}" ]] || fail "failed to parse BACKUP_DIR from live fnn-state output"
  assert_file_contains "${backup_dir}/fnn/data.tar.gz" "tarball-bytes-from-fake-docker"
  assert_file_contains "${backup_dir}/fnn/data.tar.gz.log" "fake docker command log on stdout"
  assert_file_contains "${backup_dir}/fnn2/data.tar.gz" "tarball-bytes-from-fake-docker"
  assert_file_contains "${backup_dir}/fnn2/data.tar.gz.log" "fake docker command log on stdout"
  (cd "${backup_dir}" && sha256sum -c metadata/checksums.sha256 >/dev/null) || fail "checksum validation failed for live fnn-state backup"
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
run_backup_dry_run_with_fnn_state
run_backup_dry_run_with_env_override
run_backup_live_fnn_state_uses_separate_log

printf 'compose-backup checks passed\n'
