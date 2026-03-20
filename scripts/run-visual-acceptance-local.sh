#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_BIN="${VISUAL_ACCEPTANCE_DOCKER_BIN:-docker}"
RUNNER_SCRIPT="${VISUAL_ACCEPTANCE_RUNNER_SCRIPT:-${ROOT_DIR}/harness/visual-acceptance/entrypoint.sh}"
PLAYWRIGHT_IMAGE="${VISUAL_ACCEPTANCE_IMAGE_TAG:-fiber-link-visual-acceptance}"
OUTPUT_DIR="${VISUAL_ACCEPTANCE_OUTPUT_DIR:-}"
SETTLEMENT_MODES="${VISUAL_ACCEPTANCE_SETTLEMENT_MODES:-subscription,polling}"
DEFAULT_EXPLORER_TEMPLATE='https://pudge.explorer.nervos.org/transaction/{txHash}'
EXPLORER_TEMPLATE="${VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE:-${DEFAULT_EXPLORER_TEMPLATE}}"
HOST_ACCESS_HOST="${VISUAL_ACCEPTANCE_HOST_ACCESS_HOST:-127.0.0.1}"
HOST_ACCESS_BASE_URL="${VISUAL_ACCEPTANCE_HOST_ACCESS_BASE_URL:-}"
SIDECAR_HOST_ACCESS_HOST="${VISUAL_ACCEPTANCE_SIDECAR_HOST_ACCESS_HOST:-host.docker.internal}"
PLAYWRIGHT_DOCKER_NETWORK_MODE="${VISUAL_ACCEPTANCE_PLAYWRIGHT_DOCKER_NETWORK_MODE:-}"
DISCOURSE_UI_BASE_URL="${VISUAL_ACCEPTANCE_DISCOURSE_UI_BASE_URL:-}"
COMPOSE_ENV_SOURCE="${VISUAL_ACCEPTANCE_COMPOSE_ENV_FILE:-}"
KEEP_RUNTIME="${VISUAL_ACCEPTANCE_KEEP_RUNTIME:-0}"
SKIP_BUILD=0
RUNTIME_DIR=""
HOST_GIT_SHA=""
HOST_GIT_BRANCH=""

