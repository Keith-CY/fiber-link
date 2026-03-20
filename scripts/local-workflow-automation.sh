#!/usr/bin/env bash
set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_PRECHECK=10
EXIT_DISCOURSE=11
EXIT_TIP=12
EXIT_SETTLEMENT=13
EXIT_BALANCE=14
EXIT_WITHDRAWAL=15

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-${ROOT_DIR}/deploy/compose/.env}"
DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
DISCOURSE_CONTAINER_TMPDIR="${DISCOURSE_CONTAINER_TMPDIR:-/src/tmp/fiber-link-visual-acceptance}"
DISCOURSE_REF="${DISCOURSE_REF:-26f3e2aa87a3abb35849183e0740fe7ab84cec67}"
DISCOURSE_DEV_UID_GID="${DISCOURSE_DEV_UID_GID:-1000:1000}"
DEFAULT_ARTIFACT_DIR="${ROOT_DIR}/.tmp/local-workflow-automation/$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR="${WORKFLOW_ARTIFACT_DIR:-${DEFAULT_ARTIFACT_DIR}}"
RESULT_METADATA_PATH="${WORKFLOW_RESULT_METADATA_PATH:-${ARTIFACT_DIR}/result.env}"
HOST_ACCESS_HOST="${E2E_HOST_ACCESS_HOST:-127.0.0.1}"
HOST_ACCESS_BASE_URL="${E2E_HOST_ACCESS_BASE_URL:-http://${HOST_ACCESS_HOST}}"
CURRENT_STEP="initializing"
WORKFLOW_COMPLETED=0

VERBOSE=0
SKIP_SERVICES=0
SKIP_DISCOURSE=0
SKIP_WITHDRAWAL=0
PAUSE_AT_STEP4=0
START_EMBER_CLI=0
PAUSE_START_EMBER_CLI="${WORKFLOW_PAUSE_START_EMBER_CLI:-1}"
PREPARE_ONLY=0

WORKFLOW_ASSET="${WORKFLOW_ASSET:-CKB}"
TIP_AMOUNT="${WORKFLOW_TIP_AMOUNT:-31}"
WITHDRAW_AMOUNT="${WORKFLOW_WITHDRAW_AMOUNT:-61}"
WITHDRAW_TO_ADDRESS="${WORKFLOW_WITHDRAW_TO_ADDRESS:-}"
POLL_INTERVAL_SECONDS="${WORKFLOW_POLL_INTERVAL_SECONDS:-5}"
SETTLEMENT_TIMEOUT_SECONDS="${WORKFLOW_SETTLEMENT_TIMEOUT_SECONDS:-240}"
WITHDRAWAL_TIMEOUT_SECONDS="${WORKFLOW_WITHDRAWAL_TIMEOUT_SECONDS:-360}"

TOPIC_LABEL="${WORKFLOW_TOPIC_TITLE:-Fiber Link Local Workflow Topic}"
TOPIC_BODY="${WORKFLOW_TOPIC_BODY:-This topic is created by local workflow automation.}"
REPLY_BODY="${WORKFLOW_REPLY_BODY:-This reply is created by local workflow automation.}"

usage() {
  cat <<'EOF'
Usage: scripts/local-workflow-automation.sh [--verbose] [--skip-services] [--skip-discourse] [--skip-withdrawal] [--pause-at-step4] [--prepare-only] [--with-ember-cli]

Automates local workflow:
1) launch discourse
2) launch fiber link services (dual FNN + channel bootstrap)
3) install discourse plugin + configure settings
4) tip topic post and reply post
5) check author balance via dashboard.summary
6) request withdrawal and wait for completion

Options:
  --verbose         Print detailed logs.
  --skip-services   Skip services/bootstrap step (assume already running and ready).
  --skip-discourse  Skip discourse bootstrap/seeding step (assume IDs provided through env).
  --skip-withdrawal Skip step 6 backend withdrawal request (useful when browser will initiate it).
  --pause-at-step4  Pause before tip actions and wait for Enter.
  --prepare-only    Exit after steps 1-3 and optional browser preparation.
  --with-ember-cli  Start Ember CLI proxy and expose interactive UI at http://127.0.0.1:4200/login.
  -h, --help        Show this help message.

Environment knobs:
  WORKFLOW_ARTIFACT_DIR=/abs/path/to/artifacts
  WORKFLOW_RESULT_METADATA_PATH=/abs/path/to/result.env
  WORKFLOW_ASSET=CKB
  WORKFLOW_TIP_AMOUNT=31
  WORKFLOW_WITHDRAW_AMOUNT=61
  WORKFLOW_WITHDRAW_TO_ADDRESS=ckt1...
  WORKFLOW_POLL_INTERVAL_SECONDS=5
  WORKFLOW_SETTLEMENT_TIMEOUT_SECONDS=240
  WORKFLOW_WITHDRAWAL_TIMEOUT_SECONDS=360
  WORKFLOW_PAUSE_START_EMBER_CLI=1
  DISCOURSE_DEV_ROOT=/tmp/discourse-dev
  DISCOURSE_REF=26f3e2aa87a3abb35849183e0740fe7ab84cec67

When --skip-discourse is used, these are required:
  WORKFLOW_TIPPER_USER_ID
  WORKFLOW_AUTHOR_USER_ID
  WORKFLOW_TOPIC_POST_ID
  WORKFLOW_REPLY_POST_ID
EOF
}

log() {
  printf '[local-workflow] %s\n' "$*"
}

vlog() {
  if [[ "${VERBOSE}" -eq 1 ]]; then
    log "$*"
  fi
}

write_result_metadata() {
  local status="$1"
  local code="$2"
  local message="${3:-}"
  local summary_path="${4:-}"
  local seed_json_path="${ARTIFACT_DIR}/discourse-seed.json"

  mkdir -p "${ARTIFACT_DIR}" >/dev/null 2>&1 || true
  {
    printf 'WORKFLOW_RESULT_STATUS=%q\n' "${status}"
    printf 'WORKFLOW_RESULT_CODE=%q\n' "${code}"
    printf 'WORKFLOW_RESULT_MESSAGE=%q\n' "${message}"
    printf 'WORKFLOW_RESULT_ARTIFACT_DIR=%q\n' "${ARTIFACT_DIR}"
    printf 'WORKFLOW_RESULT_SUMMARY_PATH=%q\n' "${summary_path}"
    printf 'WORKFLOW_RESULT_SEED_JSON_PATH=%q\n' "${seed_json_path}"
  } > "${RESULT_METADATA_PATH}"
}

fatal() {
  local code="$1"
  shift
  write_result_metadata "FAIL" "${code}" "$*" "" || true
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s ARTIFACT_DIR=%s\n' "${code}" "$*" "${ARTIFACT_DIR}"
  exit "${code}"
}

on_exit() {
  local rc="$?"
  if [[ "${WORKFLOW_COMPLETED}" -eq 1 || "${rc}" -eq 0 ]]; then
    return 0
  fi

  local message="workflow aborted during ${CURRENT_STEP}"
  write_result_metadata "FAIL" "${rc}" "${message}" "" || true
  log "${message} (exit=${rc})"
  printf 'RESULT=FAIL CODE=%s MESSAGE=%s ARTIFACT_DIR=%s\n' "${rc}" "${message}" "${ARTIFACT_DIR}"
}

trap on_exit EXIT

require_cmd() {
  local name="$1"
  command -v "${name}" >/dev/null 2>&1 || fatal "${EXIT_PRECHECK}" "missing required command: ${name}"
}

get_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${COMPOSE_ENV_FILE}" | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    printf ''
    return
  fi
  printf '%s' "${line#*=}"
}

to_hex_quantity() {
  local amount="$1"
  if ! [[ "${amount}" =~ ^[0-9]+$ ]]; then
    fatal "${EXIT_PRECHECK}" "amount must be a positive integer, got '${amount}'"
  fi
  printf '0x%x' "${amount}"
}

