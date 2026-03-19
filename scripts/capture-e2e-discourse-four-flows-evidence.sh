#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_RUN_FAILURE=11
EXIT_ARCHIVE_FAILURE=12

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORCHESTRATOR_SCRIPT="${E2E_FOUR_FLOWS_ORCHESTRATOR_SCRIPT:-${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_ROOT="${ROOT_DIR}/deploy/compose/evidence/e2e-discourse-four-flows"
EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"
RUN_E2E=1
VERBOSE=0

SOURCE_ARTIFACT_DIR=""
RUN_LOG=""
EXPLORER_TEMPLATE="${E2E_EXPLORER_TX_URL_TEMPLATE:-}"
HEADLESS=0
SKIP_SERVICES=0
SKIP_DISCOURSE=0
SETTLEMENT_MODES="${E2E_SETTLEMENT_MODES:-subscription}"
E2E_RC=0

usage() {
  cat <<'USAGE'
Usage: scripts/capture-e2e-discourse-four-flows-evidence.sh [options]

Options:
  --artifact-dir <path>             Reuse an existing e2e artifact directory.
  --skip-run                        Do not run e2e script; package existing --artifact-dir.
  --output-root <path>              Output root (default: deploy/compose/evidence/e2e-discourse-four-flows).
  --explorer-tx-url-template <tpl>  Required when running e2e and env is not set.
  --settlement-modes <modes>        Pass-through to e2e script.
  --headless                        Run e2e browser steps in headless mode.
  --skip-services                   Pass-through to e2e script.
  --skip-discourse                  Pass-through to e2e script.
  --verbose                         Print progress logs.
  -h, --help                        Show this help.
USAGE
}

log() {
  printf '[capture-e2e-four-flows] %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SOURCE_ARTIFACT_DIR="$2"
      shift
      ;;
    --skip-run)
      RUN_E2E=0
      ;;
    --output-root)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      OUTPUT_ROOT="$2"
      shift
      ;;
    --explorer-tx-url-template)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      EXPLORER_TEMPLATE="$2"
      shift
      ;;
    --settlement-modes)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      SETTLEMENT_MODES="$2"
      shift
      ;;
    --headless)
      HEADLESS=1
      ;;
    --skip-services)
      SKIP_SERVICES=1
      ;;
    --skip-discourse)
      SKIP_DISCOURSE=1
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

for cmd in jq tar git; do
  command -v "${cmd}" >/dev/null 2>&1 || {
    log "missing required command: ${cmd}"
    exit "${EXIT_PRECHECK}"
  }
done

mkdir -p "${OUTPUT_ROOT}"
EVIDENCE_DIR="${OUTPUT_ROOT}/${TIMESTAMP}"
ARCHIVE_FILE="${EVIDENCE_DIR}.tar.gz"
RUN_LOG="${EVIDENCE_DIR}/logs/e2e-run.log"

if [[ "${RUN_E2E}" -eq 1 ]]; then
  [[ -n "${EXPLORER_TEMPLATE}" ]] || {
    log "--explorer-tx-url-template (or E2E_EXPLORER_TX_URL_TEMPLATE) is required when running e2e"
    exit "${EXIT_USAGE}"
  }

  SOURCE_ARTIFACT_DIR="${ROOT_DIR}/.tmp/e2e-discourse-four-flows/${TIMESTAMP}"
  mkdir -p "${EVIDENCE_DIR}/logs"

  e2e_cmd=(
    env
    "E2E_EXPLORER_TX_URL_TEMPLATE=${EXPLORER_TEMPLATE}"
    "E2E_SETTLEMENT_MODES=${SETTLEMENT_MODES}"
    "${ORCHESTRATOR_SCRIPT}"
    --artifact-dir "${SOURCE_ARTIFACT_DIR}"
  )

  if [[ "${HEADLESS}" -eq 1 ]]; then
    e2e_cmd+=(--headless)
  fi
  if [[ "${SKIP_SERVICES}" -eq 1 ]]; then
    e2e_cmd+=(--skip-services)
  fi
  if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
    e2e_cmd+=(--skip-discourse)
  fi
  if [[ "${VERBOSE}" -eq 1 ]]; then
    e2e_cmd+=(--verbose)
  fi

  log "running e2e script..."
  set +e
  (cd "${ROOT_DIR}" && "${e2e_cmd[@]}") 2>&1 | tee "${RUN_LOG}"
  e2e_rc=${PIPESTATUS[0]}
  set -e
  E2E_RC="${e2e_rc}"

  if [[ "${e2e_rc}" -ne 0 ]]; then
    log "e2e script failed with exit code ${e2e_rc}"
    if [[ ! -d "${SOURCE_ARTIFACT_DIR}" ]]; then
      exit "${EXIT_RUN_FAILURE}"
    fi
  fi
