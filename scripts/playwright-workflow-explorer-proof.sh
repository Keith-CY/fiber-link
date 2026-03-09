#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-$HOME/.codex/skills/playwright/scripts/playwright_cli.sh}"
SESSION="${PW_EXPLORER_SESSION:-fiber-workflow-explorer-proof}"
ARTIFACT_DIR="${PW_EXPLORER_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/e2e-discourse-four-flows}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-explorer-proof.run-code.js"

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

"${PWCLI}" -s="${SESSION}" close >/dev/null 2>&1 || true
if [[ "${PW_EXPLORER_HEADED:-0}" == "1" ]]; then
  "${PWCLI}" -s="${SESSION}" open "${open_url}" --headed > "${ARTIFACT_DIR}/playwright-explorer-open.log"
else
  "${PWCLI}" -s="${SESSION}" open "${open_url}" > "${ARTIFACT_DIR}/playwright-explorer-open.log"
fi

set +e
"${PWCLI}" -s="${SESSION}" run-code "${run_code}" \
  | tee "${ARTIFACT_DIR}/playwright-explorer-result.log"
run_code_status=${PIPESTATUS[0]}
set -e

if [[ "${run_code_status}" -ne 0 ]]; then
  if grep -q '^### Result' "${ARTIFACT_DIR}/playwright-explorer-result.log"; then
    echo "[playwright-explorer] run-code returned ${run_code_status}; continuing because result payload exists." >> "${ARTIFACT_DIR}/playwright-explorer-result.log"
  else
    echo "[playwright-explorer] run-code failed with status ${run_code_status}" >&2
    exit "${run_code_status}"
  fi
fi

"${PWCLI}" -s="${SESSION}" close > "${ARTIFACT_DIR}/playwright-explorer-close.log" 2>&1 || true
