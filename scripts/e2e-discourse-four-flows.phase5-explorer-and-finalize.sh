#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

LOG_PREFIX="e2e-four-flows-phase5"
VERBOSE=0
CLI_EXPLORER_TX_URL_TEMPLATE=""
ATTEMPT_LABEL="primary"

usage() {
  cat <<'USAGE'
Usage: scripts/e2e-discourse-four-flows.phase5-explorer-and-finalize.sh [options]

Phase 6 of the discourse four-flows workflow:
- wait for withdrawal completion
- capture explorer transaction proof
- assemble summary artifacts

Options:
  --run-dir <path>                   Existing run directory from phase4.
  --attempt-label <label>            Attempt label. Default: primary.
  --explorer-tx-url-template <tpl>   Explorer URL template containing {txHash} or %s.
  --verbose                          Print detailed logs.
  -h, --help                         Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      RUN_DIR="$2"
      shift
      ;;
    --attempt-label)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      ATTEMPT_LABEL="$2"
      shift
      ;;
    --explorer-tx-url-template)
      [[ $# -ge 2 ]] || { usage >&2; exit "${EXIT_USAGE}"; }
      CLI_EXPLORER_TX_URL_TEMPLATE="$2"
      EXPLORER_TX_URL_TEMPLATE="$2"
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
[[ -n "${EXPLORER_TX_URL_TEMPLATE}" ]] || fatal "${EXIT_USAGE}" "--explorer-tx-url-template is required"

ensure_run_layout
load_state_env
refresh_run_paths
ensure_app_context
parse_settlement_modes
if [[ -n "${CLI_EXPLORER_TX_URL_TEMPLATE}" ]]; then
  EXPLORER_TX_URL_TEMPLATE="${CLI_EXPLORER_TX_URL_TEMPLATE}"
fi
normalize_explorer_tx_url_template
persist_state_env

[[ -n "${WITHDRAWAL_ID}" ]] || fatal "${EXIT_WITHDRAWAL}" "phase5 requires withdrawal id from phase3"
[[ -n "${AUTHOR_USER_ID}" ]] || fatal "${EXIT_WITHDRAWAL}" "phase5 requires author user id in state"

attempt_postcheck_dir="${POSTCHECK_DIR}"
attempt_explorer_dir="${EXPLORER_DIR}"
if [[ "${ATTEMPT_LABEL}" != "primary" ]]; then
  attempt_postcheck_dir="${RUN_DIR}/postcheck-${ATTEMPT_LABEL}"
  attempt_explorer_dir="${RUN_DIR}/explorer-${ATTEMPT_LABEL}"
  mkdir -p "${attempt_postcheck_dir}" "${attempt_explorer_dir}"
fi
attempt_prefix="withdrawal-${ATTEMPT_LABEL}"

require_cmd jq
require_cmd curl
require_cmd openssl
require_cmd docker
ensure_compose_files
ensure_app_secret
resolve_runtime_rpc_port
sync_rpc_app_secret_record

if ! wait_withdrawal_completed "${WITHDRAWAL_ID}" 420; then
  if [[ "${WITHDRAWAL_STATE}" == "FAILED" ]]; then
    fatal "${EXIT_WITHDRAWAL}" "withdrawal ${WITHDRAWAL_ID} reached FAILED"
  fi
  fatal "${EXIT_WITHDRAWAL}" "timeout waiting withdrawal ${WITHDRAWAL_ID} completion"
fi
[[ -n "${WITHDRAWAL_TX_HASH}" ]] || fatal "${EXIT_WITHDRAWAL}" "completed withdrawal ${WITHDRAWAL_ID} missing tx hash"
capture_withdrawal_liquidity_snapshot "${WITHDRAWAL_ID}" "${ARTIFACTS_DIR}/${attempt_prefix}.completed.snapshot.json"
capture_hot_wallet_inventory "${ARTIFACTS_DIR}/${attempt_prefix}.hot-wallet.after.json"

explorer_cmd=(
  env
  "PW_EXPLORER_SESSION=fiber-exp"
  "PW_EXPLORER_TX_HASH=${WITHDRAWAL_TX_HASH}"
  "PW_EXPLORER_TX_URL_TEMPLATE=${EXPLORER_TX_URL_TEMPLATE}"
  "PW_EXPLORER_ARTIFACT_DIR=${attempt_explorer_dir}"
  scripts/playwright-workflow-explorer-proof.sh
)
record_cmd "${explorer_cmd[*]}"
(cd "${ROOT_DIR}" && "${explorer_cmd[@]}") > "${LOGS_DIR}/explorer.${ATTEMPT_LABEL}.log" 2>&1 \
  || fatal "${EXIT_EXPLORER}" "failed to capture explorer screenshot"
EXPLORER_RESULT_JSON="$(extract_result_json "${attempt_explorer_dir}/playwright-explorer-result.log" || true)"
[[ -n "${EXPLORER_RESULT_JSON}" ]] || fatal "${EXIT_EXPLORER}" "missing explorer result payload"

printf '%s\n' "${EXPLORER_RESULT_JSON}" > "${ARTIFACTS_DIR}/${attempt_prefix}.explorer.json"

if [[ "${ATTEMPT_LABEL}" != "primary" ]]; then
  copy_or_fail "${attempt_postcheck_dir}/playwright-step5-author-dashboard.png" "${SCREENSHOT_DIR}/flow4-author-balance-history-${ATTEMPT_LABEL}.png"
  copy_or_fail "${attempt_postcheck_dir}/playwright-step7-admin-withdrawal.png" "${SCREENSHOT_DIR}/flow4-admin-withdrawal-${ATTEMPT_LABEL}.png"
  copy_or_fail "${attempt_explorer_dir}/playwright-flow4-explorer-withdrawal-tx.png" "${SCREENSHOT_DIR}/flow4-explorer-withdrawal-tx-${ATTEMPT_LABEL}.png"
  persist_state_env
  printf 'RESULT=PASS CODE=0 ATTEMPT=%s RUN_DIR=%s WITHDRAWAL_ID=%s\n' "${ATTEMPT_LABEL}" "${RUN_DIR}" "${WITHDRAWAL_ID}"
  exit "${EXIT_OK}"
fi

copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-button.png" "${SCREENSHOT_DIR}/flow1-tip-button.png"
copy_or_fail "${FLOW12_DIR}/playwright-step1-forum-tip-entrypoints.png" "${SCREENSHOT_DIR}/step1-forum-tip-entrypoints.png"
copy_or_fail "${FLOW12_DIR}/playwright-step2-topic-and-reply.png" "${SCREENSHOT_DIR}/step2-topic-and-reply.png"
copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-modal-step1-generate.png" "${SCREENSHOT_DIR}/flow1-tip-modal-step1-generate.png"
copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-modal-step2-pay.png" "${SCREENSHOT_DIR}/flow1-tip-modal-step2-pay.png"
copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-modal-step3-confirmed.png" "${SCREENSHOT_DIR}/flow1-tip-modal-step3-confirmed.png"
copy_or_fail "${FLOW12_DIR}/playwright-flow1-tip-modal-invoice.png" "${SCREENSHOT_DIR}/flow1-tip-modal-invoice.png"
copy_or_fail "${FLOW12_DIR}/playwright-step4-tipper-dashboard.png" "${SCREENSHOT_DIR}/step4-tipper-dashboard.png"
copy_or_fail "${PHASE3_DIR}/playwright-step5-author-dashboard.png" "${SCREENSHOT_DIR}/step5-author-dashboard.png"
copy_or_fail "${PHASE3_DIR}/playwright-step6-author-withdrawal.png" "${SCREENSHOT_DIR}/step6-author-withdrawal.png"
copy_or_fail "${attempt_postcheck_dir}/playwright-step5-author-dashboard.png" "${SCREENSHOT_DIR}/flow4-author-balance-history.png"
copy_or_fail "${attempt_postcheck_dir}/playwright-step7-admin-withdrawal.png" "${SCREENSHOT_DIR}/flow4-admin-withdrawal.png"
copy_or_fail "${attempt_explorer_dir}/playwright-flow4-explorer-withdrawal-tx.png" "${SCREENSHOT_DIR}/flow4-explorer-withdrawal-tx.png"
copy_or_fail "${attempt_postcheck_dir}/playwright-step7-admin-withdrawal.png" "${SCREENSHOT_DIR}/step6-admin-withdrawal.png"
copy_or_fail "${attempt_explorer_dir}/playwright-flow4-explorer-withdrawal-tx.png" "${SCREENSHOT_DIR}/step6-explorer-tx.png"

flow2_tip_create_req="$(json_or_null "${PHASE2_DIR}/tips/topic-post/tip-create.request.json")"
flow2_tip_create_resp="$(json_or_null "${PHASE2_DIR}/tips/topic-post/tip-create.response.json")"
flow2_tip_status_resp="$(last_json_line_or_null "${PHASE2_DIR}/tips/topic-post/tip-status.poll.log")"
flow2_dashboard_resp="$(json_or_null "${PHASE2_DIR}/author-dashboard.json")"
flow2_withdraw_req="$(json_or_null "${ARTIFACTS_DIR}/flow4-withdrawal-request.request.json")"
flow2_withdraw_resp="$(json_or_null "${ARTIFACTS_DIR}/flow4-withdrawal-request.response.json")"

jq -n \
  --argjson tipCreateRequest "${flow2_tip_create_req}" \
  --argjson tipCreateResponse "${flow2_tip_create_resp}" \
  --argjson tipStatusResponse "${flow2_tip_status_resp}" \
  --argjson dashboardSummaryResponse "${flow2_dashboard_resp}" \
  --argjson withdrawalRequestRequest "${flow2_withdraw_req}" \
  --argjson withdrawalRequestResponse "${flow2_withdraw_resp}" \
  '{
    methods: {
      "tip.create": {
        request: $tipCreateRequest,
        response: $tipCreateResponse,
        ok: (($tipCreateResponse.result.invoice // "") != "")
      },
      "tip.status": {
        request: ($tipStatusResponse.id // null),
        response: $tipStatusResponse,
        ok: (($tipStatusResponse.result.state // "") != "")
      },
      "dashboard.summary": {
        request: ($dashboardSummaryResponse.id // null),
        response: $dashboardSummaryResponse,
        ok: (($dashboardSummaryResponse.result.balance // "") != "")
      },
      "withdrawal.request": {
        request: $withdrawalRequestRequest,
        response: $withdrawalRequestResponse,
        ok: (($withdrawalRequestResponse.result.id // "") != "")
      }
    }
  }' > "${ARTIFACTS_DIR}/flow2-rpc-calls.json"

FLOW12_RESULT_JSON="$(extract_result_json "${FLOW12_DIR}/playwright-flow12-result.log" || true)"
forum_entry_ok=false
topic_thread_ok=false
tip_flow_ok=false
tipper_dashboard_ok=false
flow1_ok=false
if [[ -n "${FLOW12_RESULT_JSON}" ]]; then
  forum_entry_ok="$(printf '%s' "${FLOW12_RESULT_JSON}" | jq -r '
    ((.screenshots.forumEntryPoints // "") != "")
    and ((.screenshots.tipButton // "") != "")
  ')"
  topic_thread_ok="$(printf '%s' "${FLOW12_RESULT_JSON}" | jq -r '
    ((.screenshots.topicThread // "") != "")
  ')"
  tip_flow_ok="$(printf '%s' "${FLOW12_RESULT_JSON}" | jq -r '
    ((.screenshots.tipModalStepGenerate // "") != "")
    and ((.screenshots.tipModalStepPay // "") != "")
    and ((.screenshots.tipModalStepConfirmed // "") != "")
    and ((.screenshots.tipModal // "") != "")
    and ((.invoiceQrVisible // false) == true)
    and ((.payment.settled // false) == true)
    and ((.rpc.tipStatus.response.result.state // "") == "SETTLED")
  ')"
  tipper_dashboard_ok="$(printf '%s' "${FLOW12_RESULT_JSON}" | jq -r '
    ((.screenshots.tipperDashboard // "") != "")
    and ((.rpc.dashboardSummary.ok // false) == true)
  ')"
  flow1_ok="$(printf '%s' "${FLOW12_RESULT_JSON}" | jq -r '
    ((.screenshots.forumEntryPoints // "") != "")
    and ((.screenshots.topicThread // "") != "")
    and ((.screenshots.tipButton // "") != "")
    and ((.screenshots.tipModalStepGenerate // "") != "")
    and ((.screenshots.tipModalStepPay // "") != "")
    and ((.screenshots.tipModalStepConfirmed // "") != "")
    and ((.screenshots.tipModal // "") != "")
    and ((.screenshots.tipperDashboard // "") != "")
    and ((.invoiceQrVisible // false) == true)
    and ((.payment.settled // false) == true)
    and ((.rpc.dashboardSummary.ok // false) == true)
    and ((.rpc.tipStatus.response.result.state // "") == "SETTLED")
  ')"
fi

flow2_ok="$(jq -r '.methods | to_entries | all(.value.ok == true)' "${ARTIFACTS_DIR}/flow2-rpc-calls.json" 2>/dev/null || printf 'false')"

flow3_sub_ok=true
if [[ "${RUN_SUBSCRIPTION}" -eq 1 ]]; then
  flow3_sub_ok="$(jq -r '.checks.pass // false' "${ARTIFACTS_DIR}/flow3-subscription.json" 2>/dev/null || printf 'false')"
fi

flow3_poll_ok=true
if [[ "${RUN_POLLING}" -eq 1 ]]; then
  flow3_poll_ok="$(jq -r '.checks.pass // false' "${ARTIFACTS_DIR}/flow3-polling.json" 2>/dev/null || printf 'false')"
fi

flow4_ok=false
if [[ -n "${WITHDRAWAL_ID}" && "${WITHDRAWAL_STATE}" == "COMPLETED" && -n "${WITHDRAWAL_TX_HASH}" ]]; then
  flow4_ok=true
fi

author_dashboard_ok=false
if [[ -n "${AUTHOR_BALANCE}" && "${AUTHOR_TIP_HISTORY_COUNT}" =~ ^[0-9]+$ && "${AUTHOR_TIP_HISTORY_COUNT}" -ge 1 ]]; then
  author_dashboard_ok=true
fi

summary_file="${ARTIFACTS_DIR}/summary.json"
git_sha="${VISUAL_ACCEPTANCE_GIT_SHA:-$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')}"
jq -n \
  --arg artifactDir "${RUN_DIR}" \
  --arg appId "${APP_ID}" \
  --arg gitSha "${git_sha}" \
  --arg withdrawalId "${WITHDRAWAL_ID}" \
  --arg withdrawalState "${WITHDRAWAL_STATE}" \
  --arg withdrawalTxHash "${WITHDRAWAL_TX_HASH}" \
  --arg authorBalance "${AUTHOR_BALANCE}" \
  --arg authorTipHistoryCount "${AUTHOR_TIP_HISTORY_COUNT}" \
  --arg explorerUrl "$(printf '%s' "${EXPLORER_RESULT_JSON}" | jq -r '.explorerUrl // empty')" \
  --argjson forumEntryOk "${forum_entry_ok}" \
  --argjson topicThreadOk "${topic_thread_ok}" \
  --argjson tipFlowOk "${tip_flow_ok}" \
  --argjson tipperDashboardOk "${tipper_dashboard_ok}" \
  --argjson flow1Ok "${flow1_ok}" \
  --argjson flow2Ok "${flow2_ok}" \
  --argjson flow3SubscriptionOk "${flow3_sub_ok}" \
  --argjson flow3PollingOk "${flow3_poll_ok}" \
  --argjson authorDashboardOk "${author_dashboard_ok}" \
  --argjson flow4Ok "${flow4_ok}" \
  '{
    artifactDir: $artifactDir,
    appId: $appId,
    gitSha: $gitSha,
    flows: {
      flow1TipUi: {
        ok: $flow1Ok,
        screenshots: {
          forumEntryPoints: "screenshots/step1-forum-tip-entrypoints.png",
          topicThread: "screenshots/step2-topic-and-reply.png",
          tipButton: "screenshots/flow1-tip-button.png",
          step1Generate: "screenshots/flow1-tip-modal-step1-generate.png",
          step2Pay: "screenshots/flow1-tip-modal-step2-pay.png",
          step3Confirmed: "screenshots/flow1-tip-modal-step3-confirmed.png",
          tipModal: "screenshots/flow1-tip-modal-invoice.png",
          tipperDashboard: "screenshots/step4-tipper-dashboard.png"
        }
      },
      flow2BackendInterfaces: {
        ok: $flow2Ok,
        evidence: "artifacts/flow2-rpc-calls.json"
      },
      flow3Settlement: {
        subscription: {
          ok: $flow3SubscriptionOk,
          evidence: "artifacts/flow3-subscription.json"
        },
        polling: {
          ok: $flow3PollingOk,
          evidence: "artifacts/flow3-polling.json"
        }
      },
      flow4CreatorPanelAndWithdrawal: {
        ok: $flow4Ok,
        authorBalance: $authorBalance,
        authorTipHistoryCount: $authorTipHistoryCount,
        withdrawalId: $withdrawalId,
        withdrawalState: $withdrawalState,
        withdrawalTxHash: $withdrawalTxHash,
        explorerUrl: $explorerUrl,
        screenshots: {
          authorBalanceHistory: "screenshots/flow4-author-balance-history.png",
          adminWithdrawal: "screenshots/flow4-admin-withdrawal.png",
          explorerTx: "screenshots/flow4-explorer-withdrawal-tx.png"
        }
      }
    },
    visualAcceptance: {
      steps: {
        forumEntryPoints: {
          label: "Step 1. Forum shows Fiber Link tip entry points",
          ok: $forumEntryOk,
          screenshots: ["screenshots/step1-forum-tip-entrypoints.png"]
        },
        topicThread: {
          label: "Step 2. Topic and reply render with the plugin enabled",
          ok: $topicThreadOk,
          screenshots: ["screenshots/step2-topic-and-reply.png"]
        },
        tipFlow: {
          label: "Step 3. Tipper generates invoice, sees QR code, and payment settles",
          ok: $tipFlowOk,
          invoiceQrVisible: true,
          screenshots: [
            "screenshots/flow1-tip-modal-step1-generate.png",
            "screenshots/flow1-tip-modal-step2-pay.png",
            "screenshots/flow1-tip-modal-step3-confirmed.png"
          ]
        },
        tipperDashboard: {
          label: "Step 4. Tipper dashboard shows payment history and balance",
          ok: $tipperDashboardOk,
          screenshots: ["screenshots/step4-tipper-dashboard.png"]
        },
        authorDashboard: {
          label: "Step 5. Author dashboard shows payout history and balance",
          ok: $authorDashboardOk,
          authorBalance: $authorBalance,
          authorTipHistoryCount: $authorTipHistoryCount,
          screenshots: ["screenshots/step5-author-dashboard.png"]
        },
        withdrawalCompletion: {
          label: "Step 6. Author withdrawal completes with admin and explorer proof",
          ok: $flow4Ok,
          withdrawalId: $withdrawalId,
          withdrawalState: $withdrawalState,
          withdrawalTxHash: $withdrawalTxHash,
          explorerUrl: $explorerUrl,
          screenshots: [
            "screenshots/step6-author-withdrawal.png",
            "screenshots/step6-admin-withdrawal.png",
            "screenshots/step6-explorer-tx.png"
          ]
        }
      }
    }
  }' > "${summary_file}"

persist_state_env

overall_ok=false
if [[ "${flow1_ok}" == "true" && "${flow2_ok}" == "true" && "${flow3_sub_ok}" == "true" && "${flow3_poll_ok}" == "true" && "${flow4_ok}" == "true" ]]; then
  overall_ok=true
fi

if [[ "${overall_ok}" == "true" ]]; then
  write_checklist "PASS" "all four flows passed"
  printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${RUN_DIR}" "${summary_file}"
  exit "${EXIT_OK}"
fi

fatal "${EXIT_ARTIFACT}" "flow verification failed (see ${summary_file})"
