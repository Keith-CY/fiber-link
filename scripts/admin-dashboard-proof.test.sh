#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAPTURE_DIR="$(mktemp -d)"
ARTIFACT_DIR="$(mktemp -d)"
ENV_CAPTURE="$(mktemp)"
PORT=43181
HOST="127.0.0.1"
SERVER_PID=""
trap '[[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" >/dev/null 2>&1 || true; rm -rf "${CAPTURE_DIR}" "${ARTIFACT_DIR}" "${ENV_CAPTURE}"' EXIT

FAKE_START_SCRIPT="${CAPTURE_DIR}/fake-admin-dashboard-start.sh"
cat > "${FAKE_START_SCRIPT}" <<'EOF_START'
#!/usr/bin/env bash
set -euo pipefail

env | grep '^ADMIN_DASHBOARD_' | sort > "${ADMIN_DASHBOARD_ENV_CAPTURE:?}"
sleep 30
EOF_START
chmod +x "${FAKE_START_SCRIPT}"

FAKE_RUNNER="${CAPTURE_DIR}/fake-run-playwright-session.sh"
cat > "${FAKE_RUNNER}" <<'EOF_RUNNER'
#!/usr/bin/env bash
set -euo pipefail

cp "${PW_RUN_CODE_FILE}" "${PW_TEST_CAPTURE_DIR:?}/admin-dashboard-proof.run-code.js"
: > "${PW_OPEN_LOG}"
printf '### Result\n{"ok":true}\n' > "${PW_RESULT_LOG}"
: > "${PW_CLOSE_LOG}"
EOF_RUNNER
chmod +x "${FAKE_RUNNER}"

ADMIN_DASHBOARD_START_COMMAND="${FAKE_START_SCRIPT}" \
ADMIN_DASHBOARD_ENV_CAPTURE="${ENV_CAPTURE}" \
ADMIN_DASHBOARD_PORT="${PORT}" \
ADMIN_DASHBOARD_HOST="${HOST}" \
ADMIN_DASHBOARD_READY_COMMAND="true" \
ADMIN_DASHBOARD_ARTIFACT_DIR="${ARTIFACT_DIR}" \
ADMIN_DASHBOARD_USE_FIXTURE="0" \
ADMIN_DASHBOARD_APP_ID="e2e-app-123" \
RUN_PLAYWRIGHT_SESSION_SCRIPT="${FAKE_RUNNER}" \
PW_TEST_CAPTURE_DIR="${CAPTURE_DIR}" \
  "${ROOT_DIR}/scripts/admin-dashboard-proof.sh"

grep -q "ADMIN_DASHBOARD_DEFAULT_ROLE=SUPER_ADMIN" "${ENV_CAPTURE}"
grep -q "ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID=proof-admin" "${ENV_CAPTURE}"
if grep -q "ADMIN_DASHBOARD_FIXTURE_PATH=" "${ENV_CAPTURE}"; then
  echo "fixture path should not be exported when ADMIN_DASHBOARD_USE_FIXTURE=0" >&2
  exit 1
fi
grep -q "\"baseUrl\":\"http://${HOST}:${PORT}\"" "${CAPTURE_DIR}/admin-dashboard-proof.run-code.js"
grep -q "\"appId\":\"e2e-app-123\"" "${CAPTURE_DIR}/admin-dashboard-proof.run-code.js"
grep -q "\"artifactDir\":\"${ARTIFACT_DIR}\"" "${CAPTURE_DIR}/admin-dashboard-proof.run-code.js"
grep -q "noWaitAfter: true" "${CAPTURE_DIR}/admin-dashboard-proof.run-code.js"
grep -q "waitForLoadState(\"domcontentloaded\"" "${CAPTURE_DIR}/admin-dashboard-proof.run-code.js"

READY_BIN_DIR="$(mktemp -d)"
trap '[[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" >/dev/null 2>&1 || true; rm -rf "${CAPTURE_DIR}" "${ARTIFACT_DIR}" "${ENV_CAPTURE}" "${READY_BIN_DIR}"' EXIT

cat > "${READY_BIN_DIR}/curl" <<'EOF_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf 'Operations overview\n'
EOF_CURL
chmod +x "${READY_BIN_DIR}/curl"

DEFAULT_READY_ENV_CAPTURE="$(mktemp)"
trap '[[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" >/dev/null 2>&1 || true; rm -rf "${CAPTURE_DIR}" "${ARTIFACT_DIR}" "${ENV_CAPTURE}" "${READY_BIN_DIR}" "${DEFAULT_READY_ENV_CAPTURE}"' EXIT

PATH="${READY_BIN_DIR}:/usr/bin:/bin" \
ADMIN_DASHBOARD_START_COMMAND="${FAKE_START_SCRIPT}" \
ADMIN_DASHBOARD_ENV_CAPTURE="${DEFAULT_READY_ENV_CAPTURE}" \
ADMIN_DASHBOARD_PORT="${PORT}" \
ADMIN_DASHBOARD_HOST="${HOST}" \
ADMIN_DASHBOARD_ARTIFACT_DIR="${ARTIFACT_DIR}" \
ADMIN_DASHBOARD_FIXTURE_PATH="${ROOT_DIR}/fiber-link-service/apps/admin/fixtures/dashboard-proof.json" \
RUN_PLAYWRIGHT_SESSION_SCRIPT="${FAKE_RUNNER}" \
PW_TEST_CAPTURE_DIR="${CAPTURE_DIR}" \
  "${ROOT_DIR}/scripts/admin-dashboard-proof.sh"
