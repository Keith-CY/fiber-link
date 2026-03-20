#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI_PATH:-${ROOT_DIR}/scripts/playwright-cli.sh}"
SESSION="${PW_SESSION:?PW_SESSION is required}"
OPEN_URL="${PW_OPEN_URL:?PW_OPEN_URL is required}"
RUN_CODE_FILE="${PW_RUN_CODE_FILE:?PW_RUN_CODE_FILE is required}"
OPEN_LOG="${PW_OPEN_LOG:?PW_OPEN_LOG is required}"
RESULT_LOG="${PW_RESULT_LOG:?PW_RESULT_LOG is required}"
CLOSE_LOG="${PW_CLOSE_LOG:?PW_CLOSE_LOG is required}"
ERROR_PREFIX="${PW_ERROR_PREFIX:-[playwright]}"
HEADED="${PW_HEADED:-0}"
ARTIFACT_DIR="${PW_ARTIFACT_DIR:-$(dirname "${RESULT_LOG}")}"
PW_TMPDIR="${PW_TMPDIR:-${ARTIFACT_DIR}/playwright-cli-tmp}"
PLAYWRIGHT_DOCKER_IMAGE="${PLAYWRIGHT_CLI_DOCKER_IMAGE:-}"
PLAYWRIGHT_DOCKER_NETWORK_CONTAINER="${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}"
PLAYWRIGHT_DOCKER_NETWORK_MODE="${PLAYWRIGHT_CLI_DOCKER_NETWORK_MODE:-}"

[[ -x "${PWCLI}" ]] || {
  echo "${ERROR_PREFIX} missing playwright CLI wrapper: ${PWCLI}" >&2
  exit 2
}
[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "${ERROR_PREFIX} missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}" "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

run_locally() {
  local run_code run_code_status

  run_code="$(cat "${RUN_CODE_FILE}")"
  "${PWCLI}" -s="${SESSION}" close >/dev/null 2>&1 || true
  if [[ "${HEADED}" == "1" ]]; then
    "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" --headed > "${OPEN_LOG}"
  else
    "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" > "${OPEN_LOG}"
  fi

  set +e
  "${PWCLI}" -s="${SESSION}" run-code "${run_code}" | tee "${RESULT_LOG}"
  run_code_status=${PIPESTATUS[0]}
  set -e

  if [[ "${run_code_status}" -ne 0 ]]; then
    if grep -q '^### Result' "${RESULT_LOG}"; then
      echo "${ERROR_PREFIX} run-code returned ${run_code_status} (likely due console errors); continuing because result payload exists." >> "${RESULT_LOG}"
    else
      echo "${ERROR_PREFIX} run-code failed with status ${run_code_status}" >&2
      exit "${run_code_status}"
    fi
  fi

  "${PWCLI}" -s="${SESSION}" close > "${CLOSE_LOG}" 2>&1 || true
}

run_in_sidecar() {
  local container_tmpdir inner_script host_access_host
  container_tmpdir="/tmp/playwright-cli-session/${SESSION}"
  inner_script="${ARTIFACT_DIR}/playwright-session-inner.sh"
  host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-${E2E_HOST_ACCESS_HOST:-host.docker.internal}}"
  cat > "${inner_script}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

run_code="$(cat "${PW_RUN_CODE_FILE}")"
"${PWCLI_PATH}" -s="${PW_SESSION}" close >/dev/null 2>&1 || true
if [[ "${PW_HEADED}" == "1" ]]; then
  "${PWCLI_PATH}" -s="${PW_SESSION}" open "${PW_OPEN_URL}" --headed > "${PW_OPEN_LOG}"
else
  "${PWCLI_PATH}" -s="${PW_SESSION}" open "${PW_OPEN_URL}" > "${PW_OPEN_LOG}"
fi

set +e
"${PWCLI_PATH}" -s="${PW_SESSION}" run-code "${run_code}" | tee "${PW_RESULT_LOG}"
run_code_status=${PIPESTATUS[0]}
set -e

if [[ "${run_code_status}" -ne 0 ]]; then
  if grep -q '^### Result' "${PW_RESULT_LOG}"; then
    echo "${PW_ERROR_PREFIX} run-code returned ${run_code_status} (likely due console errors); continuing because result payload exists." >> "${PW_RESULT_LOG}"
  else
    echo "${PW_ERROR_PREFIX} run-code failed with status ${run_code_status}" >&2
    exit "${run_code_status}"
  fi
fi

"${PWCLI_PATH}" -s="${PW_SESSION}" close > "${PW_CLOSE_LOG}" 2>&1 || true
EOF
  chmod +x "${inner_script}"

  local -a docker_args
  docker_args=(
    docker run --rm
    --init
    --ipc=host
    --entrypoint bash
  )
  if [[ -n "${PLAYWRIGHT_DOCKER_NETWORK_CONTAINER}" ]]; then
    docker_args+=(--network "container:${PLAYWRIGHT_DOCKER_NETWORK_CONTAINER}")
  elif [[ "${PLAYWRIGHT_DOCKER_NETWORK_MODE}" == "host" ]]; then
    docker_args+=(--network host)
  else
    docker_args+=(--add-host "${host_access_host}:host-gateway")
  fi
  docker_args+=(
    -v "${ROOT_DIR}:${ROOT_DIR}"
    -v "${ARTIFACT_DIR}:${ARTIFACT_DIR}"
    -w "${ROOT_DIR}"
    -e HOME="${container_tmpdir}/home"
    -e TMPDIR="${container_tmpdir}"
    -e PLAYWRIGHT_CLI_BROWSER="${PLAYWRIGHT_CLI_BROWSER:-chromium}"
    -e PWCLI_PATH="${PWCLI}"
    -e PW_SESSION="${SESSION}"
    -e PW_OPEN_URL="${OPEN_URL}"
    -e PW_RUN_CODE_FILE="${RUN_CODE_FILE}"
    -e PW_OPEN_LOG="${OPEN_LOG}"
    -e PW_RESULT_LOG="${RESULT_LOG}"
    -e PW_CLOSE_LOG="${CLOSE_LOG}"
    -e PW_ERROR_PREFIX="${ERROR_PREFIX}"
    -e PW_HEADED="${HEADED}"
    "${PLAYWRIGHT_DOCKER_IMAGE}"
    "${inner_script}"
  )

  "${docker_args[@]}"
}

if [[ -n "${PLAYWRIGHT_DOCKER_IMAGE}" && -n "${PLAYWRIGHT_DOCKER_NETWORK_CONTAINER}" ]]; then
  run_in_sidecar
elif [[ -n "${PLAYWRIGHT_DOCKER_IMAGE}" ]]; then
  run_in_sidecar
else
  run_locally
fi
