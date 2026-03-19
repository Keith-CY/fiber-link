#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${VISUAL_ACCEPTANCE_ARTIFACT_ROOT:-/artifacts}"
REPO_ROOT="${VISUAL_ACCEPTANCE_REPO_ROOT:-/workspace}"
OUTPUT_ROOT="${VISUAL_ACCEPTANCE_OUTPUT_ROOT:-${ARTIFACT_ROOT}/evidence}"
MANIFEST_PATH="${VISUAL_ACCEPTANCE_MANIFEST_PATH:-${ARTIFACT_ROOT}/manifest.json}"
LOG_PATH="${VISUAL_ACCEPTANCE_HARNESS_LOG_PATH:-${ARTIFACT_ROOT}/harness.log}"
EXPLORER_TEMPLATE="${VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE:-https://pudge.explorer.nervos.org/transaction/{txHash}}"
SETTLEMENT_MODES="${VISUAL_ACCEPTANCE_SETTLEMENT_MODES:-subscription,polling}"

mkdir -p "${ARTIFACT_ROOT}" "${OUTPUT_ROOT}"

{
  echo "[visual-acceptance] using host docker daemon via mounted socket"
  test -S /var/run/docker.sock
  docker info >/dev/null 2>&1
  docker buildx version >/dev/null 2>&1

  echo "[visual-acceptance] running four-flow evidence capture"
  cd "${REPO_ROOT}"
  set +e
  capture_output="$(
    E2E_EXPLORER_TX_URL_TEMPLATE="${EXPLORER_TEMPLATE}" \
    scripts/capture-e2e-discourse-four-flows-evidence.sh \
      --output-root "${OUTPUT_ROOT}" \
      --explorer-tx-url-template "${EXPLORER_TEMPLATE}" \
      --settlement-modes "${SETTLEMENT_MODES}" \
      --headless
  )"
  capture_rc=$?
  set -e
  echo "${capture_output}"

  result_line="$(printf '%s\n' "${capture_output}" | awk '/^RESULT=/{line=$0} END{print line}')"
  evidence_dir="$(printf '%s' "${result_line}" | awk '{for (i=1; i<=NF; i++) if ($i ~ /^EVIDENCE_DIR=/) {sub(/^EVIDENCE_DIR=/, "", $i); print $i}}')"
  archive_file="$(printf '%s' "${result_line}" | awk '{for (i=1; i<=NF; i++) if ($i ~ /^ARCHIVE=/) {sub(/^ARCHIVE=/, "", $i); print $i}}')"
  if [[ -z "${evidence_dir}" ]]; then
    evidence_dir="$(
      find "${OUTPUT_ROOT}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
        | sort \
        | tail -n1
    )"
  fi
  if [[ -n "${evidence_dir}" && -z "${archive_file}" && -f "${evidence_dir}.tar.gz" ]]; then
    archive_file="${evidence_dir}.tar.gz"
  fi

  relative_evidence_dir=""
  if [[ -n "${evidence_dir}" ]]; then
    relative_evidence_dir="${evidence_dir#"${ARTIFACT_ROOT}/"}"
  fi

  relative_archive_file=""
  if [[ -n "${archive_file}" ]]; then
    relative_archive_file="${archive_file#"${ARTIFACT_ROOT}/"}"
  fi

  summary_file=""
  screenshots_dir=""
  if [[ -n "${relative_evidence_dir}" ]]; then
    if [[ -f "${evidence_dir}/summary.json" ]]; then
      summary_file="${relative_evidence_dir}/summary.json"
    elif [[ -f "${evidence_dir}/artifacts/summary.json" ]]; then
      summary_file="${relative_evidence_dir}/artifacts/summary.json"
    fi
    if [[ -d "${evidence_dir}/screenshots" ]]; then
      screenshots_dir="${relative_evidence_dir}/screenshots"
    elif [[ -d "${evidence_dir}/artifacts/screenshots" ]]; then
      screenshots_dir="${relative_evidence_dir}/artifacts/screenshots"
    fi
  fi

  jq -n \
    --arg status "$([[ "${capture_rc}" -eq 0 ]] && printf 'PASS' || printf 'FAIL')" \
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

  exit "${capture_rc}"
} 2>&1 | tee "${LOG_PATH}"