contains_jsonrpc_error() {
  local payload="$1"
  printf '%s' "${payload}" | jq -e 'has("error") and .error != null' >/dev/null 2>&1
}

jsonrpc_error_message() {
  local payload="$1"
  printf '%s' "${payload}" | jq -r '.error.message // "unknown json-rpc error"'
}

sign_payload() {
  local payload="$1"
  local ts="$2"
  local nonce="$3"
  printf '%s' "${ts}.${nonce}.${payload}" \
    | openssl dgst -sha256 -hmac "${APP_SECRET}" -hex \
    | awk '{print $2}'
}

wait_http_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local started now
  started="$(date +%s)"

  while true; do
    if curl -fsS -m 3 "${url}" >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      return 1
    fi

    sleep 2
  done
}

wait_discourse_ui_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local started now
  started="$(date +%s)"

  while true; do
    if curl -fsS -m 5 "${url}" >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      return 1
    fi

    sleep 2
  done
}

wait_discourse_ui_ready_in_container() {
  local timeout_seconds="$1"
  local started now
  started="$(date +%s)"

  while true; do
    if docker exec discourse_dev sh -lc 'curl -fsS -m 5 http://127.0.0.1:4200/login >/dev/null' >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      return 1
    fi

    sleep 2
  done
}

wait_discourse_backend_ready_in_container() {
  local timeout_seconds="$1"
  local started now
  started="$(date +%s)"

  while true; do
    if docker exec discourse_dev sh -lc 'curl -fsS -m 5 http://127.0.0.1:9292/session/csrf.json >/dev/null' >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      return 1
    fi

    sleep 2
  done
}

docker_host_port_for() {
  local container="$1"
  local internal_port="$2"
  docker port "${container}" "${internal_port}/tcp" 2>/dev/null | awk -F: 'NR==1 {print $NF}' || true
}

resolve_runtime_ports() {
  local rpc_probe_url="${HOST_ACCESS_BASE_URL}:${RPC_PORT}/healthz/ready"
  if ! wait_http_ready "${rpc_probe_url}" 8; then
    local detected_rpc_port
    detected_rpc_port="$(docker_host_port_for "fiber-link-rpc" "3000")"
    if [[ -n "${detected_rpc_port}" && "${detected_rpc_port}" != "${RPC_PORT}" ]]; then
      log "rpc port mismatch: configured=${RPC_PORT}, detected running container host port=${detected_rpc_port}; using detected value"
      RPC_PORT="${detected_rpc_port}"
    fi
  fi

  rpc_probe_url="${HOST_ACCESS_BASE_URL}:${RPC_PORT}/healthz/ready"
  wait_http_ready "${rpc_probe_url}" 30 \
    || fatal "${EXIT_PRECHECK}" "rpc endpoint is not ready at ${rpc_probe_url}"

  local fnn_probe_url="${HOST_ACCESS_BASE_URL}:${FNN2_RPC_PORT}"
  if ! wait_http_ready "${fnn_probe_url}" 8; then
    local detected_fnn2_port
    detected_fnn2_port="$(docker_host_port_for "fiber-link-fnn2" "8227")"
    if [[ -n "${detected_fnn2_port}" && "${detected_fnn2_port}" != "${FNN2_RPC_PORT}" ]]; then
      log "fnn2 rpc port mismatch: configured=${FNN2_RPC_PORT}, detected running container host port=${detected_fnn2_port}; using detected value"
      FNN2_RPC_PORT="${detected_fnn2_port}"
    fi
  fi
}

resolve_docker_host_gateway() {
  docker network inspect bridge 2>/dev/null \
    | jq -r '.[0].IPAM.Config[0].Gateway // empty' \
    | tr -d '\r'
}

docker_container_env_value() {
  local container="$1"
  local key="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${container}" 2>/dev/null \
    | awk -F= -v wanted_key="${key}" '$1 == wanted_key {print substr($0, length(wanted_key) + 2); exit}'
}

resolve_runtime_app_secret() {
  [[ "${SKIP_SERVICES}" -eq 1 ]] || return 0

  local runtime_secret
  runtime_secret="$(docker_container_env_value "fiber-link-rpc" "FIBER_LINK_HMAC_SECRET")"
  if [[ -z "${runtime_secret}" ]]; then
    return 0
  fi

  if [[ "${APP_SECRET}" != "${runtime_secret}" ]]; then
    log "detected running rpc secret mismatch under --skip-services; using runtime rpc secret"
  fi
  APP_SECRET="${runtime_secret}"
}

resolve_discourse_site_setting() {
  local key="$1"

  if ! docker ps --format '{{.Names}}' | grep -qx "discourse_dev"; then
    return 0
  fi

  docker exec -u discourse:discourse -w /src discourse_dev sh -lc \
    "RAILS_ENV=development bundle exec rails runner \"value = SiteSetting.public_send('${key}'); STDOUT.write(value.to_s) unless value.nil?\"" \
    2>/dev/null || true
}

resolve_workflow_app_id() {
  if [[ -n "${FIBER_LINK_APP_ID:-}" ]]; then
    printf '%s' "${FIBER_LINK_APP_ID}"
    return 0
  fi

  if [[ -n "${E2E_APP_ID:-}" ]]; then
    printf '%s' "${E2E_APP_ID}"
    return 0
  fi

  if [[ "${SKIP_DISCOURSE}" -eq 1 ]]; then
    local discourse_app_id
    discourse_app_id="$(resolve_discourse_site_setting "fiber_link_app_id")"
    if [[ -n "${discourse_app_id}" ]]; then
      printf '[local-workflow] detected discourse plugin app id under --skip-discourse; using %s\n' "${discourse_app_id}" >&2
      printf '%s' "${discourse_app_id}"
      return 0
    fi
  fi

  printf 'local-dev'
}

ensure_discourse_checkout() {
  if [[ ! -d "${DISCOURSE_DEV_ROOT}/.git" ]]; then
    mkdir -p "${DISCOURSE_DEV_ROOT}"
    (
      cd "${DISCOURSE_DEV_ROOT}"
      git init >/dev/null 2>&1
      git remote add origin https://github.com/discourse/discourse.git
    )
  fi

  (
    cd "${DISCOURSE_DEV_ROOT}"
    if ! git remote get-url origin >/dev/null 2>&1; then
      git remote add origin https://github.com/discourse/discourse.git
    fi
    git fetch --depth=1 origin "${DISCOURSE_REF}"
    git checkout --force FETCH_HEAD
  )
}

