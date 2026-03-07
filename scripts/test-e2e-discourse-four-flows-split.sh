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
    e2e-discourse-four-flows.phase3-author-withdrawal.sh \
    e2e-discourse-four-flows.phase4-postcheck.sh \
    e2e-discourse-four-flows.phase5-explorer-and-finalize.sh; do
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
printf 'stub orchestrator called\n' > "${artifact_dir}/logs.txt"
printf 'RESULT=PASS CODE=0 ARTIFACT_DIR=%s SUMMARY=%s\n' "${artifact_dir}" "${artifact_dir}/artifacts/summary.json"
EOF
  chmod +x "${path}"
}

test_help_outputs() {
  for script_path in \
    scripts/e2e-discourse-four-flows.phase1-prepare-and-open.sh \
    scripts/e2e-discourse-four-flows.phase2-tip-and-settlement.sh \
    scripts/e2e-discourse-four-flows.phase3-author-withdrawal.sh \
    scripts/e2e-discourse-four-flows.phase4-postcheck.sh \
    scripts/e2e-discourse-four-flows.phase5-explorer-and-finalize.sh; do
    run_help_check "${script_path}"
  done
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

test_help_outputs
test_orchestrator_calls_phase_scripts_in_order
test_capture_wrapper_can_use_orchestrator_override

printf '[test-e2e-four-flows-split] PASS\n'
