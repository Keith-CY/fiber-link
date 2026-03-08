#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  printf '[test-e2e-four-flows-split] FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "${haystack}" == *"${needle}"* ]] || fail "expected output to contain '${needle}'"
}

run_help_check() {
  local script_path="$1"
  local output
  output="$("${ROOT_DIR}/${script_path}" --help 2>&1 || true)"
  assert_contains "${output}" "Usage:"
}

make_stub_phase_scripts() {
  local dir="$1"
  mkdir -p "${dir}"

  cat > "${dir}/phase-template.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

phase_name="$(basename "$0")"
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir|--artifact-dir)
      run_dir="$2"
      shift
      ;;
  esac
  shift
done

[[ -n "${run_dir}" ]] || {
  echo "missing --run-dir/--artifact-dir" >&2
  exit 21
}

mkdir -p "${run_dir}/artifacts" "${run_dir}/screenshots" "${run_dir}/logs"
printf '%s\n' "${phase_name}" >> "${run_dir}/phase-order.log"

if [[ "${phase_name}" == "e2e-discourse-four-flows.phase5-explorer-and-finalize.sh" ]]; then
  cat > "${run_dir}/artifacts/summary.json" <<JSON
{"ok":true,"phase":"${phase_name}"}
JSON
  printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${run_dir}" "${run_dir}/artifacts/summary.json"
fi
EOF

  chmod +x "${dir}/phase-template.sh"

  for script_name in \
    e2e-discourse-four-flows.phase1-prepare-and-open.sh \
    e2e-discourse-four-flows.phase2-tip-and-settlement.sh \
    e2e-channel-rotation-seed-legacy-channel.sh \
    e2e-discourse-four-flows.phase3-author-withdrawal.sh \
    e2e-discourse-four-flows.phase4-postcheck.sh \
    e2e-discourse-four-flows.phase5-explorer-and-finalize.sh \
    e2e-discourse-four-flows.liquidity-double-withdrawal.sh; do
    cp "${dir}/phase-template.sh" "${dir}/${script_name}"
  done
}

make_stub_orchestrator() {
  local path="$1"
  cat > "${path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

artifact_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      artifact_dir="$2"
      shift
      ;;
  esac
  shift
done

[[ -n "${artifact_dir}" ]] || {
  echo "missing --artifact-dir" >&2
  exit 31
}

mkdir -p "${artifact_dir}/artifacts" "${artifact_dir}/screenshots"
cat > "${artifact_dir}/artifacts/summary.json" <<JSON
{"ok":true}
JSON
cat > "${artifact_dir}/artifacts/withdrawal-primary.snapshot.json" <<JSON
{"id":"w1","state":"LIQUIDITY_PENDING","liquidityRequestMetadata":{"recoveryStrategy":"CHANNEL_ROTATION","legacyChannelId":"0xlegacy","replacementChannelId":"0xreplacement","expectedRecoveredAmount":"150","channelCloseTxHash":"0xclose"}}
JSON
cat > "${artifact_dir}/artifacts/withdrawal-primary.hot-wallet.before.json" <<JSON
{"asset":"CKB","network":"AGGRON4","availableAmount":"0"}
JSON
cat > "${artifact_dir}/artifacts/withdrawal-primary.hot-wallet.after.json" <<JSON
{"asset":"CKB","network":"AGGRON4","availableAmount":"150"}
JSON
cat > "${artifact_dir}/artifacts/channel-rotation-legacy-seed.json" <<JSON
{"seeded":true,"seededChannelId":"0xlegacy-seeded"}
JSON
cat > "${artifact_dir}/logs.txt" <<LOG
stub orchestrator called
E2E_UNIQUE_WITHDRAW_TO_ADDRESS=${E2E_UNIQUE_WITHDRAW_TO_ADDRESS:-}
LOG
printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${artifact_dir}" "${artifact_dir}/artifacts/summary.json"
EOF
  chmod +x "${path}"
}

