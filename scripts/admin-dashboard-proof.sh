#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/fiber-link-service/apps/admin"
ARTIFACT_DIR="${ADMIN_DASHBOARD_ARTIFACT_DIR:-${ROOT_DIR}/.tmp/admin-dashboard-proof}"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/admin-dashboard-proof.run-code.js"
RUN_PLAYWRIGHT_SESSION_SCRIPT="${RUN_PLAYWRIGHT_SESSION_SCRIPT:-${ROOT_DIR}/scripts/run-playwright-session.sh}"
START_COMMAND="${ADMIN_DASHBOARD_START_COMMAND:-bun run --cwd ${APP_DIR} dev -- --hostname ${ADMIN_DASHBOARD_HOST:-127.0.0.1} --port ${ADMIN_DASHBOARD_PORT:-4318}}"
HOST="${ADMIN_DASHBOARD_HOST:-127.0.0.1}"
PORT="${ADMIN_DASHBOARD_PORT:-4318}"
BASE_URL="http://${HOST}:${PORT}"
FIXTURE_PATH="${ADMIN_DASHBOARD_FIXTURE_PATH:-${APP_DIR}/fixtures/dashboard-proof.json}"
SESSION="${ADMIN_DASHBOARD_SESSION:-admin-dashboard-proof}"
READY_COMMAND="${ADMIN_DASHBOARD_READY_COMMAND:-curl -fsS ${BASE_URL} | rg -q 'Admin controls'}"

[[ -f "${RUN_CODE_FILE}" ]] || {
  echo "[admin-dashboard-proof] missing run-code file: ${RUN_CODE_FILE}" >&2
  exit 2
}
[[ -f "${FIXTURE_PATH}" ]] || {
  echo "[admin-dashboard-proof] missing fixture file: ${FIXTURE_PATH}" >&2
  exit 2
}
[[ -x "${RUN_PLAYWRIGHT_SESSION_SCRIPT}" ]] || {
  echo "[admin-dashboard-proof] missing playwright session runner: ${RUN_PLAYWRIGHT_SESSION_SCRIPT}" >&2
  exit 2
}

mkdir -p "${ARTIFACT_DIR}"
RUN_CODE_OUTPUT="${ARTIFACT_DIR}/admin-dashboard-proof.run-code.js"
SERVER_LOG="${ARTIFACT_DIR}/admin-dashboard-server.log"
OPEN_LOG="${ARTIFACT_DIR}/admin-dashboard-proof-open.log"
RESULT_LOG="${ARTIFACT_DIR}/admin-dashboard-proof-result.log"
CLOSE_LOG="${ARTIFACT_DIR}/admin-dashboard-proof-close.log"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ADMIN_DASHBOARD_DEFAULT_ROLE=SUPER_ADMIN \
ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID=proof-admin \
ADMIN_DASHBOARD_FIXTURE_PATH="${FIXTURE_PATH}" \
  bash -c "${START_COMMAND}" > "${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _attempt in $(seq 1 40); do
  if bash -c "${READY_COMMAND}"; then
    break
  fi
  sleep 1
done

if ! bash -c "${READY_COMMAND}"; then
  echo "[admin-dashboard-proof] admin dashboard did not become ready at ${BASE_URL}" >&2
  exit 1
fi

proof_env_json="$(
  jq -cn \
    --arg baseUrl "${BASE_URL}" \
    --arg artifactDir "${ARTIFACT_DIR}" \
    --arg appId "app-beta" \
    --arg maxPerRequest "1500" \
    --arg perUserDailyMax "4500" \
    --arg perAppDailyMax "25000" \
    --arg cooldownSeconds "45" \
    '{
      baseUrl: $baseUrl,
      artifactDir: $artifactDir,
      appId: $appId,
      maxPerRequest: $maxPerRequest,
      perUserDailyMax: $perUserDailyMax,
      perAppDailyMax: $perAppDailyMax,
      cooldownSeconds: $cooldownSeconds
    }'
)"
run_code="$(printf '(() => { globalThis.__PW_ADMIN_DASHBOARD_ENV__ = %s; return (%s); })()' "${proof_env_json}" "$(cat "${RUN_CODE_FILE}")")"
printf '%s' "${run_code}" > "${RUN_CODE_OUTPUT}"

PWCLI_PATH="${ROOT_DIR}/scripts/playwright-cli.sh" \
PW_SESSION="${SESSION}" \
PW_OPEN_URL="${BASE_URL}" \
PW_RUN_CODE_FILE="${RUN_CODE_OUTPUT}" \
PW_OPEN_LOG="${OPEN_LOG}" \
PW_RESULT_LOG="${RESULT_LOG}" \
PW_CLOSE_LOG="${CLOSE_LOG}" \
PW_ERROR_PREFIX="[admin-dashboard-proof]" \
PW_HEADED="${ADMIN_DASHBOARD_HEADED:-0}" \
PW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
  "${RUN_PLAYWRIGHT_SESSION_SCRIPT}"

echo "Artifacts: ${ARTIFACT_DIR}"
