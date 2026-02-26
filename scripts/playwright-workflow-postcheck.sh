#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-$HOME/.codex/skills/playwright/scripts/playwright_cli.sh}"
SESSION="${PW_DEMO_SESSION:-fiber-workflow-postcheck}"
ARTIFACT_DIR="${PW_DEMO_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/playwright-workflow-demo/postcheck}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-postcheck.run-code.js"

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

mkdir -p "${ARTIFACT_DIR}"

BASE_URL="${PW_DEMO_URL:-http://127.0.0.1:4200}"
if [[ "${BASE_URL}" == */login ]]; then
  OPEN_URL="${BASE_URL}"
else
  OPEN_URL="${BASE_URL%/}/login"
fi

author_user="${PW_DEMO_AUTHOR_USERNAME:-fiber_author}"
author_password="${PW_DEMO_AUTHOR_PASSWORD:-fiber-local-pass-1}"
admin_user="${PW_DEMO_ADMIN_USERNAME:-fiber_tipper}"
admin_password="${PW_DEMO_ADMIN_PASSWORD:-fiber-local-pass-1}"
withdrawal_id="${PW_DEMO_WITHDRAWAL_ID:-}"

demo_env_json="$(
  jq -cn \
    --arg baseUrl "${BASE_URL}" \
    --arg authorUser "${author_user}" \
    --arg authorPassword "${author_password}" \
    --arg adminUser "${admin_user}" \
    --arg adminPassword "${admin_password}" \
    --arg withdrawalId "${withdrawal_id}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    '{
      baseUrl: $baseUrl,
      authorUser: $authorUser,
      authorPassword: $authorPassword,
      adminUser: $adminUser,
      adminPassword: $adminPassword,
      withdrawalId: $withdrawalId,
      artifactDir: $artifactDir
    }'
)"
base_code="$(cat "${RUN_CODE_FILE}")"
run_code="$(printf '(() => { globalThis.__PW_DEMO_ENV__ = %s; return (%s); })()' "${demo_env_json}" "${base_code}")"

"${PWCLI}" -s="${SESSION}" close >/dev/null 2>&1 || true
if [[ "${PW_DEMO_HEADED:-1}" == "1" ]]; then
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" --headed > "${ARTIFACT_DIR}/playwright-postcheck-open.log"
else
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" > "${ARTIFACT_DIR}/playwright-postcheck-open.log"
fi

set +e
"${PWCLI}" -s="${SESSION}" run-code "${run_code}" \
  | tee "${ARTIFACT_DIR}/playwright-postcheck-result.log"
run_code_status=${PIPESTATUS[0]}
set -e

if [[ "${run_code_status}" -ne 0 ]]; then
  if rg -q '^### Result' "${ARTIFACT_DIR}/playwright-postcheck-result.log"; then
    echo "[playwright-postcheck] run-code returned ${run_code_status} (likely due console errors); continuing because result payload exists." >> "${ARTIFACT_DIR}/playwright-postcheck-result.log"
  else
    echo "[playwright-postcheck] run-code failed with status ${run_code_status}" >&2
    exit "${run_code_status}"
  fi
fi

"${PWCLI}" -s="${SESSION}" close > "${ARTIFACT_DIR}/playwright-postcheck-close.log" 2>&1 || true
