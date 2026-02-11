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

for required in \
  "${COMPOSE_FILE}" \
  "${FNN_DOCKERFILE}" \
  "${FNN_ENTRYPOINT}" \
  "${RUNBOOK_FILE}" \
  "${ENV_FILE}" \
  "${RPC_DOCKERFILE}" \
  "${WORKER_DOCKERFILE}" \
  "${DB_INIT_SQL}"; do
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

if ! grep -q "FIBER_RPC_URL=http://fnn:8227" "${ENV_FILE}"; then
  echo ".env.example missing FIBER_RPC_URL default to fnn service" >&2
  exit 1
fi

if ! grep -Eq "exec ./fnn -c .* -d .*" "${FNN_ENTRYPOINT}"; then
  echo "fnn entrypoint missing canonical startup command" >&2
  exit 1
fi

echo "compose-reference checks passed"