run_with_pseudo_tty() {
  if [[ $# -eq 0 ]]; then
    fatal "${EXIT_PRECHECK}" "run_with_pseudo_tty requires a command"
  fi

  if command -v script >/dev/null 2>&1; then
    if script -q /dev/null true >/dev/null 2>&1; then
      script -q /dev/null "$@"
      return 0
    fi

    local quoted_cmd=""
    local arg
    for arg in "$@"; do
      quoted_cmd+=" $(printf '%q' "${arg}")"
    done
    quoted_cmd="${quoted_cmd# }"

    if script -q -e -c "true" /dev/null >/dev/null 2>&1; then
      script -q -e -c "${quoted_cmd}" /dev/null
      return 0
    fi
  fi

  "$@"
}

ensure_discourse_checkout_permissions() {
  mkdir -p "${DISCOURSE_DEV_ROOT}/plugins" "${DISCOURSE_DEV_ROOT}/public" "${DISCOURSE_DEV_ROOT}/tmp"
  if ! chown -R "${DISCOURSE_DEV_UID_GID}" "${DISCOURSE_DEV_ROOT}" >/dev/null 2>&1; then
    vlog "host chown to ${DISCOURSE_DEV_UID_GID} is not permitted for ${DISCOURSE_DEV_ROOT}; relying on writable bind mount permissions instead"
  fi
  chmod -R a+rwX "${DISCOURSE_DEV_ROOT}"
}

configure_discourse_dev_allowed_hosts() {
  local requested_host="${E2E_HOST_ACCESS_HOST:-}"
  local requested_ui_url="${DISCOURSE_UI_BASE_URL:-}"
  local initializer_path="${DISCOURSE_DEV_ROOT}/config/initializers/099-fiber-link-visual-acceptance-hosts.rb"

  if [[ -n "${requested_ui_url}" ]]; then
    requested_host="${requested_ui_url#http://}"
    requested_host="${requested_host#https://}"
    requested_host="${requested_host%%/*}"
    requested_host="${requested_host%%:*}"
  fi

  if [[ -z "${requested_host}" || "${requested_host}" == "127.0.0.1" || "${requested_host}" == "localhost" ]]; then
    rm -f "${initializer_path}"
    return 0
  fi

  mkdir -p "${DISCOURSE_DEV_ROOT}/config/initializers"
  cat >"${initializer_path}" <<EOF
# frozen_string_literal: true

if defined?(Rails) && Rails.env.development?
  config_host = "${requested_host}"
  Rails.application.config.hosts << config_host unless Rails.application.config.hosts.include?(config_host)
end
EOF
}

repair_discourse_frontend_runtime() {
  local assets_log="${ARTIFACT_DIR}/discourse-assets-clobber.log"
  local constants_log="${ARTIFACT_DIR}/discourse-javascript-update-constants.log"

  log "refreshing discourse frontend runtime (assets:clobber + javascript:update_constants)"
  docker exec -u discourse:discourse -w /src discourse_dev sh -lc \
    'bin/rake assets:clobber' > "${assets_log}" 2>&1 || {
    tail -n 120 "${assets_log}" >&2 || true
    fatal "${EXIT_DISCOURSE}" "failed to clobber discourse assets (see ${assets_log})"
  }

  docker exec -u discourse:discourse -w /src discourse_dev sh -lc \
    'bin/rake javascript:update_constants' > "${constants_log}" 2>&1 || {
    tail -n 120 "${constants_log}" >&2 || true
    fatal "${EXIT_DISCOURSE}" "failed to refresh discourse javascript constants (see ${constants_log})"
  }

  docker exec discourse_dev sh -lc "
    pkill -f '[e]mber server --proxy http://127.0.0.1:9292' >/dev/null 2>&1 || true
    sv force-stop 'fiber-link-unicorn' >/dev/null 2>&1 || true
    rm -rf '/etc/service/fiber-link-unicorn' >/dev/null 2>&1 || true
    if [ -f '/src/tmp/pids/unicorn.pid' ]; then
      pid=\$(cat '/src/tmp/pids/unicorn.pid' 2>/dev/null || true)
      if [ -n \"\${pid}\" ] && kill -0 \"\${pid}\" 2>/dev/null; then
        kill -9 \"\${pid}\" >/dev/null 2>&1 || true
      fi
      rm -f '/src/tmp/pids/unicorn.pid' >/dev/null 2>&1 || true
    fi
    pkill -f '[u]nicorn master' >/dev/null 2>&1 || true
    pkill -f '[b]in/unicorn' >/dev/null 2>&1 || true
  " >/dev/null 2>&1 || true
}

sync_rpc_app_secret_record() {
  local pg_container="fiber-link-postgres"
  local pg_user="${POSTGRES_USER:-$(get_env_value POSTGRES_USER)}"
  local pg_db="${POSTGRES_DB:-$(get_env_value POSTGRES_DB)}"
  pg_user="${pg_user:-fiber}"
  pg_db="${pg_db:-fiber_link}"

  if ! docker ps --format '{{.Names}}' | grep -qx "${pg_container}"; then
    vlog "postgres container '${pg_container}' is not running; skip app secret sync"
    return 0
  fi

  local app_id_sql app_secret_sql upsert_sql
  app_id_sql="$(printf '%s' "${APP_ID}" | sed "s/'/''/g")"
  app_secret_sql="$(printf '%s' "${APP_SECRET}" | sed "s/'/''/g")"
  upsert_sql="INSERT INTO apps (app_id, hmac_secret) VALUES ('${app_id_sql}', '${app_secret_sql}') ON CONFLICT (app_id) DO UPDATE SET hmac_secret = EXCLUDED.hmac_secret;"

  if docker exec "${pg_container}" psql \
    -v ON_ERROR_STOP=1 \
    -U "${pg_user}" \
    -d "${pg_db}" \
    -c "${upsert_sql}" >/dev/null 2>&1; then
    vlog "synced rpc app secret row for app_id='${APP_ID}'"
    return 0
  fi

  log "warning: failed to sync rpc app secret row for app_id='${APP_ID}'"
  return 0
}

ensure_ember_cli_proxy() {
  local ember_url="${HOST_ACCESS_BASE_URL}:4200/login"
  local backend_ready_url="${HOST_ACCESS_BASE_URL}:9292/session/csrf.json"
  local ember_log="${ARTIFACT_DIR}/discourse-ember-cli.log"
  local ember_container_log="/tmp/fiber-link-discourse-ember-cli.log"
  local ember_service_dir="/etc/service/fiber-link-ember-cli"
  local ember_service_name="fiber-link-ember-cli"
  local ember_pattern='[b]in/ember-cli --host 0.0.0.0 --port 4200 --proxy http://127.0.0.1:9292'
  local ember_cmd='bin/ember-cli --host 0.0.0.0 --port 4200 --proxy http://127.0.0.1:9292'
  local ember_run_script
  ember_run_script="$(cat <<EOF
#!/bin/sh
exec chpst -u discourse:discourse env HOME=/home/discourse XDG_CONFIG_HOME=/home/discourse/.config PNPM_HOME=/home/discourse/.local/share/pnpm TMPDIR=${DISCOURSE_CONTAINER_TMPDIR} sh -lc 'rm -rf "\$TMPDIR" && mkdir -p "\$HOME/.local/share/pnpm" "\$XDG_CONFIG_HOME/pnpm" "\$TMPDIR" && cd /src && exec bin/ember-cli --host 0.0.0.0 --port 4200 --proxy http://127.0.0.1:9292 >> /tmp/fiber-link-discourse-ember-cli.log 2>&1'
EOF
)"

  sync_ember_cli_log() {
    docker exec discourse_dev sh -lc "cat '${ember_container_log}' 2>/dev/null || true" > "${ember_log}" 2>/dev/null || true
  }

  if wait_discourse_ui_ready "${ember_url}" 20 || wait_discourse_ui_ready_in_container 20; then
    sync_ember_cli_log
    log "ember-cli proxy already running (${ember_url})"
    return 0
  fi

  CURRENT_STEP="clearing previous ember proxy processes"
  docker exec discourse_dev sh -lc "
    pids=\$(ps -eo pid=,args= | grep -E '${ember_pattern}' | awk '{print \$1}')
    if [ -n \"\${pids}\" ]; then
      kill \${pids} >/dev/null 2>&1 || true
    fi
    sv force-stop '${ember_service_name}' >/dev/null 2>&1 || true
    rm -rf '${ember_service_dir}' >/dev/null 2>&1 || true
    rm -f '${ember_container_log}' >/dev/null 2>&1 || true
    rm -rf '${DISCOURSE_CONTAINER_TMPDIR}' >/dev/null 2>&1 || true
  "
  sleep 2

  CURRENT_STEP="starting detached ember proxy"
  log "starting ember-cli proxy (first compile can take a few minutes)"
  : > "${ember_log}"
  printf '%s' "${ember_run_script}" | docker exec -i discourse_dev sh -lc "
    mkdir -p '${ember_service_dir}' &&
    cat > '${ember_service_dir}/run' &&
    chmod +x '${ember_service_dir}/run' &&
    rm -f '${ember_service_dir}/down' &&
    sv start '${ember_service_name}' >/dev/null 2>&1 || true
  "
  vlog "ember-cli logs: ${ember_log}"

  CURRENT_STEP="waiting for ember proxy readiness"
  wait_discourse_ui_ready_in_container 600 \
    || {
      sync_ember_cli_log
      fatal "${EXIT_DISCOURSE}" "ember-cli proxy did not become ready inside discourse_dev (see ${ember_log})"
    }
  sync_ember_cli_log
  if ! wait_discourse_ui_ready "${ember_url}" 20; then
    log "warning: ember proxy is serving inside discourse_dev, but host UI is not reachable at ${ember_url}; continuing for sidecar-driven visual acceptance"
  fi
  if ! wait_http_ready "${backend_ready_url}" 180 && ! wait_discourse_backend_ready_in_container 30; then
    log "warning: discourse backend probe did not become ready at ${backend_ready_url}; continuing because ember proxy is already serving ${ember_url}"
  fi
}

ensure_discourse_backend_server() {
  local backend_url="http://127.0.0.1:9292/session/csrf.json"
  local backend_log="${ARTIFACT_DIR}/discourse-unicorn.log"
  local backend_container_log="/tmp/fiber-link-discourse-unicorn.log"
  local backend_service_dir="/etc/service/fiber-link-unicorn"
  local backend_service_name="fiber-link-unicorn"
  local unicorn_pattern='[/]src/bin/unicorn|[b]in/unicorn'
  local unicorn_pid_path="/src/tmp/pids/unicorn.pid"
  local unicorn_run_script
  unicorn_run_script="$(cat <<EOF
#!/bin/sh
exec chpst -u discourse:discourse env HOME=/home/discourse TMPDIR=${DISCOURSE_CONTAINER_TMPDIR} sh -lc 'mkdir -p "\$TMPDIR" && cd /src && exec env ALLOW_EMBER_CLI_PROXY_BYPASS=1 /src/bin/unicorn -c /src/config/unicorn.conf.rb >> ${backend_container_log} 2>&1'
EOF
)"

  sync_discourse_unicorn_log() {
    docker exec discourse_dev sh -lc "cat '${backend_container_log}' 2>/dev/null || true" > "${backend_log}" 2>/dev/null || true
  }

  cleanup_discourse_unicorn() {
    docker exec discourse_dev sh -lc "
      sv force-stop '${backend_service_name}' >/dev/null 2>&1 || true
      rm -rf '${backend_service_dir}' >/dev/null 2>&1 || true
      rm -f '${backend_container_log}' >/dev/null 2>&1 || true
      if [ -f '${unicorn_pid_path}' ]; then
        pid=\$(cat '${unicorn_pid_path}' 2>/dev/null || true)
        if [ -n \"\${pid}\" ] && kill -0 \"\${pid}\" 2>/dev/null; then
          kill -9 \"\${pid}\" >/dev/null 2>&1 || true
        fi
        rm -f '${unicorn_pid_path}' >/dev/null 2>&1 || true
      fi
      pkill -f '[u]nicorn master' >/dev/null 2>&1 || true
      pkill -f '${unicorn_pattern}' >/dev/null 2>&1 || true
    " >/dev/null 2>&1 || true
  }

  start_discourse_unicorn() {
    log "starting discourse unicorn backend"
    : > "${backend_log}"
    printf '%s' "${unicorn_run_script}" | docker exec -i discourse_dev sh -lc "
      mkdir -p '${backend_service_dir}' &&
      cat > '${backend_service_dir}/run' &&
      chmod +x '${backend_service_dir}/run' &&
      rm -f '${backend_service_dir}/down' &&
      sv start '${backend_service_name}' >/dev/null 2>&1 || true
    "
  }

  if docker exec discourse_dev sh -lc "pgrep -f '${unicorn_pattern}' >/dev/null 2>&1"; then
    if wait_discourse_backend_ready_in_container 20; then
      if docker exec discourse_dev sh -lc "curl -fsS -m 5 http://127.0.0.1:9292/login" 2>/dev/null | grep -q "Ember CLI is Required in Development Mode"; then
        log "discourse backend is running without proxy bypass; restarting with ALLOW_EMBER_CLI_PROXY_BYPASS=1"
      else
        vlog "discourse backend already running (${backend_url})"
        return 0
      fi
    fi

    log "discourse unicorn process exists but ${backend_url} is not ready; restarting backend"
    cleanup_discourse_unicorn
    sleep 2
  fi

  local attempt
  for attempt in 1 2; do
    start_discourse_unicorn
    if wait_discourse_backend_ready_in_container 120; then
      sync_discourse_unicorn_log
      return 0
    fi

    sync_discourse_unicorn_log
    if grep -q "Unicorn is already running!" "${backend_log}" 2>/dev/null; then
      log "discourse unicorn reported stale running state; cleaning up and retrying (attempt ${attempt}/2)"
      cleanup_discourse_unicorn
      sleep 2
      continue
    fi

    if (( attempt < 2 )); then
      log "discourse backend not ready after startup attempt ${attempt}; restarting unicorn"
      cleanup_discourse_unicorn
      sleep 2
    fi
  done

  sync_discourse_unicorn_log
  fatal "${EXIT_DISCOURSE}" "discourse backend did not become ready at ${backend_url} (see ${backend_log})"
}

ensure_discourse_playwright_runtime() {
  if [[ -n "${PLAYWRIGHT_CLI_DOCKER_IMAGE:-}" ]]; then
    vlog "skipping discourse Playwright runtime install because an external Playwright sidecar is configured (${PLAYWRIGHT_CLI_DOCKER_IMAGE})"
    return 0
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx "discourse_dev"; then
    return 0
  fi

  local runtime_artifact_dir="${ARTIFACT_DIR}/discourse-dev-runtime"
  mkdir -p "${runtime_artifact_dir}"
  DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT}" \
    DISCOURSE_DEV_RUNTIME_ARTIFACT_DIR="${runtime_artifact_dir}" \
    "${ROOT_DIR}/scripts/ensure-discourse-dev-runtime.sh" \
      --install-playwright \
      --no-backend \
      > "${runtime_artifact_dir}/ensure-playwright.log" 2>&1 || {
      tail -n 120 "${runtime_artifact_dir}/ensure-playwright.log" >&2 || true
      fatal "${EXIT_DISCOURSE}" "failed to prepare discourse Playwright runtime (see ${runtime_artifact_dir}/ensure-playwright.log)"
    }
}

ensure_discourse_container_source_mount() {
  local mounted_source=""
  if ! docker ps -a --format '{{.Names}}' | grep -qx "discourse_dev"; then
    return 0
  fi

  mounted_source="$(docker inspect discourse_dev --format '{{range .Mounts}}{{if eq .Destination "/src"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  if [[ -z "${mounted_source}" || "${mounted_source}" == "${DISCOURSE_DEV_ROOT}" ]]; then
    return 0
  fi

  log "discourse_dev is mounted from ${mounted_source}; recreating it for ${DISCOURSE_DEV_ROOT}"
  docker rm -f discourse_dev >/dev/null 2>&1 || true
}

rpc_call_signed() {
  local payload="$1"
  local nonce="$2"
  local ts sig
  ts="$(date +%s)"
  sig="$(sign_payload "${payload}" "${ts}" "${nonce}")"
  curl -fsS "${HOST_ACCESS_BASE_URL}:${RPC_PORT}/rpc" \
    -H "content-type: application/json" \
    -H "x-app-id: ${APP_ID}" \
    -H "x-ts: ${ts}" \
    -H "x-nonce: ${nonce}" \
    -H "x-signature: ${sig}" \
    -d "${payload}"
}

fnn_payer_rpc_call() {
  local payload="$1"
  curl -fsS "${HOST_ACCESS_BASE_URL}:${FNN2_RPC_PORT}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

derive_ckb_testnet_address_from_lock_args() {
  local lock_args="$1"
  python3 - "${lock_args}" <<'PY'
import sys

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

def hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def polymod(values):
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            if (top >> i) & 1:
                chk ^= GEN[i]
    return chk

def create_checksum(hrp, data):
    values = hrp_expand(hrp) + data
    polym = polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polym >> 5 * (5 - i)) & 31 for i in range(6)]

def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return ret

lock_args = sys.argv[1].strip()
if lock_args.startswith("0x"):
    lock_args = lock_args[2:]
if len(lock_args) != 40:
    raise SystemExit(1)

payload = bytes([0x01, 0x00]) + bytes.fromhex(lock_args)
data = convertbits(payload, 8, 5, True)
if data is None:
    raise SystemExit(1)

checksum = create_checksum("ckt", data)
addr = "ckt1" + "".join(CHARSET[d] for d in (data + checksum))
print(addr)
PY
}

