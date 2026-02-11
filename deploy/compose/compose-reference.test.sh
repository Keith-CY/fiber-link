#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
FNN_DOCKERFILE="${ROOT_DIR}/deploy/compose/fnn/Dockerfile"
FNN_ENTRYPOINT="${ROOT_DIR}/deploy/compose/fnn/entrypoint.sh"
RUNBOOK_FILE="${ROOT_DIR}/docs/runbooks/compose-reference.md"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env.example"
RPC_DOCKERFILE="${ROOT_DIR}/deploy/compose/service-rpc.Dockerfile"
WORKER_DOCKERFILE="${ROOT_DIR}/deploy/compose/service-worker.Dockerfile"
DB_INIT_SQL="${ROOT_DIR}/deploy/compose/postgres/init/001_schema.sql"
GITIGNORE_FILE="${ROOT_DIR}/.gitignore"

for required in \
  "${COMPOSE_FILE}" \
  "${FNN_DOCKERFILE}" \
  "${FNN_ENTRYPOINT}" \
  "${RUNBOOK_FILE}" \
  "${ENV_FILE}" \
  "${RPC_DOCKERFILE}" \
  "${WORKER_DOCKERFILE}" \
  "${DB_INIT_SQL}" \
  "${GITIGNORE_FILE}"; do
  if [[ ! -f "${required}" ]]; then
    echo "missing required file: ${required}" >&2
    exit 1
  fi
done

for service in rpc worker postgres redis fnn; do
  if ! grep -Eq "^[[:space:]]{2}${service}:" "${COMPOSE_FILE}"; then
    echo "docker compose missing service: ${service}" >&2
    exit 1
  fi
done

if ! grep -q "^FIBER_RPC_URL=http://fnn:8227$" "${ENV_FILE}"; then
  echo ".env.example missing FIBER_RPC_URL default to fnn service" >&2
  exit 1
fi

if ! grep -q "^FNN_ASSET_SHA256=" "${ENV_FILE}"; then
  echo ".env.example missing FNN_ASSET_SHA256 placeholder" >&2
  exit 1
fi

if ! grep -q "^WORKER_SHUTDOWN_TIMEOUT_MS=" "${ENV_FILE}"; then
  echo ".env.example missing WORKER_SHUTDOWN_TIMEOUT_MS default" >&2
  exit 1
fi

if ! grep -q "^deploy/compose/.env$" "${GITIGNORE_FILE}"; then
  echo ".gitignore missing deploy/compose/.env ignore rule" >&2
  exit 1
fi

if ! grep -q "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}" "${COMPOSE_FILE}"; then
  echo "docker-compose missing required POSTGRES_PASSWORD guard" >&2
  exit 1
fi

if ! grep -q "FIBER_LINK_HMAC_SECRET: \${FIBER_LINK_HMAC_SECRET:?Set FIBER_LINK_HMAC_SECRET in .env}" "${COMPOSE_FILE}"; then
  echo "docker-compose missing required FIBER_LINK_HMAC_SECRET guard" >&2
  exit 1
fi

if ! grep -q "^ARG FNN_ASSET_SHA256=" "${FNN_DOCKERFILE}"; then
  echo "fnn Dockerfile missing FNN_ASSET_SHA256 build arg" >&2
  exit 1
fi

if ! grep -q "sha256sum --check" "${FNN_DOCKERFILE}"; then
  echo "fnn Dockerfile missing SHA256 verification step" >&2
  exit 1
fi

if ! grep -Eq "exec ./fnn -c .* -d .*" "${FNN_ENTRYPOINT}"; then
  echo "fnn entrypoint missing canonical startup command" >&2
  exit 1
fi

echo "compose-reference checks passed"
