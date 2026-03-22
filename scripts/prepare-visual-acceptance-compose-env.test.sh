#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ENV_FILE="$(mktemp)"
OUTPUT_ENV_FILE="$(mktemp)"
trap 'rm -f "${SOURCE_ENV_FILE}" "${OUTPUT_ENV_FILE}"' EXIT

cat > "${SOURCE_ENV_FILE}" <<'EOF_ENV'
POSTGRES_PASSWORD=change-me-before-prod
POSTGRES_IMAGE=public.ecr.aws/docker/library/postgres:16-alpine
REDIS_IMAGE=public.ecr.aws/docker/library/redis:7-alpine
FNN_VERSION=v0.6.1
FNN_ASSET=fnn_v0.6.1-x86_64-linux-portable.tar.gz
FNN_ASSET_SHA256=replace-with-release-sha256
FIBER_SECRET_KEY_PASSWORD=change-me-before-prod
FIBER_LINK_HMAC_SECRET=change-me-before-prod
EOF_ENV

VISUAL_ACCEPTANCE_POSTGRES_IMAGE=mirror.gcr.io/library/postgres:16-alpine \
VISUAL_ACCEPTANCE_REDIS_IMAGE=mirror.gcr.io/library/redis:7-alpine \
VISUAL_ACCEPTANCE_FNN_ASSET_SHA256=8f9a69361f662438fa1fc29ddc668192810b13021536ebd1101c84dc0cfa330f \
  "${ROOT_DIR}/scripts/prepare-visual-acceptance-compose-env.sh" \
  --source "${SOURCE_ENV_FILE}" \
  --output "${OUTPUT_ENV_FILE}" \
  > /dev/null

grep -q '^POSTGRES_PASSWORD=visual-acceptance-postgres-password$' "${OUTPUT_ENV_FILE}"
grep -q '^POSTGRES_IMAGE=mirror.gcr.io/library/postgres:16-alpine$' "${OUTPUT_ENV_FILE}"
grep -q '^REDIS_IMAGE=mirror.gcr.io/library/redis:7-alpine$' "${OUTPUT_ENV_FILE}"
grep -q '^FIBER_SECRET_KEY_PASSWORD=visual-acceptance-fiber-secret-password$' "${OUTPUT_ENV_FILE}"
grep -q '^FIBER_LINK_HMAC_SECRET=visual-acceptance-hmac-secret$' "${OUTPUT_ENV_FILE}"
grep -q '^FNN_ASSET_SHA256=8f9a69361f662438fa1fc29ddc668192810b13021536ebd1101c84dc0cfa330f$' "${OUTPUT_ENV_FILE}"
grep -q '^FNN_ASSET_SHA256=replace-with-release-sha256$' "${SOURCE_ENV_FILE}"