resolve_withdraw_to_address() {
  if [[ -n "${WITHDRAW_TO_ADDRESS}" ]]; then
    printf '%s' "${WITHDRAW_TO_ADDRESS}"
    return 0
  fi

  local payload response lock_args
  payload='{"jsonrpc":"2.0","id":"withdraw-destination","method":"node_info","params":[]}'
  response="$(fnn_payer_rpc_call "${payload}")"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_WITHDRAWAL}" "node_info failed while deriving withdraw destination: $(jsonrpc_error_message "${response}")"
  fi

  lock_args="$(printf '%s' "${response}" | jq -r '.result.default_funding_lock_script.args // empty')"
  if [[ -z "${lock_args}" ]]; then
    fatal "${EXIT_WITHDRAWAL}" "node_info missing default_funding_lock_script.args"
  fi

  derive_ckb_testnet_address_from_lock_args "${lock_args}" \
    || fatal "${EXIT_WITHDRAWAL}" "failed to derive testnet CKB address from lock args"
}

currency_for_asset() {
  local asset="$1"
  if [[ "${asset}" != "CKB" ]]; then
    fatal "${EXIT_PRECHECK}" "WORKFLOW_ASSET currently supports only CKB"
  fi

  local scoped_key="FIBER_INVOICE_CURRENCY_CKB"
  local scoped_val="${!scoped_key:-}"
  if [[ -n "${scoped_val}" ]]; then
    printf '%s' "${scoped_val}"
    return
  fi

  local env_scoped
  env_scoped="$(get_env_value "${scoped_key}")"
  if [[ -n "${env_scoped}" ]]; then
    printf '%s' "${env_scoped}"
    return
  fi

  local global_env="${FIBER_INVOICE_CURRENCY:-}"
  if [[ -n "${global_env}" ]]; then
    printf '%s' "${global_env}"
    return
  fi

  printf 'Fibt'
}

