#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-channel-rotation-smoke"
VERBOSE=0
HEADED=1
ORCHESTRATOR_SCRIPT="${E2E_FOUR_FLOWS_ORCHESTRATOR_SCRIPT:-${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh}"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-channel-rotation-fallback-smoke.sh [options]

Runs the split discourse workflow with channel rotation liquidity fallback enabled,
then materializes focused channel rotation smoke evidence.

Options:
  --run-dir <path>                   Artifact directory. Default: .tmp/e2e-discourse-four-flows/<timestamp>-channel-rotation
  --explorer-tx-url-template <tpl>   Explorer URL template containing {txHash} or %s.
  --headless                         Run browser automation in headless mode.
  --verbose                          Print detailed logs.
  -h, --help                         Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir|--artifact-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --explorer-tx-url-template)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      EXPLORER_TX_URL_TEMPLATE="$2"
      shift
      ;;
    --headless)
      HEADED=0
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

if [[ -z "${RUN_DIR}" ]]; then
  RUN_DIR="${ROOT_DIR}/.tmp/e2e-discourse-four-flows/${DEFAULT_RUN_TIMESTAMP}-channel-rotation"
fi
[[ -n "${EXPLORER_TX_URL_TEMPLATE}" ]] || fatal "${EXIT_USAGE}" "--explorer-tx-url-template is required"
[[ -x "${ORCHESTRATOR_SCRIPT}" ]] || fatal "${EXIT_PRECHECK}" "missing orchestrator script: ${ORCHESTRATOR_SCRIPT}"

ensure_run_layout
LIQUIDITY_FALLBACK_MODE="channel_rotation"
CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${E2E_CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-${FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE:-61}}"
CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${E2E_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-${FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT:-30}}"
CHANNEL_ROTATION_MAX_CONCURRENT="${E2E_CHANNEL_ROTATION_MAX_CONCURRENT:-${FIBER_CHANNEL_ROTATION_MAX_CONCURRENT:-1}}"
persist_state_env

export LIQUIDITY_FALLBACK_MODE
export CHANNEL_ROTATION_BOOTSTRAP_RESERVE
export CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT
export CHANNEL_ROTATION_MAX_CONCURRENT
export FIBER_LIQUIDITY_FALLBACK_MODE="${LIQUIDITY_FALLBACK_MODE}"
export FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE="${CHANNEL_ROTATION_BOOTSTRAP_RESERVE}"
export FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT="${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT}"
export FIBER_CHANNEL_ROTATION_MAX_CONCURRENT="${CHANNEL_ROTATION_MAX_CONCURRENT}"
export E2E_UNIQUE_WITHDRAW_TO_ADDRESS="${E2E_UNIQUE_WITHDRAW_TO_ADDRESS:-1}"

orchestrator_cmd=(
  "${ORCHESTRATOR_SCRIPT}"
  --artifact-dir "${RUN_DIR}"
  --liquidity-fallback-mode "${LIQUIDITY_FALLBACK_MODE}"
  --double-withdrawal-regression
  --explorer-tx-url-template "${EXPLORER_TX_URL_TEMPLATE}"
)
if [[ "${HEADED}" -eq 0 ]]; then
  orchestrator_cmd+=(--headless)
fi
if [[ "${VERBOSE}" -eq 1 ]]; then
  orchestrator_cmd+=(--verbose)
fi

record_cmd "${orchestrator_cmd[*]}"
(cd "${ROOT_DIR}" && "${orchestrator_cmd[@]}") > "${LOGS_DIR}/channel-rotation-smoke.log" 2>&1 \
  || fatal "${EXIT_ARTIFACT}" "channel rotation smoke orchestrator failed"

primary_snapshot_file="${ARTIFACTS_DIR}/withdrawal-primary.snapshot.json"
primary_hot_wallet_before_file="${ARTIFACTS_DIR}/withdrawal-primary.hot-wallet.before.json"
primary_hot_wallet_after_file="${ARTIFACTS_DIR}/withdrawal-primary.hot-wallet.after.json"
legacy_seed_file="${ARTIFACTS_DIR}/channel-rotation-legacy-seed.json"

[[ -f "${primary_snapshot_file}" ]] || fatal "${EXIT_ARTIFACT}" "missing primary withdrawal snapshot"
[[ -f "${primary_hot_wallet_before_file}" ]] || fatal "${EXIT_ARTIFACT}" "missing primary hot-wallet before snapshot"
[[ -f "${primary_hot_wallet_after_file}" ]] || fatal "${EXIT_ARTIFACT}" "missing primary hot-wallet after snapshot"
[[ -f "${legacy_seed_file}" ]] || fatal "${EXIT_ARTIFACT}" "missing legacy channel seed artifact"

rotation_summary_file="${ARTIFACTS_DIR}/liquidity-channel-rotation.json"
jq -n \
  --arg runDir "${RUN_DIR}" \
  --arg fallbackMode "${LIQUIDITY_FALLBACK_MODE}" \
  --arg bootstrapReserve "${CHANNEL_ROTATION_BOOTSTRAP_RESERVE}" \
  --arg minRecoverableAmount "${CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT}" \
  --argjson legacySeed "$(cat "${legacy_seed_file}")" \
  --argjson primarySnapshot "$(cat "${primary_snapshot_file}")" \
  --argjson hotWalletBefore "$(cat "${primary_hot_wallet_before_file}")" \
  --argjson hotWalletAfter "$(cat "${primary_hot_wallet_after_file}")" \
  '{
    scenario: "channel-rotation-fallback-smoke",
    runDir: $runDir,
    config: {
      liquidityFallbackMode: $fallbackMode,
      bootstrapReserve: $bootstrapReserve,
      minRecoverableAmount: $minRecoverableAmount
    },
    seed: $legacySeed,
    primary: {
      snapshot: $primarySnapshot,
      hotWalletBefore: $hotWalletBefore,
      hotWalletAfter: $hotWalletAfter
    },
    rotation: {
      recoveryStrategy: ($primarySnapshot.liquidityRequestMetadata.recoveryStrategy // null),
      legacyChannelId: ($primarySnapshot.liquidityRequestMetadata.legacyChannelId // null),
      replacementChannelId: ($primarySnapshot.liquidityRequestMetadata.replacementChannelId // null),
      expectedRecoveredAmount: ($primarySnapshot.liquidityRequestMetadata.expectedRecoveredAmount // null),
      channelCloseTxHash: ($primarySnapshot.liquidityRequestMetadata.channelCloseTxHash // null)
    },
    checks: {
      hasLegacySeed: true,
      hasPrimarySnapshot: true,
      hasHotWalletBefore: true,
      hasHotWalletAfter: true
    }
  }' > "${rotation_summary_file}"

printf 'RESULT=PASS CODE=0 RUN_DIR=%s SUMMARY=%s\n' "${RUN_DIR}" "${rotation_summary_file}"
