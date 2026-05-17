#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATOR="${ROOT_DIR}/deploy/compose/validate-env.sh"
ENV_EXAMPLE="${ROOT_DIR}/deploy/compose/.env.example"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

VALID_ENV="${TMP_DIR}/valid.env"
cp "${ENV_EXAMPLE}" "${VALID_ENV}"

set_env() {
  local key="$1" value="$2" file="${3:-${VALID_ENV}}"
  python3 - "$file" "$key" "$value" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines()
for idx, line in enumerate(lines):
    if line.startswith(f"{key}="):
        lines[idx] = f"{key}={value}"
        break
else:
    lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
PY
}

set_env POSTGRES_PASSWORD 'strong-postgres-password'
set_env FIBER_SECRET_KEY_PASSWORD 'strong-fnn-password'
set_env FIBER_LINK_HMAC_SECRET '0123456789abcdef0123456789abcdef'
set_env FNN_ASSET_SHA256 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

"${VALIDATOR}" "${VALID_ENV}" >/dev/null

expect_fail() {
  local label="$1" key="$2" value="$3"
  local env_file="${TMP_DIR}/${label}.env"
  cp "${VALID_ENV}" "${env_file}"
  set_env "${key}" "${value}" "${env_file}"
  if "${VALIDATOR}" "${env_file}" >"${TMP_DIR}/${label}.out" 2>&1; then
    echo "expected validation failure for ${label}" >&2
    exit 1
  fi
}

expect_fail placeholder-secret POSTGRES_PASSWORD 'change-me-before-prod'
expect_fail short-hmac FIBER_LINK_HMAC_SECRET 'too-short'
expect_fail placeholder-sha FNN_ASSET_SHA256 'replace-with-release-sha256'
expect_fail malformed-sha FNN_ASSET_SHA256 'not-a-sha'
expect_fail malformed-url FIBER_CHANNEL_ACCEPT_RPC_URL 'fnn2:8227'
expect_fail bad-port FNN2_RPC_PORT '70000'
expect_fail bad-number WORKER_SETTLEMENT_BATCH_SIZE '0'

echo "compose env validation checks passed"