create_tip_invoice() {
  local label="$1"
  local post_id="$2"
  local from_user_id="$3"
  local to_user_id="$4"
  local dir="${ARTIFACT_DIR}/tips/${label}"
  mkdir -p "${dir}"

  local payload
  payload="$(jq -cn \
    --arg id "tip-${label}-$(date +%s)-$RANDOM" \
    --arg postId "${post_id}" \
    --arg fromUserId "${from_user_id}" \
    --arg toUserId "${to_user_id}" \
    --arg asset "${WORKFLOW_ASSET}" \
    --arg amount "${TIP_AMOUNT}" \
    '{jsonrpc:"2.0",id:$id,method:"tip.create",params:{postId:$postId,fromUserId:$fromUserId,toUserId:$toUserId,asset:$asset,amount:$amount}}')"
  printf '%s\n' "${payload}" > "${dir}/tip-create.request.json"

  local response
  response="$(rpc_call_signed "${payload}" "tip-${label}-nonce-$(date +%s)-$RANDOM")"
  printf '%s\n' "${response}" > "${dir}/tip-create.response.json"
  if [[ -z "${response}" ]]; then
    fatal "${EXIT_TIP}" "tip.create returned empty HTTP body for ${label} (rpc_port=${RPC_PORT})"
  fi
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_TIP}" "tip.create failed for ${label}: $(jsonrpc_error_message "${response}")"
  fi

  local invoice
  invoice="$(printf '%s' "${response}" | jq -r '.result.invoice // empty')"
  if [[ -z "${invoice}" ]]; then
    fatal "${EXIT_TIP}" "tip.create returned empty invoice for ${label}"
  fi
  printf '%s' "${invoice}"
}

pay_invoice_from_payer() {
  local label="$1"
  local invoice="$2"
  local amount="$3"
  local dir="${ARTIFACT_DIR}/tips/${label}"

  local parse_payload parse_response payment_hash target_pubkey final_tlc_expiry_delta
  parse_payload="$(jq -cn --arg id "parse-${label}-$(date +%s)-$RANDOM" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"parse_invoice",params:[{invoice:$invoice}]}')"
  printf '%s\n' "${parse_payload}" > "${dir}/parse-invoice.request.json"

  parse_response="$(fnn_payer_rpc_call "${parse_payload}")"
  printf '%s\n' "${parse_response}" > "${dir}/parse-invoice.response.json"
  if contains_jsonrpc_error "${parse_response}"; then
    fatal "${EXIT_TIP}" "parse_invoice failed for ${label}: $(jsonrpc_error_message "${parse_response}")"
  fi

  payment_hash="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.payment_hash // empty')"
  target_pubkey="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .payee_public_key? // empty' | head -n1)"
  final_tlc_expiry_delta="$(printf '%s' "${parse_response}" | jq -r '.result.invoice.data.attrs[]? | .final_htlc_minimum_expiry_delta? // empty' | head -n1)"
  if [[ -z "${payment_hash}" ]]; then
    fatal "${EXIT_TIP}" "parse_invoice did not return payment_hash for ${label}"
  fi

  local send_payload send_response tx_hash amount_hex
  amount_hex="$(to_hex_quantity "${amount}")"
  send_payload="$(jq -cn \
    --arg id "send-${label}-$(date +%s)-$RANDOM" \
    --arg payment_hash "${payment_hash}" \
    --arg amount "${amount_hex}" \
    --arg currency "${CURRENCY}" \
    --arg request_id "local-workflow-${label}-$(date +%s)-$RANDOM" \
    --arg invoice "${invoice}" \
    --arg target_pubkey "${target_pubkey}" \
    --arg final_tlc_expiry_delta "${final_tlc_expiry_delta}" \
    '
      {
        jsonrpc:"2.0",
        id:$id,
        method:"send_payment",
        params:[
          (
            {
              payment_hash:$payment_hash,
              amount:$amount,
              currency:$currency,
              request_id:$request_id,
              invoice:$invoice,
              allow_self_payment:true
            }
            | if $target_pubkey != "" then . + {target_pubkey:$target_pubkey} else . end
            | if $final_tlc_expiry_delta != "" then . + {final_tlc_expiry_delta:$final_tlc_expiry_delta} else . end
          )
        ]
      }
    ')"
  printf '%s\n' "${send_payload}" > "${dir}/send-payment.request.json"

  send_response="$(fnn_payer_rpc_call "${send_payload}")"
  printf '%s\n' "${send_response}" > "${dir}/send-payment.response.json"
  if contains_jsonrpc_error "${send_response}"; then
    fatal "${EXIT_TIP}" "send_payment failed for ${label}: $(jsonrpc_error_message "${send_response}")"
  fi

  tx_hash="$(printf '%s' "${send_response}" | jq -r '.result.tx_hash // .result.txHash // .result.payment_hash // .result.paymentHash // .result.hash // empty')"
  if [[ -z "${tx_hash}" ]]; then
    fatal "${EXIT_TIP}" "send_payment returned no tx hash for ${label}"
  fi
  printf '%s' "${tx_hash}"
}

