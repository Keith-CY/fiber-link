#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-${ROOT_DIR}/scripts/playwright-cli.sh}"
SESSION="${PW_DEMO_SESSION:-fiber-workflow-postcheck}"
ARTIFACT_DIR="${PW_DEMO_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/playwright-workflow-demo/postcheck}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-postcheck.run-code.js"
RUN_PLAYWRIGHT_SESSION_SCRIPT="${RUN_PLAYWRIGHT_SESSION_SCRIPT:-${ROOT_DIR}/scripts/run-playwright-session.sh}"

if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  latest_nvm_bin="$(ls -d "${HOME}"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
  if [[ -n "${latest_nvm_bin}" ]]; then
    PATH="${latest_nvm_bin}:${PATH}"
  fi
fi
if [[ -x "/opt/homebrew/bin/npx" ]]; then
  PATH="/opt/homebrew/bin:${PATH}"
fi
export PATH

[[ -x "${PWCLI}" ]] || {
  echo "[playwright-postcheck] missing playwright CLI wrapper: ${PWCLI}" >&2
  exit 2
}
[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "[playwright-postcheck] missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}
[[ -x "${RUN_PLAYWRIGHT_SESSION_SCRIPT}" ]] || {
  echo "[playwright-postcheck] missing playwright session runner: ${RUN_PLAYWRIGHT_SESSION_SCRIPT}" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}"
PW_TMPDIR="${PW_TMPDIR:-${ARTIFACT_DIR}/playwright-cli-tmp}"
mkdir -p "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

normalize_sidecar_url() {
  local raw_url="$1"
  local host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-${E2E_HOST_ACCESS_HOST:-host.docker.internal}}"
  if [[ -n "${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}" ]]; then
    if [[ "${raw_url}" == "http://${host_access_host}:"* ]]; then
      printf 'http://127.0.0.1:%s' "${raw_url#http://${host_access_host}:}"
      return 0
    fi
  fi
  printf '%s' "${raw_url}"
}

normalize_sidecar_probe_url() {
  local raw_url="$1"
  local host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-${E2E_HOST_ACCESS_HOST:-host.docker.internal}}"
  if [[ "${raw_url}" == "http://${host_access_host}:4200/"* ]]; then
    if [[ -n "${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}" ]]; then
      printf 'http://127.0.0.1:9292/%s' "${raw_url#http://${host_access_host}:4200/}"
    else
      printf 'http://%s:9292/%s' "${host_access_host}" "${raw_url#http://${host_access_host}:4200/}"
    fi
    return 0
  fi
  if [[ "${raw_url}" == "http://127.0.0.1:4200/"* ]]; then
    printf 'http://127.0.0.1:9292/%s' "${raw_url#http://127.0.0.1:4200/}"
    return 0
  fi
  printf '%s' "$(normalize_sidecar_url "${raw_url}")"
}

BASE_URL="${PW_DEMO_URL:-http://127.0.0.1:9292}"
BASE_URL="$(normalize_sidecar_url "${BASE_URL}")"
if [[ "${BASE_URL}" == */login ]]; then
  OPEN_URL="${BASE_URL}"
else
  OPEN_URL="${BASE_URL%/}/login"
fi

wait_for_backend_ready() {
  local probe_url="$1"
  local timeout_seconds="$2"
  local deadline host_access_host
  deadline=$(( $(date +%s) + timeout_seconds ))
  host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-${E2E_HOST_ACCESS_HOST:-host.docker.internal}}"

  while true; do
    if [[ -n "${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}" ]]; then
      local container_probe_url="${probe_url}"
      if [[ "${container_probe_url}" == "http://${host_access_host}:"* ]]; then
        container_probe_url="http://127.0.0.1:${container_probe_url#http://${host_access_host}:}"
      fi
      if docker exec "${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER}" sh -lc "curl -fsS -m 3 '${container_probe_url}' >/dev/null" >/dev/null 2>&1; then
        return 0
      fi
    elif [[ -n "${PLAYWRIGHT_CLI_DOCKER_IMAGE:-}" ]]; then
      if docker run --rm --add-host "${host_access_host}:host-gateway" --entrypoint bash "${PLAYWRIGHT_CLI_DOCKER_IMAGE}" -lc "curl -fsS -m 3 '${probe_url}' >/dev/null" >/dev/null 2>&1; then
        return 0
      fi
    elif curl -fsS -m 3 "${probe_url}" >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      return 1
    fi
    sleep 2
  done
}

