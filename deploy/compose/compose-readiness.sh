#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
TEST_SCRIPT="${ROOT_DIR}/deploy/compose/compose-reference.test.sh"
VALIDATE_ENV_SCRIPT="${ROOT_DIR}/deploy/compose/validate-env.sh"
EVIDENCE_ROOT="${ROOT_DIR}/deploy/compose/evidence"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
EVIDENCE_DIR="${EVIDENCE_ROOT}/${TIMESTAMP}"

DRY_RUN=0
SKIP_SMOKE=0
VERBOSE=0
WAIT_SECONDS=120
DESTROY_VOLUMES="${FIBER_LINK_DESTROY_VOLUMES:-0}"

usage() {
  cat <<'EOF'
Usage: compose-readiness.sh [--dry-run] [--skip-smoke] [--verbose] [--destroy-volumes]

Options:
  --dry-run          Print commands without executing side effects.
  --skip-smoke       Start services and wait for readiness without HTTP smoke checks.
  --verbose          Print command execution details.
  --destroy-volumes  Remove compose volumes during cleanup. Can also be enabled with FIBER_LINK_DESTROY_VOLUMES=1.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-smoke)
      SKIP_SMOKE=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    --destroy-volumes)
      DESTROY_VOLUMES=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

mkdir -p "$EVIDENCE_DIR"

echo "Evidence directory: ${EVIDENCE_DIR}"

validate_env_cmd="\"$VALIDATE_ENV_SCRIPT\" \"$ENV_FILE\""
echo "[compose-readiness] env-validation: ${validate_env_cmd}" >> "${EVIDENCE_DIR}/commands.log"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[DRY-RUN] ${validate_env_cmd}" | tee -a "${EVIDENCE_DIR}/env-validation.log"
elif ! "$VALIDATE_ENV_SCRIPT" "$ENV_FILE" >>"${EVIDENCE_DIR}/env-validation.log" 2>&1; then
  echo "compose env validation failed; aborting before reading env or starting containers" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

RPC_PORT="${RPC_PORT:-3000}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
FIBER_CHANNEL_ACCEPT_RPC_URL="${FIBER_CHANNEL_ACCEPT_RPC_URL:-http://fnn2:8227}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fiber-link-readiness-$(date -u +"%Y%m%d%H%M%S")-$$}"
COMPOSE_DOWN_ARGS="--remove-orphans"
if [[ "${DESTROY_VOLUMES}" == "1" ]]; then
  COMPOSE_DOWN_ARGS="${COMPOSE_DOWN_ARGS} --volumes"
fi

shell_quote() {
  printf '%q' "$1"
}

echo "Evidence directory: ${EVIDENCE_DIR}"
echo "Compose project: ${COMPOSE_PROJECT_NAME}"

if [[ "${DESTROY_VOLUMES}" == "1" ]]; then
  cat >&2 <<EOF
WARNING: destructive compose volume cleanup is enabled.
Target compose project: ${COMPOSE_PROJECT_NAME}
Env file: ${ENV_FILE}
EOF
fi

declare -A CHECK_STATUS=(
  [precheck]="not_run"
  [spinup]="not_run"
  [fnn]="not_run"
  [fnn2]="not_run"
  [fnn2_rpc]="not_run"
  [rpc]="not_run"
  [worker]="not_run"
  [smoke]="not_run"
  [shutdown]="not_run"
)

run_step() {
  local name="$1"
  local log_file="$2"
  shift 2
  local cmd="$*"

  if [[ "$VERBOSE" -eq 1 ]]; then
    echo "[compose-readiness] ${name}: ${cmd}" >&2
  fi

  echo "[compose-readiness] ${name}: ${cmd}" >> "${EVIDENCE_DIR}/commands.log"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY-RUN] ${cmd}" | tee -a "$log_file"
    return 0
  fi

  if eval "$cmd" >>"$log_file" 2>&1; then
    return 0
  fi

  return 1
}

wait_for_health() {
  local service="$1"
  local timeout="${2:-$WAIT_SECONDS}"
  local deadline=$((SECONDS + timeout))

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY-RUN] would wait for ${service} readiness" | tee -a "${EVIDENCE_DIR}/${service}-ready.wait.log"
    return 0
  fi

  while (( SECONDS < deadline )); do
    local container_id
    container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      local health_state
      health_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$health_state" == "healthy" ]]; then
        echo "${service} is healthy" | tee -a "${EVIDENCE_DIR}/${service}-ready.wait.log"
        return 0
      fi
    fi
    sleep 2
  done

  echo "Timed out waiting for ${service} to become healthy" | tee -a "${EVIDENCE_DIR}/${service}-ready.wait.log"
  return 1
}