wait_tip_settled() {
  local label="$1"
  local invoice="$2"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))
  local attempt=0
  local dir="${ARTIFACT_DIR}/tips/${label}"
  local poll_log="${dir}/tip-status.poll.log"
  : > "${poll_log}"

  while [[ "$(date +%s)" -lt "${deadline}" ]]; do
    attempt=$((attempt + 1))
    local payload response state
    payload="$(jq -cn --arg id "status-${label}-${attempt}" --arg invoice "${invoice}" '{jsonrpc:"2.0",id:$id,method:"tip.status",params:{invoice:$invoice}}')"
    response="$(rpc_call_signed "${payload}" "tip-status-${label}-${attempt}-$(date +%s)")"
    printf '%s\n' "${response}" >> "${poll_log}"
    if contains_jsonrpc_error "${response}"; then
      fatal "${EXIT_SETTLEMENT}" "tip.status failed for ${label}: $(jsonrpc_error_message "${response}")"
    fi
    state="$(printf '%s' "${response}" | jq -r '.result.state // empty')"
    if [[ "${state}" == "SETTLED" ]]; then
      return 0
    fi
    if [[ "${state}" == "FAILED" ]]; then
      fatal "${EXIT_SETTLEMENT}" "tip.status reached FAILED for ${label}"
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done

  fatal "${EXIT_SETTLEMENT}" "timeout waiting tip settlement for ${label}"
}

dashboard_summary() {
  local user_id="$1"
  local include_admin="$2"
  local payload
  payload="$(jq -cn \
    --arg id "dash-$(date +%s)-$RANDOM" \
    --arg userId "${user_id}" \
    --argjson includeAdmin "${include_admin}" \
    '{jsonrpc:"2.0",id:$id,method:"dashboard.summary",params:{userId:$userId,includeAdmin:$includeAdmin,limit:50}}')"
  rpc_call_signed "${payload}" "dashboard-$(date +%s)-$RANDOM"
}

request_withdrawal() {
  local user_id="$1"
  local to_address="$2"
  local dir="${ARTIFACT_DIR}/withdrawal"
  mkdir -p "${dir}"

  local payload response
  payload="$(jq -cn \
    --arg id "withdraw-request-$(date +%s)-$RANDOM" \
    --arg userId "${user_id}" \
    --arg asset "${WORKFLOW_ASSET}" \
    --arg amount "${WITHDRAW_AMOUNT}" \
    --arg toAddress "${to_address}" \
    '{jsonrpc:"2.0",id:$id,method:"withdrawal.request",params:{userId:$userId,asset:$asset,amount:$amount,toAddress:$toAddress}}')"
  printf '%s\n' "${payload}" > "${dir}/withdrawal.request.json"

  response="$(rpc_call_signed "${payload}" "withdrawal-request-$(date +%s)-$RANDOM")"
  printf '%s\n' "${response}" > "${dir}/withdrawal.response.json"
  if contains_jsonrpc_error "${response}"; then
    fatal "${EXIT_WITHDRAWAL}" "withdrawal.request failed: $(jsonrpc_error_message "${response}")"
  fi

  local withdrawal_id
  withdrawal_id="$(printf '%s' "${response}" | jq -r '.result.id // empty')"
  if [[ -z "${withdrawal_id}" ]]; then
    fatal "${EXIT_WITHDRAWAL}" "withdrawal.request returned empty id"
  fi
  printf '%s' "${withdrawal_id}"
}

wait_withdrawal_completed() {
  local user_id="$1"
  local withdrawal_id="$2"
  local dir="${ARTIFACT_DIR}/withdrawal"
  local poll_log="${dir}/withdrawal-status.poll.log"
  : > "${poll_log}"
  local deadline=$(( $(date +%s) + WITHDRAWAL_TIMEOUT_SECONDS ))
  local attempt=0

  while [[ "$(date +%s)" -lt "${deadline}" ]]; do
    attempt=$((attempt + 1))
    local response state
    response="$(dashboard_summary "${user_id}" true)"
    printf '%s\n' "${response}" >> "${poll_log}"
    if contains_jsonrpc_error "${response}"; then
      fatal "${EXIT_WITHDRAWAL}" "dashboard.summary failed while polling withdrawal state: $(jsonrpc_error_message "${response}")"
    fi

    state="$(printf '%s' "${response}" | jq -r --arg wid "${withdrawal_id}" '.result.admin.withdrawals[]? | select(.id == $wid) | .state' | head -n1)"
    if [[ "${state}" == "COMPLETED" ]]; then
      printf '%s' "${state}"
      return 0
    fi
    if [[ "${state}" == "FAILED" ]]; then
      fatal "${EXIT_WITHDRAWAL}" "withdrawal ${withdrawal_id} reached FAILED"
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done

  fatal "${EXIT_WITHDRAWAL}" "timeout waiting withdrawal ${withdrawal_id} completion"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose)
      VERBOSE=1
      ;;
    --skip-services)
      SKIP_SERVICES=1
      ;;
    --skip-discourse)
      SKIP_DISCOURSE=1
      ;;
    --skip-withdrawal)
      SKIP_WITHDRAWAL=1
      ;;
    --pause-at-step4)
      PAUSE_AT_STEP4=1
      ;;
    --prepare-only)
      PREPARE_ONLY=1
      ;;
    --with-ember-cli)
      START_EMBER_CLI=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fatal "${EXIT_USAGE}" "unknown option: $1"
      ;;
  esac
  shift
done

mkdir -p "${ARTIFACT_DIR}"
write_result_metadata "RUNNING" "" "" ""

if [[ "${PAUSE_AT_STEP4}" -eq 1 && "${PAUSE_START_EMBER_CLI}" -eq 1 ]]; then
  START_EMBER_CLI=1
fi

require_cmd docker
require_cmd git
require_cmd curl
require_cmd jq
require_cmd openssl
require_cmd awk
require_cmd python3