BACKEND_READY_URL="${PW_DEMO_BACKEND_READY_URL:-${BASE_URL%/}/session/csrf.json}"
BACKEND_READY_URL="$(normalize_sidecar_probe_url "${BACKEND_READY_URL}")"
BACKEND_WAIT_SECONDS="${PW_DEMO_BACKEND_WAIT_SECONDS:-120}"
if ! wait_for_backend_ready "${BACKEND_READY_URL}" "${BACKEND_WAIT_SECONDS}"; then
  echo "[playwright-postcheck] discourse backend not ready at ${BACKEND_READY_URL} after ${BACKEND_WAIT_SECONDS}s" >&2
  exit 3
fi

author_user="${PW_DEMO_AUTHOR_USERNAME:-fiber_author}"
author_password="${PW_DEMO_AUTHOR_PASSWORD:-fiber-local-pass-1}"
admin_user="${PW_DEMO_ADMIN_USERNAME:-fiber_tipper}"
admin_password="${PW_DEMO_ADMIN_PASSWORD:-fiber-local-pass-1}"
withdrawal_id="${PW_DEMO_WITHDRAWAL_ID:-}"
withdraw_amount="${PW_DEMO_WITHDRAW_AMOUNT:-61}"
withdraw_to_address="${PW_DEMO_WITHDRAW_TO_ADDRESS:-}"
initiate_withdrawal="${PW_DEMO_INITIATE_WITHDRAWAL:-0}"
viewport_width="${PW_DEMO_VIEWPORT_WIDTH:-${E2E_SCREENSHOT_VIEWPORT_WIDTH:-2560}}"
viewport_height="${PW_DEMO_VIEWPORT_HEIGHT:-${E2E_SCREENSHOT_VIEWPORT_HEIGHT:-1440}}"

demo_env_json="$(
  jq -cn \
    --arg baseUrl "${BASE_URL}" \
    --arg authorUser "${author_user}" \
    --arg authorPassword "${author_password}" \
    --arg adminUser "${admin_user}" \
    --arg adminPassword "${admin_password}" \
    --arg withdrawalId "${withdrawal_id}" \
    --arg withdrawAmount "${withdraw_amount}" \
    --arg withdrawToAddress "${withdraw_to_address}" \
    --arg initiateWithdrawal "${initiate_withdrawal}" \
    --arg viewportWidth "${viewport_width}" \
    --arg viewportHeight "${viewport_height}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    '{
      baseUrl: $baseUrl,
      authorUser: $authorUser,
      authorPassword: $authorPassword,
      adminUser: $adminUser,
      adminPassword: $adminPassword,
      withdrawalId: $withdrawalId,
      withdrawAmount: $withdrawAmount,
      withdrawToAddress: $withdrawToAddress,
      initiateWithdrawal: $initiateWithdrawal,
      viewportWidth: $viewportWidth,
      viewportHeight: $viewportHeight,
      artifactDir: $artifactDir
    }'
)"
base_code="$(cat "${RUN_CODE_FILE}")"
run_code="$(printf '(() => { globalThis.__PW_DEMO_ENV__ = %s; return (%s); })()' "${demo_env_json}" "${base_code}")"
run_code_file="${ARTIFACT_DIR}/playwright-postcheck.run-code.js"
printf '%s' "${run_code}" > "${run_code_file}"

PWCLI_PATH="${PWCLI}" \
PW_SESSION="${SESSION}" \
PW_OPEN_URL="${OPEN_URL}" \
PW_RUN_CODE_FILE="${run_code_file}" \
PW_OPEN_LOG="${ARTIFACT_DIR}/playwright-postcheck-open.log" \
PW_RESULT_LOG="${ARTIFACT_DIR}/playwright-postcheck-result.log" \
PW_CLOSE_LOG="${ARTIFACT_DIR}/playwright-postcheck-close.log" \
PW_ERROR_PREFIX="[playwright-postcheck]" \
PW_HEADED="${PW_DEMO_HEADED:-1}" \
PW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_TMPDIR="${PW_TMPDIR}" \
  "${RUN_PLAYWRIGHT_SESSION_SCRIPT}"
