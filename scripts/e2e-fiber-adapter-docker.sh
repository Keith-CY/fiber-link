#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-240}"
POSTGRES_PORT="${POSTGRES_PORT:-15432}"
REDIS_PORT="${REDIS_PORT:-16379}"
RPC_PORT="${RPC_PORT:-13000}"
FNN_RPC_PORT="${FNN_RPC_PORT:-18227}"
FNN_P2P_PORT="${FNN_P2P_PORT:-18228}"

log() {
  printf '[fiber-adapter-e2e] %s\n' "$*"
}

compose() {
  (
    cd "${ROOT_DIR}" && \
      POSTGRES_PORT="${POSTGRES_PORT}" \
      REDIS_PORT="${REDIS_PORT}" \
      RPC_PORT="${RPC_PORT}" \
      FNN_RPC_PORT="${FNN_RPC_PORT}" \
      FNN_P2P_PORT="${FNN_P2P_PORT}" \
      docker compose -f "${COMPOSE_FILE}" "$@"
  )
}

get_container_state() {
  local container="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "${container}" 2>/dev/null || true
}

wait_healthy() {
  local container="$1"
  local deadline
  deadline=$(( $(date +%s) + WAIT_TIMEOUT_SECONDS ))

  while true; do
    local health
    local status
    health="$(docker inspect --format '{{json .State.Health}}' "${container}" 2>/dev/null || true)"

    if [[ "${health}" == "null" ]]; then
      status="$(get_container_state "${container}")"
      if [[ "${status}" == "running" ]]; then
        log "${container} is ${status}"
        return 0
      fi
    else
      status="$(get_container_state "${container}")"
      if [[ "${status}" == "healthy" ]]; then
        log "${container} is ${status}"
        return 0
      fi
    fi

    if [[ "$(date +%s)" -ge "${deadline}" ]]; then
      log "timeout waiting for ${container} to become healthy"
      return 1
    fi

    sleep 3
  done
}

log "starting compose services"
log "host ports postgres=${POSTGRES_PORT} redis=${REDIS_PORT} fnn_rpc=${FNN_RPC_PORT} fnn_p2p=${FNN_P2P_PORT} rpc=${RPC_PORT}"
compose up -d --build postgres redis fnn rpc

wait_healthy "fiber-link-postgres"
wait_healthy "fiber-link-redis"
wait_healthy "fiber-link-fnn"
wait_healthy "fiber-link-rpc"

log "running adapter e2e probe inside rpc container"
compose exec -T rpc bun run apps/rpc/src/scripts/fiber-adapter-e2e.ts

log "PASS"
