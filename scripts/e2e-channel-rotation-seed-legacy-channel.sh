#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-channel-rotation-seed"
VERBOSE=0
READY_TIMEOUT_MS="${E2E_CHANNEL_ROTATION_READY_TIMEOUT_MS:-180000}"
POLL_INTERVAL_MS="${E2E_CHANNEL_ROTATION_POLL_INTERVAL_MS:-2000}"
LEGACY_CHANNEL_AMOUNT_CKB="${E2E_CHANNEL_ROTATION_LEGACY_CHANNEL_AMOUNT:-}"
MIN_RECOVERABLE_AMOUNT_CKB="${E2E_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-0}}"
PRIMARY_ENDPOINT="${E2E_CHANNEL_ROTATION_PRIMARY_RPC_URL:-http://fnn:8227}"
PEER_ENDPOINT="${E2E_CHANNEL_ROTATION_PEER_RPC_URL:-${FIBER_CHANNEL_ACCEPT_RPC_URL:-http://fnn2:8227}}"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-channel-rotation-seed-legacy-channel.sh [options]

Ensure there is a recoverable legacy CKB channel available before running
channel-rotation liquidity fallback e2e.

Options:
  --run-dir <path>                   Shared run directory. Required.
  --legacy-channel-amount <ckb>      Target CKB amount for the seeded legacy channel.
  --min-recoverable-amount <ckb>     Minimum recoverable amount for eligible legacy channels.
  --ready-timeout-ms <ms>            Channel ready timeout. Default: 180000.
  --poll-interval-ms <ms>            Ready poll interval. Default: 2000.
  --verbose                          Print detailed logs.
  -h, --help                         Show help.
USAGE
}

compute_default_legacy_channel_amount() {
  python3 -c 'from decimal import Decimal
import os
withdraw = Decimal(os.environ.get("WORKFLOW_WITHDRAW_AMOUNT", "61"))
fee = Decimal(os.environ.get("FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER", "0"))
reserve = Decimal(os.environ.get("FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE", "0"))
warm = Decimal(os.environ.get("FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER", "0"))
total = withdraw + fee + reserve + warm
value = format(total, "f").rstrip("0").rstrip(".")
print(value or "0")'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir|--artifact-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --legacy-channel-amount)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      LEGACY_CHANNEL_AMOUNT_CKB="$2"
      shift
      ;;
    --min-recoverable-amount)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      MIN_RECOVERABLE_AMOUNT_CKB="$2"
      shift
      ;;
    --ready-timeout-ms)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      READY_TIMEOUT_MS="$2"
      shift
      ;;
    --poll-interval-ms)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      POLL_INTERVAL_MS="$2"
      shift
      ;;
    --verbose)
      VERBOSE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit "${EXIT_USAGE}"
      ;;
  esac
  shift
done

[[ -n "${RUN_DIR}" ]] || { usage >&2; exit "${EXIT_USAGE}"; }
ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
ensure_compose_files
require_cmd docker
require_cmd python3

[[ -n "${LEGACY_CHANNEL_AMOUNT_CKB}" ]] || LEGACY_CHANNEL_AMOUNT_CKB="$(compute_default_legacy_channel_amount)"
[[ -n "${LEGACY_CHANNEL_AMOUNT_CKB}" ]] || fatal "${EXIT_PRECHECK}" "failed to compute legacy channel amount"
[[ -n "${MIN_RECOVERABLE_AMOUNT_CKB}" ]] || MIN_RECOVERABLE_AMOUNT_CKB="0"

wait_container_healthy fiber-link-fnn 180 \
  || fatal "${EXIT_PRECHECK}" "fnn is not healthy"
wait_container_healthy fiber-link-fnn2 180 \
  || fatal "${EXIT_PRECHECK}" "fnn2 is not healthy"
wait_container_healthy fiber-link-worker 180 \
  || fatal "${EXIT_PRECHECK}" "worker is not healthy"

primary_p2p_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' fiber-link-fnn)"
peer_p2p_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' fiber-link-fnn2)"
[[ -n "${primary_p2p_ip}" ]] || fatal "${EXIT_PRECHECK}" "failed to resolve fiber-link-fnn container ip"
[[ -n "${peer_p2p_ip}" ]] || fatal "${EXIT_PRECHECK}" "failed to resolve fiber-link-fnn2 container ip"

seed_output_file="${ARTIFACTS_DIR}/channel-rotation-legacy-seed.json"
seed_log_file="${LOGS_DIR}/channel-rotation-legacy-seed.log"
seed_cmd=(
  docker exec
  -w /app
  fiber-link-worker
  bun run
  apps/worker/src/scripts/seed-channel-rotation-legacy.ts
  --primary-endpoint "${PRIMARY_ENDPOINT}"
  --peer-endpoint "${PEER_ENDPOINT}"
  --primary-p2p-ip "${primary_p2p_ip}"
  --peer-p2p-ip "${peer_p2p_ip}"
  --required-amount-ckb "${LEGACY_CHANNEL_AMOUNT_CKB}"
  --min-recoverable-amount-ckb "${MIN_RECOVERABLE_AMOUNT_CKB}"
  --ready-timeout-ms "${READY_TIMEOUT_MS}"
  --poll-interval-ms "${POLL_INTERVAL_MS}"
)

record_cmd "${seed_cmd[*]}"
"${seed_cmd[@]}" > "${seed_output_file}" 2> "${seed_log_file}" \
  || fatal "${EXIT_PRECHECK}" "failed to seed recoverable legacy channel"

printf 'RESULT=PASS CODE=0 RUN_DIR=%s SUMMARY=%s\n' "${RUN_DIR}" "${seed_output_file}"
