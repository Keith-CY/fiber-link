#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-liquidity-double"
VERBOSE=0
HEADED=1
PHASE_SCRIPT_DIR="${E2E_FOUR_FLOWS_PHASE_SCRIPT_DIR:-${ROOT_DIR}/scripts}"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.liquidity-double-withdrawal.sh [options]

Optional liquidity regression step for the split discourse four-flows workflow:
- re-run author withdrawal as a second browser-initiated attempt
- verify both first and second requests enter LIQUIDITY_PENDING
- verify both withdrawals eventually complete
- persist hot-wallet and liquidity snapshots for both attempts

Options:
  --run-dir <path>                   Existing run directory from phase5.
  --explorer-tx-url-template <tpl>   Explorer URL template containing {txHash} or %s.
  --headless                         Run Playwright steps in headless mode.
  --verbose                          Print detailed logs.
  -h, --help                         Show help.
USAGE
}

phase_script() {
  local script_name="$1"
  printf '%s/%s' "${PHASE_SCRIPT_DIR}" "${script_name}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
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

[[ -n "${RUN_DIR}" ]] || { usage >&2; exit "${EXIT_USAGE}"; }
[[ -n "${EXPLORER_TX_URL_TEMPLATE}" ]] || fatal "${EXIT_USAGE}" "--explorer-tx-url-template is required"

ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
persist_state_env

require_cmd jq

primary_result_file="${ARTIFACTS_DIR}/withdrawal-primary.result.json"
primary_completed_snapshot_file="${ARTIFACTS_DIR}/withdrawal-primary.completed.snapshot.json"
primary_hot_wallet_before_file="${ARTIFACTS_DIR}/withdrawal-primary.hot-wallet.before.json"
primary_hot_wallet_after_file="${ARTIFACTS_DIR}/withdrawal-primary.hot-wallet.after.json"
primary_signer_file="${ARTIFACTS_DIR}/withdrawal-primary.signer.json"

[[ -f "${primary_result_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing primary withdrawal result: ${primary_result_file}"
[[ -f "${primary_completed_snapshot_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing primary completed snapshot: ${primary_completed_snapshot_file}"
[[ -f "${primary_hot_wallet_before_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing primary hot-wallet before snapshot"
[[ -f "${primary_hot_wallet_after_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing primary hot-wallet after snapshot"
[[ -f "${primary_signer_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing primary signer snapshot"

if should_use_unique_withdraw_to_address; then
  WITHDRAW_TO_ADDRESS="$(generate_unique_testnet_withdraw_to_address second)"
  persist_state_env
fi

phase3_script="$(phase_script e2e-discourse-four-flows.phase3-author-withdrawal.sh)"
phase4_script="$(phase_script e2e-discourse-four-flows.phase4-postcheck.sh)"
phase5_script="$(phase_script e2e-discourse-four-flows.phase5-explorer-and-finalize.sh)"

[[ -x "${phase3_script}" ]] || fatal "${EXIT_PRECHECK}" "missing phase3 script: ${phase3_script}"
[[ -x "${phase4_script}" ]] || fatal "${EXIT_PRECHECK}" "missing phase4 script: ${phase4_script}"
[[ -x "${phase5_script}" ]] || fatal "${EXIT_PRECHECK}" "missing phase5 script: ${phase5_script}"

phase3_cmd=("${phase3_script}" --run-dir "${RUN_DIR}" --attempt-label second)
phase4_cmd=("${phase4_script}" --run-dir "${RUN_DIR}" --attempt-label second)
phase5_cmd=("${phase5_script}" --run-dir "${RUN_DIR}" --attempt-label second --explorer-tx-url-template "${EXPLORER_TX_URL_TEMPLATE}")
if [[ "${HEADED}" -eq 0 ]]; then
  phase3_cmd+=(--headless)
  phase4_cmd+=(--headless)
fi
if [[ "${VERBOSE}" -eq 1 ]]; then
  phase3_cmd+=(--verbose)
  phase4_cmd+=(--verbose)
  phase5_cmd+=(--verbose)
fi

record_cmd "${phase3_cmd[*]}"
(cd "${ROOT_DIR}" && "${phase3_cmd[@]}")
record_cmd "${phase4_cmd[*]}"
(cd "${ROOT_DIR}" && "${phase4_cmd[@]}")
record_cmd "${phase5_cmd[*]}"
(cd "${ROOT_DIR}" && "${phase5_cmd[@]}")

load_state_env

second_result_file="${ARTIFACTS_DIR}/withdrawal-second.result.json"
second_completed_snapshot_file="${ARTIFACTS_DIR}/withdrawal-second.completed.snapshot.json"
second_hot_wallet_before_file="${ARTIFACTS_DIR}/withdrawal-second.hot-wallet.before.json"
second_hot_wallet_after_file="${ARTIFACTS_DIR}/withdrawal-second.hot-wallet.after.json"
second_signer_file="${ARTIFACTS_DIR}/withdrawal-second.signer.json"

[[ -f "${second_result_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing second withdrawal result: ${second_result_file}"
[[ -f "${second_completed_snapshot_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing second completed snapshot: ${second_completed_snapshot_file}"
[[ -f "${second_hot_wallet_before_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing second hot-wallet before snapshot"
[[ -f "${second_hot_wallet_after_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing second hot-wallet after snapshot"
[[ -f "${second_signer_file}" ]] || fatal "${EXIT_WITHDRAWAL}" "missing second signer snapshot"

summary_file="${ARTIFACTS_DIR}/liquidity-double-withdrawal.json"
jq -n \
  --arg withdrawalAmount "${WORKFLOW_WITHDRAW_AMOUNT:-61}" \
  --arg tipAmount "${WORKFLOW_TIP_AMOUNT:-}" \
  --arg feeBuffer "${FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER:-0}" \
  --arg postTxReserve "${FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE:-0}" \
  --arg warmBuffer "${FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER:-0}" \
  --argjson firstResult "$(cat "${primary_result_file}")" \
  --argjson firstSnapshot "$(cat "${primary_completed_snapshot_file}")" \
  --argjson firstHotWalletBefore "$(cat "${primary_hot_wallet_before_file}")" \
  --argjson firstHotWalletAfter "$(cat "${primary_hot_wallet_after_file}")" \
  --argjson firstSigner "$(cat "${primary_signer_file}")" \
  --argjson secondResult "$(cat "${second_result_file}")" \
  --argjson secondSnapshot "$(cat "${second_completed_snapshot_file}")" \
  --argjson secondHotWalletBefore "$(cat "${second_hot_wallet_before_file}")" \
  --argjson secondHotWalletAfter "$(cat "${second_hot_wallet_after_file}")" \
  --argjson secondSigner "$(cat "${second_signer_file}")" \
  '{
    scenario: "double-withdrawal-liquidity-regression",
    config: {
      withdrawalAmount: $withdrawalAmount,
      tipAmountPerSettlement: $tipAmount,
      feeBufferAmount: $feeBuffer,
      postTxReserveAmount: $postTxReserve,
      warmBufferAmount: $warmBuffer
    },
    attempts: {
      first: {
        result: $firstResult,
        snapshot: $firstSnapshot,
        hotWalletBefore: $firstHotWalletBefore,
        hotWalletAfter: $firstHotWalletAfter,
        signer: $firstSigner
      },
      second: {
        result: $secondResult,
        snapshot: $secondSnapshot,
        hotWalletBefore: $secondHotWalletBefore,
        hotWalletAfter: $secondHotWalletAfter,
        signer: $secondSigner
      }
    },
    checks: {
      sameSigner: (
        (($firstSigner.withdrawalSignerAddress // "") != "")
        and (($firstSigner.withdrawalSignerAddress // "") == ($secondSigner.withdrawalSignerAddress // ""))
      ),
      firstRequestedLiquidityPending: (($firstResult.withdrawalRequestedState // "") == "LIQUIDITY_PENDING"),
      firstCompleted: (($firstSnapshot.state // "") == "COMPLETED"),
      secondRequestedLiquidityPending: (($secondResult.withdrawalRequestedState // "") == "LIQUIDITY_PENDING"),
      secondCompleted: (($secondSnapshot.state // "") == "COMPLETED"),
      pass: (
        ((($firstSigner.withdrawalSignerAddress // "") != "")
          and (($firstSigner.withdrawalSignerAddress // "") == ($secondSigner.withdrawalSignerAddress // "")))
        and
        (($firstResult.withdrawalRequestedState // "") == "LIQUIDITY_PENDING")
        and (($firstSnapshot.state // "") == "COMPLETED")
        and (($secondResult.withdrawalRequestedState // "") == "LIQUIDITY_PENDING")
        and (($secondSnapshot.state // "") == "COMPLETED")
      )
    }
  }' > "${summary_file}"

if [[ "$(jq -r '.checks.pass' "${summary_file}")" != "true" ]]; then
  fatal "${EXIT_ARTIFACT}" "double-withdrawal liquidity regression failed (see ${summary_file})"
fi

printf 'RESULT=PASS CODE=0 RUN_DIR=%s SUMMARY=%s\n' "${RUN_DIR}" "${summary_file}"
