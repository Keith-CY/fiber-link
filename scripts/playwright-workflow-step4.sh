#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWCLI="${PWCLI:-${ROOT_DIR}/scripts/playwright-cli.sh}"
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
PW_TMPDIR="${PW_TMPDIR:-${ARTIFACT_DIR}/playwright-cli-tmp}"
mkdir -p "${PW_TMPDIR}"
export TMPDIR="${PW_TMPDIR}"

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
run_code_file="${ARTIFACT_DIR}/playwright-step4.run-code.js"
printf '%s' "${run_code}" > "${run_code_file}"

PWCLI_PATH="${PWCLI}" \
PW_SESSION="${SESSION}" \
PW_OPEN_URL="${OPEN_URL}" \
PW_RUN_CODE_FILE="${run_code_file}" \
PW_OPEN_LOG="${ARTIFACT_DIR}/playwright-step4-open.log" \
PW_RESULT_LOG="${ARTIFACT_DIR}/playwright-step4-result.log" \
PW_CLOSE_LOG="${ARTIFACT_DIR}/playwright-step4-close.log" \
PW_ERROR_PREFIX="[playwright-step4]" \
PW_HEADED="${PW_DEMO_HEADED:-1}" \
PW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_TMPDIR="${PW_TMPDIR}" \
  "${ROOT_DIR}/scripts/run-playwright-session.sh"
