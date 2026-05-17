#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
READINESS_SCRIPT="${ROOT_DIR}/deploy/compose/compose-readiness.sh"
SMOKE_SCRIPT="${ROOT_DIR}/scripts/testnet-smoke.sh"

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq -- "${needle}" "${file}"; then
    echo "expected ${file} to contain: ${needle}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local needle="$1"
  local file="$2"
  if grep -Fq -- "${needle}" "${file}"; then
    echo "expected ${file} not to contain: ${needle}" >&2
    exit 1
  fi
}

assert_contains '--destroy-volumes' "${READINESS_SCRIPT}"
assert_contains 'FIBER_LINK_DESTROY_VOLUMES=1' "${READINESS_SCRIPT}"
assert_contains 'fiber-link-readiness-' "${READINESS_SCRIPT}"
assert_contains 'WARNING: destructive compose volume cleanup is enabled.' "${READINESS_SCRIPT}"
assert_contains 'Target compose project: ${COMPOSE_PROJECT_NAME}' "${READINESS_SCRIPT}"
assert_contains 'Env file: ${ENV_FILE}' "${READINESS_SCRIPT}"
assert_contains 'COMPOSE_DOWN_ARGS="--remove-orphans"' "${READINESS_SCRIPT}"
assert_contains 'COMPOSE_DOWN_ARGS="${COMPOSE_DOWN_ARGS} --volumes"' "${READINESS_SCRIPT}"
assert_not_contains 'down --remove-orphans --volumes' "${READINESS_SCRIPT}"

assert_contains '--destroy-volumes' "${SMOKE_SCRIPT}"
assert_contains 'FIBER_LINK_DESTROY_VOLUMES=1' "${SMOKE_SCRIPT}"
assert_contains 'fiber-link-smoke-' "${SMOKE_SCRIPT}"
assert_contains 'WARNING: destructive compose volume cleanup is enabled.' "${SMOKE_SCRIPT}"
assert_contains 'Target compose project: ${COMPOSE_PROJECT_NAME}' "${SMOKE_SCRIPT}"
assert_contains 'Env file: ${ENV_FILE}' "${SMOKE_SCRIPT}"
assert_contains 'local args=(down --remove-orphans)' "${SMOKE_SCRIPT}"
assert_contains 'args+=(--volumes)' "${SMOKE_SCRIPT}"
assert_not_contains 'compose down -v --remove-orphans' "${SMOKE_SCRIPT}"
assert_not_contains 'docker compose down -v --remove-orphans' "${SMOKE_SCRIPT}"

"${READINESS_SCRIPT}" --help | grep -Fq -- '--destroy-volumes'
"${SMOKE_SCRIPT}" --help | grep -Fq -- '--destroy-volumes'
