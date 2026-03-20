#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
ARTIFACT_DIR="$(mktemp -d)"
CAPTURE_DIR="$(mktemp -d)"
trap 'rm -rf "${FAKE_BIN_DIR}" "${ARTIFACT_DIR}" "${CAPTURE_DIR}"' EXIT

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
cp "${PW_RUN_CODE_FILE}" "${capture_dir}/playwright-explorer.run-code.js"
printf '%s\n' "${PW_OPEN_URL}" > "${capture_dir}/open-url.txt"
: > "${PW_OPEN_LOG}"
: > "${PW_RESULT_LOG}"
: > "${PW_CLOSE_LOG}"
EOF_RUNNER
chmod +x "${FAKE_BIN_DIR}/fake-run-playwright-session.sh"

PWCLI="${FAKE_BIN_DIR}/fake-pwcli" \
RUN_PLAYWRIGHT_SESSION_SCRIPT="${FAKE_BIN_DIR}/fake-run-playwright-session.sh" \
PW_TEST_CAPTURE_DIR="${CAPTURE_DIR}" \
PW_EXPLORER_ARTIFACT_DIR="${ARTIFACT_DIR}" \
PW_EXPLORER_TX_HASH="0xabc123" \
PW_EXPLORER_TX_URL_TEMPLATE="https://pudge.explorer.nervos.org/transaction/{txHash}" \
  "${ROOT_DIR}/scripts/playwright-workflow-explorer-proof.sh"

grep -q 'https://pudge.explorer.nervos.org/transaction/0xabc123' "${CAPTURE_DIR}/open-url.txt"
grep -q '"txHash":"0xabc123"' "${CAPTURE_DIR}/playwright-explorer.run-code.js"
