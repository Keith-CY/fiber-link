#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/deploy/compose"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
ENV_FILE="${COMPOSE_ENV_FILE:-${ENV_FILE:-${COMPOSE_DIR}/.env}}"
OUTPUT_PATH=""

for arg in "$@"; do
  case "${arg}" in
    --output=*)
      OUTPUT_PATH="${arg#--output=}"
      ;;
    *)
      echo "unknown argument: ${arg}" >&2
      echo "usage: deploy/compose/compose-ops-summary.sh [--output=/path/to/ops-summary.json]" >&2
      exit 1
      ;;
  esac
done

cd "${COMPOSE_DIR}"

if [[ -n "${OUTPUT_PATH}" ]]; then
  mkdir -p "$(dirname "${OUTPUT_PATH}")"
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T worker bun run apps/worker/src/scripts/ops-summary.ts | tee "${OUTPUT_PATH}"
else
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T worker bun run apps/worker/src/scripts/ops-summary.ts
fi