probe_fnn2_channel_accept_rpc() {
  local probe_payload='{"jsonrpc":"2.0","id":"compose-readiness-fnn2","method":"node_info","params":[]}'
  local cmd quoted_accept_url
  quoted_accept_url="$(shell_quote "${FIBER_CHANNEL_ACCEPT_RPC_URL}")"
  cmd="docker compose -f \"$COMPOSE_FILE\" exec -T -e FIBER_CHANNEL_ACCEPT_RPC_URL=${quoted_accept_url} rpc sh -lc 'curl -fsS \"\$FIBER_CHANNEL_ACCEPT_RPC_URL\" -H '\''content-type: application/json'\'' --data '\''${probe_payload}'\''' > \"${EVIDENCE_DIR}/fnn2-node-info.json\" && grep -q '\"result\"' \"${EVIDENCE_DIR}/fnn2-node-info.json\""
  run_step "fnn2-channel-accept-rpc" "${EVIDENCE_DIR}/fnn2-channel-accept-rpc.log" "$cmd"
}

precheck_cmd="[ -f \"$TEST_SCRIPT\" ] && \"$TEST_SCRIPT\""
if run_step "precheck" "${EVIDENCE_DIR}/precheck.log" "$precheck_cmd"; then
  CHECK_STATUS[precheck]="pass"
else
  CHECK_STATUS[precheck]="fail"
fi

if [[ "${CHECK_STATUS[precheck]}" == "pass" ]]; then
  if run_step "spinup" "${EVIDENCE_DIR}/compose-up.log" "cd \"$ROOT_DIR\" && docker compose -f \"$COMPOSE_FILE\" up -d --build"; then
    CHECK_STATUS[spinup]="pass"
  else
    CHECK_STATUS[spinup]="fail"
  fi
fi

if [[ "${CHECK_STATUS[spinup]}" == "pass" ]]; then
  if wait_for_health fnn "$WAIT_SECONDS"; then
    CHECK_STATUS[fnn]="pass"
  else
    CHECK_STATUS[fnn]="fail"
  fi

  if wait_for_health fnn2 "$WAIT_SECONDS"; then
    CHECK_STATUS[fnn2]="pass"
  else
    CHECK_STATUS[fnn2]="fail"
  fi

  if wait_for_health rpc "$WAIT_SECONDS"; then
    CHECK_STATUS[rpc]="pass"
  else
    CHECK_STATUS[rpc]="fail"
  fi

  if [[ "${CHECK_STATUS[fnn2]}" == "pass" && "${CHECK_STATUS[rpc]}" == "pass" ]]; then
    if probe_fnn2_channel_accept_rpc; then
      CHECK_STATUS[fnn2_rpc]="pass"
    else
      CHECK_STATUS[fnn2_rpc]="fail"
    fi
  fi

  if wait_for_health worker "$WAIT_SECONDS"; then
    CHECK_STATUS[worker]="pass"
  else
    CHECK_STATUS[worker]="fail"
  fi
fi

if [[ "${CHECK_STATUS[fnn]}" == "pass" && "${CHECK_STATUS[fnn2]}" == "pass" && "${CHECK_STATUS[fnn2_rpc]}" == "pass" && "${CHECK_STATUS[rpc]}" == "pass" && "${CHECK_STATUS[worker]}" == "pass" ]]; then
  run_step "compose-ps-ready" "${EVIDENCE_DIR}/compose-ready-ps.log" "docker compose -f \"$COMPOSE_FILE\" ps"
fi