cleanup() {
  if [[ "${KEEP_RUNTIME}" == "1" || -z "${RUNTIME_DIR}" || ! -d "${RUNTIME_DIR}" ]]; then
    return 0
  fi
  rm -rf "${RUNTIME_DIR}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

usage() {
  cat <<'USAGE'
Usage: scripts/run-visual-acceptance-local.sh [options]

Run the visual-acceptance workflow locally against the host Docker daemon.

Options:
  --output-dir <path>              Host output dir. Default: mktemp under ${TMPDIR:-/tmp}.
  --settlement-modes <modes>       Comma-separated: subscription,polling | subscription | polling.
  --explorer-tx-url-template <tpl> Explorer URL template containing {txHash} or %s.
  --image-tag <name>               Playwright sidecar image tag. Default: fiber-link-visual-acceptance.
  --skip-build                     Reuse an existing sidecar image tag without rebuilding.
  -h, --help                       Show help.

Environment:
  VISUAL_ACCEPTANCE_HOST_ACCESS_HOST        Hostname used by host-side verification/probes.
                                           Default: 127.0.0.1
  VISUAL_ACCEPTANCE_SIDECAR_HOST_ACCESS_HOST Hostname exposed inside the Playwright sidecar for
                                           reaching host-published Docker ports.
                                           Default: host.docker.internal
  VISUAL_ACCEPTANCE_DISCOURSE_UI_BASE_URL  UI base URL used by the four-flow browser steps.
                                           Default: http://host.docker.internal:4200
  VISUAL_ACCEPTANCE_KEEP_RUNTIME=1         Preserve the temp runtime dir for debugging.
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
      PLAYWRIGHT_IMAGE="$2"
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

RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fiber-link-visual-acceptance-runtime.XXXXXX")"
HOST_GIT_SHA="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
HOST_GIT_BRANCH="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
DISCOURSE_DEV_ROOT="${RUNTIME_DIR}/discourse-dev"
compose_env_args=(--output "${RUNTIME_DIR}/compose.env")
if [[ -n "${COMPOSE_ENV_SOURCE}" ]]; then
  compose_env_args+=(--source "${COMPOSE_ENV_SOURCE}")
fi
"${ROOT_DIR}/scripts/prepare-visual-acceptance-compose-env.sh" "${compose_env_args[@]}" >/dev/null

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
  if [[ "${KEEP_RUNTIME}" == "1" ]]; then
    printf 'Runtime dir: %s\n' "${RUNTIME_DIR}"
  fi

  if command -v open >/dev/null 2>&1; then
    printf 'Open dir: open %q\n' "${OUTPUT_DIR}"
  elif command -v xdg-open >/dev/null 2>&1; then
    printf 'Open dir: xdg-open %q\n' "${OUTPUT_DIR}"
  fi
}

if [[ -z "${HOST_ACCESS_BASE_URL}" ]]; then
  HOST_ACCESS_BASE_URL="http://${HOST_ACCESS_HOST}"
fi

if [[ "${PLAYWRIGHT_DOCKER_NETWORK_MODE}" == "host" ]]; then
  SIDECAR_HOST_ACCESS_HOST="${HOST_ACCESS_HOST}"
fi

if [[ -z "${DISCOURSE_UI_BASE_URL}" ]]; then
  DISCOURSE_UI_BASE_URL="http://${SIDECAR_HOST_ACCESS_HOST}:4200"
fi

DISCOURSE_BACKEND_READY_URL="${HOST_ACCESS_BASE_URL}:9292/session/csrf.json"
if [[ "${PLAYWRIGHT_DOCKER_NETWORK_MODE}" == "host" ]]; then
  DISCOURSE_BACKEND_READY_URL="${HOST_ACCESS_BASE_URL}:9292/session/csrf.json"
elif [[ -n "${PLAYWRIGHT_IMAGE}" ]]; then
  DISCOURSE_BACKEND_READY_URL="http://${SIDECAR_HOST_ACCESS_HOST}:9292/session/csrf.json"
fi

[[ -x "${RUNNER_SCRIPT}" ]] || {
  echo "Error: visual acceptance runner script is missing or not executable: ${RUNNER_SCRIPT}" >&2
  exit 2
}

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  "${DOCKER_BIN}" build -t "${PLAYWRIGHT_IMAGE}" -f "${ROOT_DIR}/harness/visual-acceptance/Dockerfile" "${ROOT_DIR}"
fi

set +e
VISUAL_ACCEPTANCE_REPO_ROOT="${ROOT_DIR}" \
VISUAL_ACCEPTANCE_ARTIFACT_ROOT="${OUTPUT_DIR}" \
VISUAL_ACCEPTANCE_OUTPUT_ROOT="${OUTPUT_DIR}/evidence" \
VISUAL_ACCEPTANCE_MANIFEST_PATH="${OUTPUT_DIR}/manifest.json" \
VISUAL_ACCEPTANCE_HARNESS_LOG_PATH="${OUTPUT_DIR}/harness.log" \
VISUAL_ACCEPTANCE_GIT_SHA="${HOST_GIT_SHA}" \
VISUAL_ACCEPTANCE_GIT_BRANCH="${HOST_GIT_BRANCH}" \
COMPOSE_ENV_FILE="${RUNTIME_DIR}/compose.env" \
ENV_FILE="${RUNTIME_DIR}/compose.env" \
DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT}" \
E2E_SOURCE_ARTIFACT_ROOT="${RUNTIME_DIR}/source-artifacts" \
E2E_HOST_ACCESS_HOST="${HOST_ACCESS_HOST}" \
E2E_HOST_ACCESS_BASE_URL="${HOST_ACCESS_BASE_URL}" \
E2E_DISCOURSE_UI_BASE_URL="${DISCOURSE_UI_BASE_URL}" \
PLAYWRIGHT_CLI_HOST_ACCESS_HOST="${SIDECAR_HOST_ACCESS_HOST}" \
PLAYWRIGHT_CLI_DOCKER_NETWORK_MODE="${PLAYWRIGHT_DOCKER_NETWORK_MODE}" \
PLAYWRIGHT_CLI_DOCKER_IMAGE="${PLAYWRIGHT_IMAGE}" \
PW_FLOW12_PAYER_RPC_BASE_URL="http://${SIDECAR_HOST_ACCESS_HOST}" \
PW_DEMO_PAYER_RPC_BASE_URL="http://${SIDECAR_HOST_ACCESS_HOST}" \
PW_FLOW12_BACKEND_READY_URL="${DISCOURSE_BACKEND_READY_URL}" \
PW_DEMO_BACKEND_READY_URL="${DISCOURSE_BACKEND_READY_URL}" \
PW_AUTHOR_WITHDRAWAL_BACKEND_READY_URL="${DISCOURSE_BACKEND_READY_URL}" \
VISUAL_ACCEPTANCE_SETTLEMENT_MODES="${SETTLEMENT_MODES}" \
VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE="${EXPLORER_TEMPLATE}" \
  "${RUNNER_SCRIPT}"
run_rc=$?
set -e

print_paths
exit "${run_rc}"
