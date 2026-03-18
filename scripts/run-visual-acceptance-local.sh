#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_BIN="${VISUAL_ACCEPTANCE_DOCKER_BIN:-docker}"
IMAGE_TAG="${VISUAL_ACCEPTANCE_IMAGE_TAG:-fiber-link-visual-acceptance}"
OUTPUT_DIR="${VISUAL_ACCEPTANCE_OUTPUT_DIR:-}"
SETTLEMENT_MODES="${VISUAL_ACCEPTANCE_SETTLEMENT_MODES:-subscription,polling}"
EXPLORER_TEMPLATE="${VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE:-https://pudge.explorer.nervos.org/transaction/{txHash}}"
SKIP_BUILD=0

usage() {
  cat <<'USAGE'
Usage: scripts/run-visual-acceptance-local.sh [options]

Build and run the visual-acceptance DinD harness locally.

Options:
  --output-dir <path>              Host output dir. Default: mktemp under ${TMPDIR:-/tmp}.
  --settlement-modes <modes>       Comma-separated: subscription,polling | subscription | polling.
  --explorer-tx-url-template <tpl> Explorer URL template containing {txHash} or %s.
  --image-tag <name>               Docker image tag. Default: fiber-link-visual-acceptance.
  --skip-build                     Reuse an existing image tag without rebuilding.
  -h, --help                       Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      OUTPUT_DIR="$2"
      shift
      ;;
    --settlement-modes)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      SETTLEMENT_MODES="$2"
      shift
      ;;
    --explorer-tx-url-template)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      EXPLORER_TEMPLATE="$2"
      shift
      ;;
    --image-tag)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      IMAGE_TAG="$2"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

mkdir -p "${ROOT_DIR}/.tmp"
if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fiber-link-visual-acceptance.XXXXXX")"
else
  mkdir -p "${OUTPUT_DIR}"
fi

print_paths() {
  local manifest_path="${OUTPUT_DIR}/manifest.json"
  printf 'Temp output: %s\n' "${OUTPUT_DIR}"
  if [[ -f "${manifest_path}" ]]; then
    local summary_rel screenshots_rel archive_rel
    summary_rel="$(jq -r '.summaryFile // empty' "${manifest_path}")"
    screenshots_rel="$(jq -r '.screenshotsDir // empty' "${manifest_path}")"
    archive_rel="$(jq -r '.archiveFile // empty' "${manifest_path}")"

    printf 'Manifest: %s\n' "${manifest_path}"
    [[ -n "${summary_rel}" ]] && printf 'Summary: %s\n' "${OUTPUT_DIR}/${summary_rel}"
    [[ -n "${screenshots_rel}" ]] && printf 'Screenshots: %s\n' "${OUTPUT_DIR}/${screenshots_rel}"
    [[ -n "${archive_rel}" ]] && printf 'Archive: %s\n' "${OUTPUT_DIR}/${archive_rel}"
  else
    printf 'Manifest: %s\n' "${manifest_path}"
  fi

  [[ -f "${OUTPUT_DIR}/harness.log" ]] && printf 'Harness log: %s\n' "${OUTPUT_DIR}/harness.log"
  [[ -f "${OUTPUT_DIR}/dockerd.log" ]] && printf 'Dockerd log: %s\n' "${OUTPUT_DIR}/dockerd.log"

  if command -v open >/dev/null 2>&1; then
    printf 'Open dir: open %q\n' "${OUTPUT_DIR}"
  elif command -v xdg-open >/dev/null 2>&1; then
    printf 'Open dir: xdg-open %q\n' "${OUTPUT_DIR}"
  fi
}

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  "${DOCKER_BIN}" build -t "${IMAGE_TAG}" -f "${ROOT_DIR}/harness/visual-acceptance/Dockerfile" "${ROOT_DIR}"
fi

set +e
"${DOCKER_BIN}" run --rm --privileged \
  -v "${ROOT_DIR}:/workspace" \
  -v "${OUTPUT_DIR}:/artifacts" \
  -e VISUAL_ACCEPTANCE_REPO_ROOT=/workspace \
  -e VISUAL_ACCEPTANCE_ARTIFACT_ROOT=/artifacts \
  -e VISUAL_ACCEPTANCE_SETTLEMENT_MODES="${SETTLEMENT_MODES}" \
  -e VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE="${EXPLORER_TEMPLATE}" \
  "${IMAGE_TAG}"
run_rc=$?
set -e

print_paths
exit "${run_rc}"