fi

[[ -n "${SOURCE_ARTIFACT_DIR}" ]] || {
  log "--artifact-dir is required when --skip-run is used"
  exit "${EXIT_USAGE}"
}
[[ -d "${SOURCE_ARTIFACT_DIR}" ]] || {
  log "artifact directory does not exist: ${SOURCE_ARTIFACT_DIR}"
  exit "${EXIT_PRECHECK}"
}

mkdir -p "${EVIDENCE_DIR}/artifacts" "${EVIDENCE_DIR}/screenshots" "${EVIDENCE_DIR}/artifact-root" "${EVIDENCE_DIR}/logs" "${EVIDENCE_DIR}/metadata"
cp -R "${SOURCE_ARTIFACT_DIR}/." "${EVIDENCE_DIR}/artifact-root/"
if [[ -d "${SOURCE_ARTIFACT_DIR}/artifacts" ]]; then
  cp -R "${SOURCE_ARTIFACT_DIR}/artifacts/." "${EVIDENCE_DIR}/artifacts/"
else
  cp -R "${SOURCE_ARTIFACT_DIR}/." "${EVIDENCE_DIR}/artifacts/"
fi
if [[ -d "${SOURCE_ARTIFACT_DIR}/screenshots" ]]; then
  cp -R "${SOURCE_ARTIFACT_DIR}/screenshots/." "${EVIDENCE_DIR}/screenshots/"
elif [[ -d "${SOURCE_ARTIFACT_DIR}/artifacts/screenshots" ]]; then
  cp -R "${SOURCE_ARTIFACT_DIR}/artifacts/screenshots/." "${EVIDENCE_DIR}/screenshots/"
fi

summary_source="${SOURCE_ARTIFACT_DIR}/artifacts/summary.json"
if [[ -f "${summary_source}" ]]; then
  cp "${summary_source}" "${EVIDENCE_DIR}/summary.json"
  summary_file="${EVIDENCE_DIR}/summary.json"
elif [[ -f "${SOURCE_ARTIFACT_DIR}/summary.json" ]]; then
  cp "${SOURCE_ARTIFACT_DIR}/summary.json" "${EVIDENCE_DIR}/summary.json"
  summary_file="${EVIDENCE_DIR}/summary.json"
else
  summary_file="${EVIDENCE_DIR}/artifacts/summary.json"
fi

git_sha="${VISUAL_ACCEPTANCE_GIT_SHA:-$(cd "${ROOT_DIR}" && git rev-parse HEAD 2>/dev/null || printf 'unknown')}"
git_branch="${VISUAL_ACCEPTANCE_GIT_BRANCH:-$(cd "${ROOT_DIR}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')}"

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg rootDir "${ROOT_DIR}" \
  --arg sourceArtifactDir "${SOURCE_ARTIFACT_DIR}" \
  --arg gitSha "${git_sha}" \
  --arg gitBranch "${git_branch}" \
  --arg summaryFile "${summary_file}" \
  --argjson e2eExitCode "${E2E_RC}" \
  '{
    generatedAt: $generatedAt,
    rootDir: $rootDir,
    sourceArtifactDir: $sourceArtifactDir,
    git: {
      sha: $gitSha,
      branch: $gitBranch
    },
    summaryFile: $summaryFile,
    e2eExitCode: $e2eExitCode
  }' > "${EVIDENCE_DIR}/metadata/manifest.json"

set +e
tar -czf "${ARCHIVE_FILE}" -C "${OUTPUT_ROOT}" "${TIMESTAMP}"
archive_rc=$?
set -e
[[ "${archive_rc}" -eq 0 ]] || {
  log "failed to create archive: ${ARCHIVE_FILE}"
  exit "${EXIT_ARCHIVE_FAILURE}"
}

log "evidence dir: ${EVIDENCE_DIR}"
log "archive: ${ARCHIVE_FILE}"
if [[ "${E2E_RC}" -ne 0 ]]; then
  printf 'RESULT=FAIL CODE=%s EVIDENCE_DIR=%s ARCHIVE=%s SOURCE_ARTIFACT_DIR=%s\n' "${EXIT_RUN_FAILURE}" "${EVIDENCE_DIR}" "${ARCHIVE_FILE}" "${SOURCE_ARTIFACT_DIR}"
  exit "${EXIT_RUN_FAILURE}"
fi

printf 'RESULT=PASS CODE=0 EVIDENCE_DIR=%s ARCHIVE=%s SOURCE_ARTIFACT_DIR=%s\n' "${EVIDENCE_DIR}" "${ARCHIVE_FILE}" "${SOURCE_ARTIFACT_DIR}"