if [[ "${SKIP_SMOKE}" -eq 0 && "${CHECK_STATUS[worker]}" == "pass" ]]; then
  live_ok=false
  ready_ok=false
  smoke_ok=false

  if run_step "rpc-live" "${EVIDENCE_DIR}/rpc-live.log" \
    "curl -fsS \"${RPC_URL}/healthz/live\" -o \"${EVIDENCE_DIR}/rpc-healthz-live.json\" && grep -q '\"status\":\"alive\"' \"${EVIDENCE_DIR}/rpc-healthz-live.json\""; then
    live_ok=true
  fi

  if run_step "rpc-ready" "${EVIDENCE_DIR}/rpc-ready.log" \
    "curl -fsS \"${RPC_URL}/healthz/ready\" -o \"${EVIDENCE_DIR}/rpc-healthz-ready.json\" && grep -q '\"status\":\"ready\"' \"${EVIDENCE_DIR}/rpc-healthz-ready.json\""; then
    ready_ok=true
  fi

  # Keep "$payload" escaped to delay expansion until run_step executes the command string.
  smoke_cmd="payload='{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"health.ping\",\"params\":{}}' && curl -fsS \"${RPC_URL}/rpc\" -H 'content-type: application/json' -H 'x-app-id: local-dev' -H \"x-ts: \$(date +%s)\" -H 'x-nonce: local-dev-readiness' -H 'x-signature: invalid' --data \"\$payload\" -o \"${EVIDENCE_DIR}/rpc-smoke.json\" && grep -q 'Unauthorized' \"${EVIDENCE_DIR}/rpc-smoke.json\""

  if run_step "rpc-smoke" "${EVIDENCE_DIR}/rpc-smoke.log" \
    "$smoke_cmd"; then
    smoke_ok=true
  fi

  if [[ "$live_ok" == true && "$ready_ok" == true && "$smoke_ok" == true ]]; then
    CHECK_STATUS[smoke]="pass"
  else
    CHECK_STATUS[smoke]="fail"
  fi
else
  CHECK_STATUS[smoke]="skipped"
fi

run_step "compose-logs" "${EVIDENCE_DIR}/compose-logs.log" "docker compose -f \"$COMPOSE_FILE\" logs --no-color --timestamps rpc worker fnn fnn2 postgres redis"

if [[ "${CHECK_STATUS[spinup]}" == "pass" ]]; then
  if run_step "compose-down" "${EVIDENCE_DIR}/compose-down.log" "cd \"$ROOT_DIR\" && docker compose -f \"$COMPOSE_FILE\" down ${COMPOSE_DOWN_ARGS}"; then
    CHECK_STATUS[shutdown]="pass"
  else
    CHECK_STATUS[shutdown]="fail"
  fi
fi

summary_file="${EVIDENCE_DIR}/summary.json"
if [[ "${CHECK_STATUS[precheck]}" == "pass" && \
  "${CHECK_STATUS[spinup]}" == "pass" && \
  "${CHECK_STATUS[fnn]}" == "pass" && \
  "${CHECK_STATUS[fnn2]}" == "pass" && \
  "${CHECK_STATUS[fnn2_rpc]}" == "pass" && \
  "${CHECK_STATUS[rpc]}" == "pass" && \
  "${CHECK_STATUS[worker]}" == "pass" && \
  ( "${CHECK_STATUS[smoke]}" == "pass" || "${CHECK_STATUS[smoke]}" == "skipped" ) ]]; then
  OVERALL_STATUS="pass"
else
  OVERALL_STATUS="fail"
fi

cat > "$summary_file" <<EOF
{
  "status": "${OVERALL_STATUS}",
  "timestamp": "${TIMESTAMP}",
  "dryRun": ${DRY_RUN},
  "skipSmoke": ${SKIP_SMOKE},
  "destroyVolumes": ${DESTROY_VOLUMES},
  "composeProjectName": "${COMPOSE_PROJECT_NAME}",
  "waitSeconds": ${WAIT_SECONDS},
  "checks": {
    "precheck": "${CHECK_STATUS[precheck]}",
    "spinup": "${CHECK_STATUS[spinup]}",
    "fnn": "${CHECK_STATUS[fnn]}",
    "fnn2": "${CHECK_STATUS[fnn2]}",
    "fnn2Rpc": "${CHECK_STATUS[fnn2_rpc]}",
    "rpc": "${CHECK_STATUS[rpc]}",
    "worker": "${CHECK_STATUS[worker]}",
    "smoke": "${CHECK_STATUS[smoke]}",
    "shutdown": "${CHECK_STATUS[shutdown]}"
  },
  "evidenceDir": "${EVIDENCE_DIR}"
}
EOF

echo "compose-readiness summary:"
cat "$summary_file"

if [[ "$OVERALL_STATUS" != "pass" ]]; then
  exit 1
fi
