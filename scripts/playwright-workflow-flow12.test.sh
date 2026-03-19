#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
ARTIFACT_DIR="$(mktemp -d)"
CAPTURE_DIR="$(mktemp -d)"
trap 'rm -rf "${FAKE_BIN_DIR}" "${ARTIFACT_DIR}" "${CAPTURE_DIR}"' EXIT

cat > "${FAKE_BIN_DIR}/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "exec" ]]; then
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 1
EOF_DOCKER
chmod +x "${FAKE_BIN_DIR}/docker"

cat > "${FAKE_BIN_DIR}/fake-pwcli" <<'EOF_PWCLI'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF_PWCLI
chmod +x "${FAKE_BIN_DIR}/fake-pwcli"

cat > "${FAKE_BIN_DIR}/fake-run-playwright-session.sh" <<'EOF_RUNNER'
#!/usr/bin/env bash
set -euo pipefail

capture_dir="${PW_TEST_CAPTURE_DIR:?PW_TEST_CAPTURE_DIR is required}"
cp "${PW_RUN_CODE_FILE}" "${capture_dir}/playwright-flow12.run-code.js"
: > "${PW_OPEN_LOG}"
: > "${PW_RESULT_LOG}"
: > "${PW_CLOSE_LOG}"
EOF_RUNNER
chmod +x "${FAKE_BIN_DIR}/fake-run-playwright-session.sh"

PATH="${FAKE_BIN_DIR}:${PATH}" \
PWCLI="${FAKE_BIN_DIR}/fake-pwcli" \
RUN_PLAYWRIGHT_SESSION_SCRIPT="${FAKE_BIN_DIR}/fake-run-playwright-session.sh" \
PW_TEST_CAPTURE_DIR="${CAPTURE_DIR}" \
PW_FLOW12_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_FLOW12_URL="http://host.docker.internal:4200" \
PW_FLOW12_TOPIC_PATH="/t/fiber-link-local-workflow-topic/7" \
PW_FLOW12_HEADED=0 \
E2E_HOST_ACCESS_HOST="host.docker.internal" \
E2E_HOST_ACCESS_BASE_URL="http://172.17.0.1" \
PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER="discourse_dev" \
FNN2_RPC_PORT=9227 \
  "${ROOT_DIR}/scripts/playwright-workflow-flow12.sh"

grep -q '"baseUrl":"http://127.0.0.1:4200"' "${CAPTURE_DIR}/playwright-flow12.run-code.js"
grep -q '"payerRpcUrl":"http://172.17.0.1:9227"' "${CAPTURE_DIR}/playwright-flow12.run-code.js"
