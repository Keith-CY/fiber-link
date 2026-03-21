#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS_WRAPPER="${ROOT_DIR}/deploy/compose/compose-ops-summary.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

FAKE_BIN="${TMP_DIR}/fake-bin"
mkdir -p "${FAKE_BIN}"
FAKE_LOG="${TMP_DIR}/fake-docker.log"
CUSTOM_ENV_FILE="${TMP_DIR}/runtime-compose.env"
touch "${CUSTOM_ENV_FILE}"

cat > "${FAKE_BIN}/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG}"
printf '{"status":"ok"}\n'
EOF_DOCKER
chmod +x "${FAKE_BIN}/docker"

PATH="${FAKE_BIN}:${PATH}" \
FAKE_DOCKER_LOG="${FAKE_LOG}" \
COMPOSE_ENV_FILE="${CUSTOM_ENV_FILE}" \
  "${OPS_WRAPPER}" > /dev/null

grep -Fq -- "--env-file ${CUSTOM_ENV_FILE}" "${FAKE_LOG}"
