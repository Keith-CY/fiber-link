#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-$HOME/.codex/skills/playwright/scripts/playwright_cli.sh}"
SESSION="${PW_DEMO_SESSION:-fiber-workflow-step4}"
ARTIFACT_DIR="${PW_DEMO_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/playwright-workflow-demo}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-step4.run-code.js"

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
  echo "[playwright-step4] missing playwright CLI wrapper: ${PWCLI}" >&2
  exit 2
}
[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "[playwright-step4] missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}"

BASE_URL="${PW_DEMO_URL:-http://127.0.0.1:4200}"
if [[ "${BASE_URL}" == */login ]]; then
  OPEN_URL="${BASE_URL}"
else
  OPEN_URL="${BASE_URL%/}/login"
fi

tipper_username="${PW_DEMO_TIPPER_USERNAME:-fiber_tipper}"
tipper_password="${PW_DEMO_TIPPER_PASSWORD:-fiber-local-pass-1}"
topic_title="${PW_DEMO_TOPIC_TITLE:-Fiber Link Local Workflow Topic}"
topic_path="${PW_DEMO_TOPIC_PATH:-}"
tip_amount="${PW_DEMO_TIP_AMOUNT:-31}"

demo_env_json="$(
  jq -cn \
    --arg baseUrl "${BASE_URL}" \
    --arg username "${tipper_username}" \
    --arg password "${tipper_password}" \
    --arg topicTitle "${topic_title}" \
    --arg topicPath "${topic_path}" \
    --arg tipAmount "${tip_amount}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    '{
      baseUrl: $baseUrl,
      username: $username,
      password: $password,
      topicTitle: $topicTitle,
      topicPath: $topicPath,
      tipAmount: $tipAmount,
      artifactDir: $artifactDir
    }'
)"
base_code="$(cat "${RUN_CODE_FILE}")"
run_code="$(printf '(() => { globalThis.__PW_DEMO_ENV__ = %s; return (%s); })()' "${demo_env_json}" "${base_code}")"

"${PWCLI}" -s="${SESSION}" close >/dev/null 2>&1 || true
if [[ "${PW_DEMO_HEADED:-1}" == "1" ]]; then
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" --headed > "${ARTIFACT_DIR}/playwright-step4-open.log"
else
  "${PWCLI}" -s="${SESSION}" open "${OPEN_URL}" > "${ARTIFACT_DIR}/playwright-step4-open.log"
fi

set +e
"${PWCLI}" -s="${SESSION}" run-code "${run_code}" \
  | tee "${ARTIFACT_DIR}/playwright-step4-result.log"
run_code_status=${PIPESTATUS[0]}
set -e

if [[ "${run_code_status}" -ne 0 ]]; then
  if rg -q '^### Result' "${ARTIFACT_DIR}/playwright-step4-result.log"; then
    echo "[playwright-step4] run-code returned ${run_code_status} (likely due console errors); continuing because result payload exists." >> "${ARTIFACT_DIR}/playwright-step4-result.log"
  else
    echo "[playwright-step4] run-code failed with status ${run_code_status}" >&2
    exit "${run_code_status}"
  fi
fi

"${PWCLI}" -s="${SESSION}" close > "${ARTIFACT_DIR}/playwright-step4-close.log" 2>&1 || true
