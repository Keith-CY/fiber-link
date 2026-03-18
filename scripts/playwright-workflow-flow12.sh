#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-${ROOT_DIR}/scripts/playwright-cli.sh}"
SESSION="${PW_FLOW12_SESSION:-fiber-workflow-flow12}"
ARTIFACT_DIR="${PW_FLOW12_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-flow12.run-code.js"

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

mkdir -p "${ARTIFACT_DIR}"
PW_TMPDIR="${PW_TMPDIR:-/tmp/playwright-cli}"
mkdir -p "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

BASE_URL="${PW_FLOW12_URL:-${PW_DEMO_URL:-http://127.0.0.1:9292}}"
if [[ "${BASE_URL}" == */login ]]; then
  OPEN_URL="${BASE_URL}"
else
  OPEN_URL="${BASE_URL%/}/login"
fi

wait_for_backend_ready() {
  local probe_url="$1"
  local timeout_seconds="$2"
  local deadline
  deadline=$(( $(date +%s) + timeout_seconds ))

  while true; do
    if curl -fsS -m 3 "${probe_url}" >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      return 1
    fi
    sleep 2
  done
}

BACKEND_READY_URL="${PW_FLOW12_BACKEND_READY_URL:-${BASE_URL%/}/session/csrf.json}"
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
payer_rpc_url="${PW_FLOW12_PAYER_RPC_URL:-${PW_DEMO_PAYER_RPC_URL:-http://127.0.0.1:${FNN2_RPC_PORT:-9227}}}"
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

"${PWCLI}" -s="${SESSION}" close >/dev/null 2>&1 || true
if [[ "${PW_FLOW12_HEADED:-${PW_DEMO_HEADED:-1}}" == "1" ]]; then
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" --headed > "${ARTIFACT_DIR}/playwright-flow12-open.log"
else
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" > "${ARTIFACT_DIR}/playwright-flow12-open.log"
fi

set +e
"${PWCLI}" -s="${SESSION}" run-code "${run_code}" \
  | tee "${ARTIFACT_DIR}/playwright-flow12-result.log"
run_code_status=${PIPESTATUS[0]}
set -e

if [[ "${run_code_status}" -ne 0 ]]; then
  if grep -q '^### Result' "${ARTIFACT_DIR}/playwright-flow12-result.log"; then
    echo "[playwright-flow12] run-code returned ${run_code_status}; continuing because result payload exists." >> "${ARTIFACT_DIR}/playwright-flow12-result.log"
  else
    echo "[playwright-flow12] run-code failed with status ${run_code_status}" >&2
    exit "${run_code_status}"
  fi
fi

"${PWCLI}" -s="${SESSION}" close > "${ARTIFACT_DIR}/playwright-flow12-close.log" 2>&1 || true
