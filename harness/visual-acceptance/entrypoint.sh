#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${VISUAL_ACCEPTANCE_ARTIFACT_ROOT:-/artifacts}"
REPO_ROOT="${VISUAL_ACCEPTANCE_REPO_ROOT:-/workspace}"
OUTPUT_ROOT="${VISUAL_ACCEPTANCE_OUTPUT_ROOT:-${ARTIFACT_ROOT}/evidence}"
MANIFEST_PATH="${VISUAL_ACCEPTANCE_MANIFEST_PATH:-${ARTIFACT_ROOT}/manifest.json}"
LOG_PATH="${VISUAL_ACCEPTANCE_HARNESS_LOG_PATH:-${ARTIFACT_ROOT}/harness.log}"
DOCKERD_LOG_PATH="${VISUAL_ACCEPTANCE_DOCKERD_LOG_PATH:-${ARTIFACT_ROOT}/dockerd.log}"
EXPLORER_TEMPLATE="${VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE:-https://pudge.explorer.nervos.org/transaction/{txHash}}"
SETTLEMENT_MODES="${VISUAL_ACCEPTANCE_SETTLEMENT_MODES:-subscription,polling}"

mkdir -p "${ARTIFACT_ROOT}" "${OUTPUT_ROOT}"

cleanup() {
  if [[ -n "${dockerd_pid:-}" ]] && kill -0 "${dockerd_pid}" >/dev/null 2>&1; then
    kill "${dockerd_pid}" >/dev/null 2>&1 || true
    wait "${dockerd_pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

{
  echo "[visual-acceptance] starting dockerd"
  dockerd --host=unix:///var/run/docker.sock --storage-driver=vfs >"${DOCKERD_LOG_PATH}" 2>&1 &
  dockerd_pid=$!

  for _ in $(seq 1 120); do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  docker info >/dev/null 2>&1

  echo "[visual-acceptance] running four-flow evidence capture"
  cd "${REPO_ROOT}"
  capture_output="$(
    E2E_EXPLORER_TX_URL_TEMPLATE="${EXPLORER_TEMPLATE}" \
    scripts/capture-e2e-discourse-four-flows-evidence.sh \
      --output-root "${OUTPUT_ROOT}" \
      --explorer-tx-url-template "${EXPLORER_TEMPLATE}" \
      --settlement-modes "${SETTLEMENT_MODES}" \
      --headless
  )"
  echo "${capture_output}"

  result_line="$(printf '%s\n' "${capture_output}" | awk '/^RESULT=/{line=$0} END{print line}')"
  evidence_dir="$(printf '%s' "${result_line}" | awk '{for (i=1; i<=NF; i++) if ($i ~ /^EVIDENCE_DIR=/) {sub(/^EVIDENCE_DIR=/, "", $i); print $i}}')"
  archive_file="$(printf '%s' "${result_line}" | awk '{for (i=1; i<=NF; i++) if ($i ~ /^ARCHIVE=/) {sub(/^ARCHIVE=/, "", $i); print $i}}')"
  relative_evidence_dir="${evidence_dir#"${ARTIFACT_ROOT}/"}"
  relative_archive_file="${archive_file#"${ARTIFACT_ROOT}/"}"
  summary_file="${relative_evidence_dir}/summary.json"
  screenshots_dir="${relative_evidence_dir}/screenshots"

  jq -n \
    --arg status "PASS" \
    --arg evidenceDir "${relative_evidence_dir}" \
    --arg summaryFile "${summary_file}" \
    --arg screenshotsDir "${screenshots_dir}" \
    --arg archiveFile "${relative_archive_file}" \
    '{
      status: $status,
      evidenceDir: $evidenceDir,
      summaryFile: $summaryFile,
      screenshotsDir: $screenshotsDir,
      archiveFile: $archiveFile
    }' > "${MANIFEST_PATH}"
} 2>&1 | tee "${LOG_PATH}"
