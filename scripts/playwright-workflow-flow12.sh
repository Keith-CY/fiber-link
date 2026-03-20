#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-${ROOT_DIR}/scripts/playwright-cli.sh}"
SESSION="${PW_FLOW12_SESSION:-fiber-workflow-flow12}"
ARTIFACT_DIR="${PW_FLOW12_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-flow12.run-code.js"
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
  echo "[playwright-flow12] missing playwright CLI wrapper: ${PWCLI}" >&2
  exit 2
}
[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "[playwright-flow12] missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}
[[ -x "${RUN_PLAYWRIGHT_SESSION_SCRIPT}" ]] || {
  echo "[playwright-flow12] missing playwright session runner: ${RUN_PLAYWRIGHT_SESSION_SCRIPT}" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}"
PW_TMPDIR="${PW_TMPDIR:-${ARTIFACT_DIR}/playwright-cli-tmp}"
mkdir -p "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

normalize_sidecar_url() {
  local raw_url="$1"
  local host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-${E2E_HOST_ACCESS_HOST:-host.docker.internal}}"
  if [[ -n "${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}" || "${PLAYWRIGHT_CLI_DOCKER_NETWORK_MODE:-}" == "host" ]]; then
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

BASE_URL="${PW_FLOW12_URL:-${PW_DEMO_URL:-http://127.0.0.1:4200}}"
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
    elif [[ -n "${PLAYWRIGHT_CLI_DOCKER_IMAGE:-}" && "${PLAYWRIGHT_CLI_DOCKER_NETWORK_MODE:-}" == "host" ]]; then
      if docker run --rm --network host --entrypoint bash "${PLAYWRIGHT_CLI_DOCKER_IMAGE}" -lc "curl -fsS -m 3 '${probe_url}' >/dev/null" >/dev/null 2>&1; then
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

BACKEND_READY_URL="${PW_FLOW12_BACKEND_READY_URL:-${BASE_URL%/}/session/csrf.json}"
BACKEND_READY_URL="$(normalize_sidecar_probe_url "${BACKEND_READY_URL}")"
BACKEND_WAIT_SECONDS="${PW_FLOW12_BACKEND_WAIT_SECONDS:-120}"
if ! wait_for_backend_ready "${BACKEND_READY_URL}" "${BACKEND_WAIT_SECONDS}"; then
  echo "[playwright-flow12] discourse backend not ready at ${BACKEND_READY_URL} after ${BACKEND_WAIT_SECONDS}s" >&2
  exit 3
fi

username="${PW_FLOW12_USERNAME:-${PW_DEMO_TIPPER_USERNAME:-fiber_tipper}}"
password="${PW_FLOW12_PASSWORD:-${PW_DEMO_TIPPER_PASSWORD:-fiber-local-pass-1}}"
topic_title="${PW_FLOW12_TOPIC_TITLE:-${PW_DEMO_TOPIC_TITLE:-Fiber Link Local Workflow Topic}}"
topic_path="${PW_FLOW12_TOPIC_PATH:-${PW_DEMO_TOPIC_PATH:-}}"
tip_amount="${PW_FLOW12_TIP_AMOUNT:-${PW_DEMO_TIP_AMOUNT:-31}}"
tip_message="${PW_FLOW12_TIP_MESSAGE:-${PW_DEMO_TIP_MESSAGE:-Great post!}}"
payer_rpc_base_url="${PW_FLOW12_PAYER_RPC_BASE_URL:-${PW_DEMO_PAYER_RPC_BASE_URL:-${E2E_HOST_ACCESS_BASE_URL:-http://127.0.0.1}}}"
payer_rpc_base_url="$(normalize_sidecar_url "${payer_rpc_base_url}")"
payer_rpc_url="${PW_FLOW12_PAYER_RPC_URL:-${PW_DEMO_PAYER_RPC_URL:-${payer_rpc_base_url}:${FNN2_RPC_PORT:-9227}}}"
payment_currency="${PW_FLOW12_PAYMENT_CURRENCY:-${PW_DEMO_PAYMENT_CURRENCY:-${FIBER_INVOICE_CURRENCY_CKB:-${FIBER_INVOICE_CURRENCY:-Fibt}}}}"
settle_invoice="${PW_FLOW12_SETTLE_INVOICE:-${PW_DEMO_SETTLE_INVOICE:-1}}"
viewport_width="${PW_FLOW12_VIEWPORT_WIDTH:-${E2E_SCREENSHOT_VIEWPORT_WIDTH:-2560}}"
viewport_height="${PW_FLOW12_VIEWPORT_HEIGHT:-${E2E_SCREENSHOT_VIEWPORT_HEIGHT:-1440}}"

demo_env_json="$(
  jq -cn \
    --arg baseUrl "${BASE_URL}" \
    --arg username "${username}" \
    --arg password "${password}" \
    --arg topicTitle "${topic_title}" \
    --arg topicPath "${topic_path}" \
    --arg tipAmount "${tip_amount}" \
    --arg tipMessage "${tip_message}" \
    --arg payerRpcUrl "${payer_rpc_url}" \
    --arg paymentCurrency "${payment_currency}" \
    --arg settleInvoice "${settle_invoice}" \
    --arg viewportWidth "${viewport_width}" \
    --arg viewportHeight "${viewport_height}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    '{
      baseUrl: $baseUrl,
      username: $username,
      password: $password,
      topicTitle: $topicTitle,
      topicPath: $topicPath,
      tipAmount: $tipAmount,
      tipMessage: $tipMessage,
      payerRpcUrl: $payerRpcUrl,
      paymentCurrency: $paymentCurrency,
      settleInvoice: $settleInvoice,
      viewportWidth: $viewportWidth,
      viewportHeight: $viewportHeight,
      artifactDir: $artifactDir
    }'
)"
base_code="$(cat "${RUN_CODE_FILE}")"
run_code="$(printf '(() => { globalThis.__PW_FLOW12_ENV__ = %s; return (%s); })()' "${demo_env_json}" "${base_code}")"
run_code_file="${ARTIFACT_DIR}/playwright-flow12.run-code.js"
printf '%s' "${run_code}" > "${run_code_file}"

PWCLI_PATH="${PWCLI}" \
PW_SESSION="${SESSION}" \
PW_OPEN_URL="${OPEN_URL}" \
PW_RUN_CODE_FILE="${run_code_file}" \
PW_OPEN_LOG="${ARTIFACT_DIR}/playwright-flow12-open.log" \
PW_RESULT_LOG="${ARTIFACT_DIR}/playwright-flow12-result.log" \
PW_CLOSE_LOG="${ARTIFACT_DIR}/playwright-flow12-close.log" \
PW_ERROR_PREFIX="[playwright-flow12]" \
PW_HEADED="${PW_FLOW12_HEADED:-${PW_DEMO_HEADED:-1}}" \
PW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_TMPDIR="${PW_TMPDIR}" \
  "${RUN_PLAYWRIGHT_SESSION_SCRIPT}"