[[ -f "${COMPOSE_ENV_FILE}" ]] || fatal "${EXIT_PRECHECK}" "missing ${COMPOSE_ENV_FILE}; copy deploy/compose/.env.example first"
[[ "${WORKFLOW_ASSET}" == "CKB" ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_ASSET currently supports only CKB"
[[ "${TIP_AMOUNT}" =~ ^[0-9]+$ && "${TIP_AMOUNT}" -gt 0 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_TIP_AMOUNT must be a positive integer"
[[ "${WITHDRAW_AMOUNT}" =~ ^[0-9]+$ && "${WITHDRAW_AMOUNT}" -gt 0 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_AMOUNT must be a positive integer"
[[ "${WITHDRAW_AMOUNT}" -ge 61 ]] || fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_AMOUNT must be >= 61 for CKB cell minimum"
if [[ -n "${WITHDRAW_TO_ADDRESS}" && ! "${WITHDRAW_TO_ADDRESS}" =~ ^(ckt|ckb)1[0-9a-zA-Z]+$ ]]; then
  fatal "${EXIT_PRECHECK}" "WORKFLOW_WITHDRAW_TO_ADDRESS must be a ckt1... or ckb1... address"
fi
if [[ "${PAUSE_START_EMBER_CLI}" != "0" && "${PAUSE_START_EMBER_CLI}" != "1" ]]; then
  fatal "${EXIT_PRECHECK}" "WORKFLOW_PAUSE_START_EMBER_CLI must be 0 or 1"
fi

APP_SECRET="${FIBER_LINK_APP_SECRET:-}"
if [[ -z "${APP_SECRET}" ]]; then
  APP_SECRET="$(get_env_value FIBER_LINK_HMAC_SECRET)"
fi
[[ -n "${APP_SECRET}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_LINK_HMAC_SECRET/FIBER_LINK_APP_SECRET is required"

WITHDRAWAL_PRIVATE_KEY="${FIBER_WITHDRAWAL_CKB_PRIVATE_KEY:-${FIBER_WITHDRAW_CKB_PRIVATE_KEY:-}}"
if [[ -z "${WITHDRAWAL_PRIVATE_KEY}" ]]; then
  WITHDRAWAL_PRIVATE_KEY="$(get_env_value FIBER_WITHDRAWAL_CKB_PRIVATE_KEY)"
fi
if [[ "${SKIP_WITHDRAWAL}" -eq 0 ]]; then
  [[ -n "${WITHDRAWAL_PRIVATE_KEY}" ]] || fatal "${EXIT_PRECHECK}" "FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required for on-chain withdrawal"
fi

APP_ID="$(resolve_workflow_app_id)"
RPC_PORT="${RPC_PORT:-$(get_env_value RPC_PORT)}"
FNN2_RPC_PORT="${FNN2_RPC_PORT:-$(get_env_value FNN2_RPC_PORT)}"
RPC_PORT="${RPC_PORT:-3000}"
FNN2_RPC_PORT="${FNN2_RPC_PORT:-9227}"
CURRENCY="$(currency_for_asset "${WORKFLOW_ASSET}")"

resolve_runtime_app_secret

log "artifacts: ${ARTIFACT_DIR}"
vlog "rpc_port=${RPC_PORT} fnn2_rpc_port=${FNN2_RPC_PORT} app_id=${APP_ID} asset=${WORKFLOW_ASSET}"

if [[ "${SKIP_SERVICES}" -eq 0 ]]; then
  log "step 1/6 + 2/6: launching fiber services and bootstrapping channel"
  service_args=()
  if [[ "${VERBOSE}" -eq 1 ]]; then
    service_args+=(--verbose)
  fi
  bash "${ROOT_DIR}/scripts/local-dual-fnn-env.sh" "${service_args[@]}"
else
  log "skipping services bootstrap (--skip-services)"
fi

resolve_runtime_ports
CURRENT_STEP="bootstrapping discourse"
sync_rpc_app_secret_record
docker_host_gateway="${DOCKER_HOST_GATEWAY_IP:-$(resolve_docker_host_gateway)}"
if [[ -n "${FIBER_LINK_DISCOURSE_SERVICE_URL:-}" ]]; then
  DISCOURSE_SERVICE_URL="${FIBER_LINK_DISCOURSE_SERVICE_URL}"
elif [[ -n "${docker_host_gateway}" ]]; then
  DISCOURSE_SERVICE_URL="http://${docker_host_gateway}:${RPC_PORT}"
else
  DISCOURSE_SERVICE_URL="http://host.docker.internal:${RPC_PORT}"
fi
vlog "resolved rpc_port=${RPC_PORT} fnn2_rpc_port=${FNN2_RPC_PORT} discourse_service_url=${DISCOURSE_SERVICE_URL}"

TIPPER_USER_ID="${WORKFLOW_TIPPER_USER_ID:-}"
AUTHOR_USER_ID="${WORKFLOW_AUTHOR_USER_ID:-}"
TOPIC_POST_ID="${WORKFLOW_TOPIC_POST_ID:-}"
REPLY_POST_ID="${WORKFLOW_REPLY_POST_ID:-}"

if [[ "${SKIP_DISCOURSE}" -eq 0 ]]; then
  log "step 1/6 + 3/6: launching discourse and installing plugin"

  (
    ensure_discourse_checkout
    ensure_discourse_checkout_permissions
    configure_discourse_dev_allowed_hosts
    cd "${DISCOURSE_DEV_ROOT}"
    ensure_discourse_container_source_mount
    discourse_exec=(
      docker exec
      -u discourse:discourse
      -w /src
      -e RUBY_GLOBAL_METHOD_CACHE_SIZE=131072
      -e LD_PRELOAD=/usr/lib/libjemalloc.so
      -e CI
      -e RAILS_ENV
      -e NO_EMBER_CLI
      -e QUNIT_RAILS_ENV
      discourse_dev
    )
    mkdir -p plugins tmp
    ln -sfn "${ROOT_DIR}/fiber-link-discourse-plugin" plugins/fiber-link
    if docker ps -a --format '{{.Names}}' | grep -qx discourse_dev; then
      docker start discourse_dev >/dev/null 2>&1 || true
    else
      run_with_pseudo_tty ./bin/docker/boot_dev
    fi
    "${discourse_exec[@]}" mkdir -p "${DISCOURSE_CONTAINER_TMPDIR}"
    "${discourse_exec[@]}" git config --global --add safe.directory /src || true
    "${discourse_exec[@]}" env \
      TMPDIR="${DISCOURSE_CONTAINER_TMPDIR}" \
      LOAD_PLUGINS=1 \
      RAILS_ENV=development \
      bundle exec rake db:create db:migrate
  ) > "${ARTIFACT_DIR}/discourse-bootstrap.log" 2>&1 || fatal "${EXIT_DISCOURSE}" "failed to bootstrap discourse (see discourse-bootstrap.log)"

  cp "${ROOT_DIR}/scripts/discourse-seed-fiber-link.rb" "${DISCOURSE_DEV_ROOT}/tmp/fiber-link-seed.rb"
  seed_output_rel_path="tmp/fiber-link-seed-output.json"
  seed_output_host_path="${DISCOURSE_DEV_ROOT}/${seed_output_rel_path}"
  rm -f "${seed_output_host_path}"
  (
    cd "${DISCOURSE_DEV_ROOT}"
    docker exec \
      -u discourse:discourse \
      -w /src \
      -e RUBY_GLOBAL_METHOD_CACHE_SIZE=131072 \
      -e LD_PRELOAD=/usr/lib/libjemalloc.so \
      -e CI \
      discourse_dev \
      env \
      FLOW_TOPIC_TITLE="${TOPIC_LABEL}" \
      FLOW_TOPIC_RAW="${TOPIC_BODY}" \
      FLOW_REPLY_RAW="${REPLY_BODY}" \
      FLOW_OUTPUT_JSON_PATH="${seed_output_rel_path}" \
      FIBER_LINK_DISCOURSE_SERVICE_URL="${DISCOURSE_SERVICE_URL}" \
      FIBER_LINK_APP_ID="${APP_ID}" \
      FIBER_LINK_APP_SECRET="${APP_SECRET}" \
      TMPDIR="${DISCOURSE_CONTAINER_TMPDIR}" \
      LOAD_PLUGINS=1 \
      RAILS_ENV=development \
      bin/rails runner tmp/fiber-link-seed.rb
  ) > "${ARTIFACT_DIR}/discourse-seed.log" 2>&1 || fatal "${EXIT_DISCOURSE}" "failed to seed discourse data (see discourse-seed.log)"

  [[ -s "${seed_output_host_path}" ]] || fatal "${EXIT_DISCOURSE}" "missing discourse seed output file: ${seed_output_host_path}"
  cp "${seed_output_host_path}" "${ARTIFACT_DIR}/discourse-seed.json"
  seed_json="$(tr -d '\r' < "${ARTIFACT_DIR}/discourse-seed.json")"
  [[ -n "${seed_json}" ]] || fatal "${EXIT_DISCOURSE}" "discourse seed output file is empty (see ${seed_output_host_path})"
  printf '%s\n' "${seed_json}" > "${ARTIFACT_DIR}/discourse-seed.json"

  TIPPER_USER_ID="$(printf '%s' "${seed_json}" | jq -r '.tipper.id // empty')"
  AUTHOR_USER_ID="$(printf '%s' "${seed_json}" | jq -r '.author.id // empty')"
  TOPIC_POST_ID="$(printf '%s' "${seed_json}" | jq -r '.topic.first_post_id // empty')"
  REPLY_POST_ID="$(printf '%s' "${seed_json}" | jq -r '.reply.post_id // empty')"

  ensure_discourse_backend_server
else
  log "skipping discourse bootstrap (--skip-discourse)"
fi

ensure_discourse_playwright_runtime
CURRENT_STEP="validating seeded identifiers"

[[ -n "${TIPPER_USER_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_TIPPER_USER_ID"
[[ -n "${AUTHOR_USER_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_AUTHOR_USER_ID"
[[ -n "${TOPIC_POST_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_TOPIC_POST_ID"
[[ -n "${REPLY_POST_ID}" ]] || fatal "${EXIT_PRECHECK}" "missing WORKFLOW_REPLY_POST_ID"

if [[ "${PREPARE_ONLY}" -eq 1 ]]; then
  CURRENT_STEP="preparing browser pause"
  if [[ "${START_EMBER_CLI}" -eq 1 ]]; then
    ensure_ember_cli_proxy
  fi
  CURRENT_STEP="prepare-only complete"
  write_result_metadata "PASS" "0" "prepared through step 3" ""
  WORKFLOW_COMPLETED=1
  printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s PREPARED=1\n' "${ARTIFACT_DIR}"
  exit 0
fi

if [[ "${PAUSE_AT_STEP4}" -eq 1 ]]; then
  CURRENT_STEP="preparing browser pause"
  if [[ "${START_EMBER_CLI}" -eq 1 ]]; then
    ensure_ember_cli_proxy
  fi
  [[ -t 0 ]] || fatal "${EXIT_USAGE}" "--pause-at-step4 requires an interactive terminal"
  log "paused before step 4 (tip actions). Check browser now."
  if [[ -n "${WORKFLOW_PAUSE_BROWSER_URL:-}" ]]; then
    log "browser URL: ${WORKFLOW_PAUSE_BROWSER_URL}"
  elif [[ "${START_EMBER_CLI}" -eq 1 ]]; then
    log "browser URL: http://127.0.0.1:4200/login (ember proxy)"
  else
    log "browser URL: http://127.0.0.1:9292/login (backend)"
  fi
  read -r -p "Press Enter to continue workflow... " _
fi

CURRENT_STEP="tipping topic and reply"
log "step 4/6: tip post and tip reply"
TOPIC_INVOICE="$(create_tip_invoice "topic-post" "${TOPIC_POST_ID}" "${TIPPER_USER_ID}" "${AUTHOR_USER_ID}")"
TOPIC_TX_HASH="$(pay_invoice_from_payer "topic-post" "${TOPIC_INVOICE}" "${TIP_AMOUNT}")"
wait_tip_settled "topic-post" "${TOPIC_INVOICE}"

REPLY_INVOICE="$(create_tip_invoice "reply-post" "${REPLY_POST_ID}" "${TIPPER_USER_ID}" "${AUTHOR_USER_ID}")"
REPLY_TX_HASH="$(pay_invoice_from_payer "reply-post" "${REPLY_INVOICE}" "${TIP_AMOUNT}")"
wait_tip_settled "reply-post" "${REPLY_INVOICE}"

CURRENT_STEP="verifying author dashboard"
log "step 5/6: author checks balance"
DASHBOARD_RESPONSE="$(dashboard_summary "${AUTHOR_USER_ID}" false)"
printf '%s\n' "${DASHBOARD_RESPONSE}" > "${ARTIFACT_DIR}/author-dashboard.json"
if contains_jsonrpc_error "${DASHBOARD_RESPONSE}"; then
  fatal "${EXIT_BALANCE}" "dashboard.summary failed: $(jsonrpc_error_message "${DASHBOARD_RESPONSE}")"
fi

AUTHOR_BALANCE="$(printf '%s' "${DASHBOARD_RESPONSE}" | jq -r '.result.balance // empty')"
[[ -n "${AUTHOR_BALANCE}" ]] || fatal "${EXIT_BALANCE}" "dashboard.summary returned empty balance"

AUTHOR_TIP_COUNT="$(printf '%s' "${DASHBOARD_RESPONSE}" | jq -r '.result.tips | length')"
[[ "${AUTHOR_TIP_COUNT}" -ge 2 ]] || fatal "${EXIT_BALANCE}" "expected at least 2 tip entries, got ${AUTHOR_TIP_COUNT}"

AUTHOR_BALANCE_INTEGER="${AUTHOR_BALANCE%%.*}"
[[ "${AUTHOR_BALANCE_INTEGER}" =~ ^[0-9]+$ ]] || fatal "${EXIT_BALANCE}" "balance is not numeric: ${AUTHOR_BALANCE}"
if [[ "${AUTHOR_BALANCE_INTEGER}" -lt "${WITHDRAW_AMOUNT}" ]]; then
  fatal "${EXIT_BALANCE}" "author balance ${AUTHOR_BALANCE} is smaller than withdrawal amount ${WITHDRAW_AMOUNT}"
fi

CURRENT_STEP="preparing withdrawal"
WITHDRAW_TO_ADDRESS_RESOLVED="$(resolve_withdraw_to_address)"
vlog "withdraw_to_address=${WITHDRAW_TO_ADDRESS_RESOLVED}"

WITHDRAWAL_ID=""
WITHDRAWAL_STATE="SKIPPED"
WITHDRAWAL_REQUESTED="false"
if [[ "${SKIP_WITHDRAWAL}" -eq 0 ]]; then
  CURRENT_STEP="requesting withdrawal"
  log "step 6/6: withdraw to CKB on-chain address"
  WITHDRAWAL_ID="$(request_withdrawal "${AUTHOR_USER_ID}" "${WITHDRAW_TO_ADDRESS_RESOLVED}")"
  WITHDRAWAL_STATE="$(wait_withdrawal_completed "${AUTHOR_USER_ID}" "${WITHDRAWAL_ID}")"
  WITHDRAWAL_REQUESTED="true"
else
  CURRENT_STEP="skipping withdrawal request"
  log "step 6/6: skipping backend withdrawal request (--skip-withdrawal)"
fi

summary_path="${ARTIFACT_DIR}/summary.json"
jq -n \
  --arg artifactDir "${ARTIFACT_DIR}" \
  --arg appId "${APP_ID}" \
  --arg tipperUserId "${TIPPER_USER_ID}" \
  --arg authorUserId "${AUTHOR_USER_ID}" \
  --arg topicPostId "${TOPIC_POST_ID}" \
  --arg replyPostId "${REPLY_POST_ID}" \
  --arg topicInvoice "${TOPIC_INVOICE}" \
  --arg topicTxHash "${TOPIC_TX_HASH}" \
  --arg replyInvoice "${REPLY_INVOICE}" \
  --arg replyTxHash "${REPLY_TX_HASH}" \
  --arg balance "${AUTHOR_BALANCE}" \
  --arg withdrawalId "${WITHDRAWAL_ID}" \
  --arg withdrawalState "${WITHDRAWAL_STATE}" \
  --argjson withdrawalRequested "${WITHDRAWAL_REQUESTED}" \
  --arg withdrawalDestinationAddress "${WITHDRAW_TO_ADDRESS_RESOLVED}" \
  '{
    artifactDir: $artifactDir,
    appId: $appId,
    tipperUserId: $tipperUserId,
    authorUserId: $authorUserId,
    topicPostId: $topicPostId,
    replyPostId: $replyPostId,
    tips: [
      { label: "topic-post", invoice: $topicInvoice, txHash: $topicTxHash },
      { label: "reply-post", invoice: $replyInvoice, txHash: $replyTxHash }
    ],
    balanceAfterTips: $balance,
    withdrawal: {
      requested: $withdrawalRequested,
      id: $withdrawalId,
      state: $withdrawalState,
      destinationAddress: $withdrawalDestinationAddress
    }
  }' > "${summary_path}"

write_result_metadata "PASS" "0" "" "${summary_path}"
WORKFLOW_COMPLETED=1
printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${ARTIFACT_DIR}" "${summary_path}"
