#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${DISCOURSE_UI_BASE_URL:-http://127.0.0.1:3000}"
TIMEOUT_SECONDS="${DISCOURSE_UI_READY_TIMEOUT_SECONDS:-180}"
POLL_INTERVAL_SECONDS="${DISCOURSE_UI_READY_POLL_INTERVAL_SECONDS:-2}"
PORT="${DISCOURSE_UI_PORT:-3000}"

log() {
  printf '[discourse-web-ready] %s\n' "$*"
}

check_ready() {
  local body
  body="$(curl -fsS -m 3 "${BASE_URL%/}/login" 2>/dev/null)" || return 1
  if printf '%s' "${body}" | grep -q "Ember CLI is Required in Development Mode"; then
    return 1
  fi
  return 0
}

if check_ready; then
  log "already ready at ${BASE_URL%/}/login"
  exit 0
fi

docker inspect discourse_dev >/dev/null 2>&1 || {
  log "container discourse_dev is not running"
  exit 10
}

log "starting discourse web server on port ${PORT}"
docker exec -u discourse:discourse -w /src discourse_dev sh -lc \
  "pkill -f '/src/bin/unicorn -c /src/config/unicorn.conf.rb -p ${PORT}' >/dev/null 2>&1 || pkill -f 'bin/unicorn -p ${PORT}' >/dev/null 2>&1 || true; cd /src && nohup env ALLOW_EMBER_CLI_PROXY_BYPASS=1 /src/bin/unicorn -c /src/config/unicorn.conf.rb -p ${PORT} > /tmp/unicorn.log 2>&1 &" >/dev/null

started_at="$(date +%s)"
while true; do
  if check_ready; then
    log "ready at ${BASE_URL%/}/login"
    exit 0
  fi

  now="$(date +%s)"
  if (( now - started_at >= TIMEOUT_SECONDS )); then
    log "timeout waiting for ${BASE_URL%/}/login"
    docker exec discourse_dev sh -lc "tail -n 80 /tmp/unicorn.log || true" || true
    exit 11
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done