test_help_outputs() {
  for script_path in \
    scripts/e2e-discourse-four-flows.phase1-prepare-and-open.sh \
    scripts/e2e-discourse-four-flows.phase2-tip-and-settlement.sh \
    scripts/e2e-channel-rotation-seed-legacy-channel.sh \
    scripts/e2e-discourse-four-flows.phase3-author-withdrawal.sh \
    scripts/e2e-discourse-four-flows.phase4-postcheck.sh \
    scripts/e2e-discourse-four-flows.phase5-explorer-and-finalize.sh \
    scripts/e2e-discourse-four-flows.liquidity-double-withdrawal.sh \
    scripts/e2e-channel-rotation-fallback-smoke.sh; do
    run_help_check "${script_path}"
  done

  local orchestrator_help
  orchestrator_help="$("${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh" --help 2>&1 || true)"
  assert_contains "${orchestrator_help}" "--liquidity-fallback-mode"
}

test_orchestrator_calls_phase_scripts_in_order() {
  local phase_dir="${TMP_DIR}/phase-bin"
  local artifact_dir="${TMP_DIR}/run-artifacts"
  make_stub_phase_scripts "${phase_dir}"

  E2E_FOUR_FLOWS_PHASE_SCRIPT_DIR="${phase_dir}" \
    "${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh" \
    --artifact-dir "${artifact_dir}" \
    --settlement-modes subscription \
    --explorer-tx-url-template 'https://explorer.invalid/tx/%s' \
    --headless >/dev/null

  [[ -f "${artifact_dir}/phase-order.log" ]] || fail "missing phase-order.log"
  diff -u <(cat <<'EOF'
e2e-discourse-four-flows.phase1-prepare-and-open.sh
e2e-discourse-four-flows.phase2-tip-and-settlement.sh
e2e-discourse-four-flows.phase3-author-withdrawal.sh
e2e-discourse-four-flows.phase4-postcheck.sh
e2e-discourse-four-flows.phase5-explorer-and-finalize.sh
EOF
) "${artifact_dir}/phase-order.log" >/dev/null || fail "phase execution order mismatch"
}

test_orchestrator_calls_optional_liquidity_regression_when_enabled() {
  local phase_dir="${TMP_DIR}/phase-bin-liquidity"
  local artifact_dir="${TMP_DIR}/run-artifacts-liquidity"
  make_stub_phase_scripts "${phase_dir}"

  E2E_FOUR_FLOWS_PHASE_SCRIPT_DIR="${phase_dir}" \
    "${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh" \
    --artifact-dir "${artifact_dir}" \
    --settlement-modes subscription \
    --double-withdrawal-regression \
    --explorer-tx-url-template 'https://explorer.invalid/tx/%s' \
    --headless >/dev/null

  [[ -f "${artifact_dir}/phase-order.log" ]] || fail "missing phase-order.log for liquidity regression"
  diff -u <(cat <<'EOF'
e2e-discourse-four-flows.phase1-prepare-and-open.sh
e2e-discourse-four-flows.phase2-tip-and-settlement.sh
e2e-discourse-four-flows.phase3-author-withdrawal.sh
e2e-discourse-four-flows.phase4-postcheck.sh
e2e-discourse-four-flows.phase5-explorer-and-finalize.sh
e2e-discourse-four-flows.liquidity-double-withdrawal.sh
EOF
) "${artifact_dir}/phase-order.log" >/dev/null || fail "phase execution order mismatch with liquidity regression"
}

test_orchestrator_seeds_legacy_channel_before_withdrawal_when_channel_rotation_enabled() {
  local phase_dir="${TMP_DIR}/phase-bin-channel-rotation"
  local artifact_dir="${TMP_DIR}/run-artifacts-channel-rotation"
  make_stub_phase_scripts "${phase_dir}"

  E2E_FOUR_FLOWS_PHASE_SCRIPT_DIR="${phase_dir}" \
    "${ROOT_DIR}/scripts/e2e-discourse-four-flows.sh" \
    --artifact-dir "${artifact_dir}" \
    --settlement-modes subscription \
    --liquidity-fallback-mode channel_rotation \
    --explorer-tx-url-template 'https://explorer.invalid/tx/%s' \
    --headless >/dev/null

  [[ -f "${artifact_dir}/phase-order.log" ]] || fail "missing phase-order.log for channel rotation"
  diff -u <(cat <<'EOF'
e2e-discourse-four-flows.phase1-prepare-and-open.sh
e2e-discourse-four-flows.phase2-tip-and-settlement.sh
e2e-channel-rotation-seed-legacy-channel.sh
e2e-discourse-four-flows.phase3-author-withdrawal.sh
e2e-discourse-four-flows.phase4-postcheck.sh
e2e-discourse-four-flows.phase5-explorer-and-finalize.sh
EOF
) "${artifact_dir}/phase-order.log" >/dev/null || fail "phase execution order mismatch with channel rotation"
}

test_capture_wrapper_can_use_orchestrator_override() {
  local stub_orchestrator="${TMP_DIR}/stub-e2e-orchestrator.sh"
  local output_root="${TMP_DIR}/evidence"
  make_stub_orchestrator "${stub_orchestrator}"

  E2E_FOUR_FLOWS_ORCHESTRATOR_SCRIPT="${stub_orchestrator}" \
    "${ROOT_DIR}/scripts/capture-e2e-discourse-four-flows-evidence.sh" \
    --output-root "${output_root}" \
    --explorer-tx-url-template 'https://explorer.invalid/tx/%s' >/dev/null

  latest_summary="$(find "${output_root}" -name summary.json | head -n1 || true)"
  [[ -n "${latest_summary}" ]] || fail "capture wrapper did not package summary.json"
}

test_channel_rotation_smoke_can_use_orchestrator_override() {
  local stub_orchestrator="${TMP_DIR}/stub-channel-rotation-orchestrator.sh"
  local artifact_dir="${TMP_DIR}/channel-rotation-smoke"
  make_stub_orchestrator "${stub_orchestrator}"

  E2E_FOUR_FLOWS_ORCHESTRATOR_SCRIPT="${stub_orchestrator}" \
    "${ROOT_DIR}/scripts/e2e-channel-rotation-fallback-smoke.sh" \
    --run-dir "${artifact_dir}" \
    --explorer-tx-url-template 'https://explorer.invalid/tx/%s' \
    --headless >/dev/null

  [[ -f "${artifact_dir}/artifacts/withdrawal-primary.snapshot.json" ]] \
    || fail "missing primary withdrawal snapshot"
  [[ -f "${artifact_dir}/artifacts/withdrawal-primary.hot-wallet.before.json" ]] \
    || fail "missing primary hot-wallet before snapshot"
  [[ -f "${artifact_dir}/artifacts/withdrawal-primary.hot-wallet.after.json" ]] \
    || fail "missing primary hot-wallet after snapshot"
  [[ -f "${artifact_dir}/artifacts/channel-rotation-legacy-seed.json" ]] \
    || fail "missing legacy seed artifact"
  [[ -f "${artifact_dir}/artifacts/liquidity-channel-rotation.json" ]] \
    || fail "missing channel rotation smoke summary"
  grep -q 'E2E_UNIQUE_WITHDRAW_TO_ADDRESS=1' "${artifact_dir}/logs.txt" \
    || fail "channel rotation smoke did not enable unique withdraw address mode"
}

test_help_outputs
test_orchestrator_calls_phase_scripts_in_order
test_orchestrator_calls_optional_liquidity_regression_when_enabled
test_orchestrator_seeds_legacy_channel_before_withdrawal_when_channel_rotation_enabled
test_capture_wrapper_can_use_orchestrator_override
test_channel_rotation_smoke_can_use_orchestrator_override

printf '[test-e2e-four-flows-split] PASS\n'
