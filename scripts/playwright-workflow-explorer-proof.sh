#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-${ROOT_DIR}/scripts/playwright-cli.sh}"
SESSION="${PW_EXPLORER_SESSION:-fiber-workflow-explorer-proof}"
ARTIFACT_DIR="${PW_EXPLORER_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-explorer-proof.run-code.js"
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
  echo "[playwright-explorer] missing playwright CLI wrapper: ${PWCLI}" >&2
  exit 2
}
[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "[playwright-explorer] missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}
[[ -x "${RUN_PLAYWRIGHT_SESSION_SCRIPT}" ]] || {
  echo "[playwright-explorer] missing playwright session runner: ${RUN_PLAYWRIGHT_SESSION_SCRIPT}" >&2
  exit 2
}

tx_hash="${PW_EXPLORER_TX_HASH:-}"
template="${PW_EXPLORER_TX_URL_TEMPLATE:-}"
[[ -n "${tx_hash}" ]] || {
  echo "[playwright-explorer] PW_EXPLORER_TX_HASH is required" >&2
  exit 2
}
[[ -n "${template}" ]] || {
  echo "[playwright-explorer] PW_EXPLORER_TX_URL_TEMPLATE is required" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}"
PW_TMPDIR="${PW_TMPDIR:-/tmp/playwright-cli}"
mkdir -p "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

open_url="${template}"
viewport_width="${PW_EXPLORER_VIEWPORT_WIDTH:-${E2E_SCREENSHOT_VIEWPORT_WIDTH:-2560}}"
viewport_height="${PW_EXPLORER_VIEWPORT_HEIGHT:-${E2E_SCREENSHOT_VIEWPORT_HEIGHT:-1440}}"
if [[ "${template}" == *"{txHash}"* ]]; then
  open_url="${template//\{txHash\}/${tx_hash}}"
elif [[ "${template}" == *"%s"* ]]; then
  open_url="$(printf '%s' "${template}" | sed "s|%s|${tx_hash}|")"
fi

demo_env_json="$(
  jq -cn \
    --arg txHash "${tx_hash}" \
    --arg explorerTxUrlTemplate "${template}" \
    --arg viewportWidth "${viewport_width}" \
    --arg viewportHeight "${viewport_height}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    '{
      txHash: $txHash,
      explorerTxUrlTemplate: $explorerTxUrlTemplate,
      viewportWidth: $viewportWidth,
      viewportHeight: $viewportHeight,
      artifactDir: $artifactDir
    }'
)"
base_code="$(cat "${RUN_CODE_FILE}")"
run_code="$(printf '(() => { globalThis.__PW_EXPLORER_ENV__ = %s; return (%s); })()' "${demo_env_json}" "${base_code}")"
run_code_file="${ARTIFACT_DIR}/playwright-explorer.run-code.js"
printf '%s' "${run_code}" > "${run_code_file}"

PWCLI_PATH="${PWCLI}" \
PW_SESSION="${SESSION}" \
PW_OPEN_URL="${open_url}" \
PW_RUN_CODE_FILE="${run_code_file}" \
PW_OPEN_LOG="${ARTIFACT_DIR}/playwright-explorer-open.log" \
PW_RESULT_LOG="${ARTIFACT_DIR}/playwright-explorer-result.log" \
PW_CLOSE_LOG="${ARTIFACT_DIR}/playwright-explorer-close.log" \
PW_ERROR_PREFIX="[playwright-explorer]" \
PW_HEADED="${PW_EXPLORER_HEADED:-0}" \
PW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_TMPDIR="${PW_TMPDIR}" \
  "${RUN_PLAYWRIGHT_SESSION_SCRIPT}"
