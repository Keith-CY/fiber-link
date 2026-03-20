#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_RUNNER_DIR="$(mktemp -d)"
FAKE_BIN_DIR="$(mktemp -d)"
OUTPUT_ROOT="$(mktemp -d)"
CLI_OUTPUT="$(mktemp)"
DEFAULT_TMPDIR="$(mktemp -d)"
DEFAULT_OUTPUT_CAPTURE="$(mktemp)"
trap 'rm -rf "${FAKE_RUNNER_DIR}" "${FAKE_BIN_DIR}" "${OUTPUT_ROOT}" "${DEFAULT_TMPDIR}" "${CLI_OUTPUT}" "${DEFAULT_OUTPUT_CAPTURE}"' EXIT

cat > "${FAKE_BIN_DIR}/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "build" ]]; then
  exit 0
fi

echo "unexpected docker subcommand: $1" >&2
exit 1
EOF_DOCKER
chmod +x "${FAKE_BIN_DIR}/docker"

cat > "${FAKE_RUNNER_DIR}/visual-acceptance-runner" <<'EOF_RUNNER'
#!/usr/bin/env bash
set -euo pipefail

artifact_root="${VISUAL_ACCEPTANCE_ARTIFACT_ROOT:-}"
output_root="${VISUAL_ACCEPTANCE_OUTPUT_ROOT:-}"
manifest_path="${VISUAL_ACCEPTANCE_MANIFEST_PATH:-}"
log_path="${VISUAL_ACCEPTANCE_HARNESS_LOG_PATH:-}"
compose_env_file="${COMPOSE_ENV_FILE:-}"
legacy_env_file="${ENV_FILE:-}"
git_sha="${VISUAL_ACCEPTANCE_GIT_SHA:-}"
git_branch="${VISUAL_ACCEPTANCE_GIT_BRANCH:-}"
discourse_ui_base_url="${E2E_DISCOURSE_UI_BASE_URL:-}"
host_access_host="${E2E_HOST_ACCESS_HOST:-}"
host_access_base_url="${E2E_HOST_ACCESS_BASE_URL:-}"
sidecar_host_access_host="${PLAYWRIGHT_CLI_HOST_ACCESS_HOST:-}"
discourse_dev_root="${DISCOURSE_DEV_ROOT:-}"
explorer_template="${VISUAL_ACCEPTANCE_EXPLORER_TX_URL_TEMPLATE:-}"
playwright_image="${PLAYWRIGHT_CLI_DOCKER_IMAGE:-}"
network_container="${PLAYWRIGHT_CLI_DOCKER_NETWORK_CONTAINER:-}"
source_artifact_root="${E2E_SOURCE_ARTIFACT_ROOT:-}"
flow12_payer_rpc_base_url="${PW_FLOW12_PAYER_RPC_BASE_URL:-}"
flow12_backend_ready_url="${PW_FLOW12_BACKEND_READY_URL:-}"
demo_backend_ready_url="${PW_DEMO_BACKEND_READY_URL:-}"
author_withdrawal_backend_ready_url="${PW_AUTHOR_WITHDRAWAL_BACKEND_READY_URL:-}"
runtime_root="$(dirname "${compose_env_file}")"

[[ -n "${artifact_root}" ]] || {
  echo "missing artifact root" >&2
  exit 1
}
[[ -n "${runtime_root}" ]] || {
  echo "missing runtime mount" >&2
  exit 1
}
[[ "${compose_env_file}" == "${runtime_root}/compose.env" ]] || {
  echo "unexpected compose env path: ${compose_env_file}" >&2
  exit 1
}
[[ "${legacy_env_file}" == "${runtime_root}/compose.env" ]] || {
  echo "unexpected legacy env path: ${legacy_env_file}" >&2
  exit 1
}
[[ -n "${git_sha}" ]] || {
  echo "missing host git sha" >&2
  exit 1
}
[[ -n "${git_branch}" ]] || {
  echo "missing host git branch" >&2
  exit 1
}
[[ "${host_access_host}" == "127.0.0.1" ]] || {
  echo "unexpected host access host: ${host_access_host}" >&2
  exit 1
}
[[ "${host_access_base_url}" == "http://127.0.0.1" ]] || {
  echo "unexpected host access base url: ${host_access_base_url}" >&2
  exit 1
}
[[ "${discourse_dev_root}" == "${runtime_root}/discourse-dev" ]] || {
  echo "unexpected discourse dev root: ${discourse_dev_root}" >&2
  exit 1
}
[[ "${discourse_ui_base_url}" == "http://host.docker.internal:4200" ]] || {
  echo "unexpected discourse ui base url: ${discourse_ui_base_url}" >&2
  exit 1
}
[[ "${explorer_template}" == "https://pudge.explorer.nervos.org/transaction/{txHash}" ]] || {
  echo "unexpected explorer template: ${explorer_template}" >&2
  exit 1
}
[[ "${output_root}" == "${artifact_root}/evidence" ]] || {
  echo "unexpected output root: ${output_root}" >&2
  exit 1
}
[[ "${manifest_path}" == "${artifact_root}/manifest.json" ]] || {
  echo "unexpected manifest path: ${manifest_path}" >&2
  exit 1
}
[[ "${log_path}" == "${artifact_root}/harness.log" ]] || {
  echo "unexpected log path: ${log_path}" >&2
  exit 1
}
[[ "${playwright_image}" == "fake-image" ]] || {
  echo "unexpected playwright image: ${playwright_image}" >&2
  exit 1
}
[[ -z "${network_container}" ]] || {
  echo "unexpected network container: ${network_container}" >&2
  exit 1
}
[[ "${sidecar_host_access_host}" == "host.docker.internal" ]] || {
  echo "unexpected sidecar host access host: ${sidecar_host_access_host}" >&2
  exit 1
}
[[ "${flow12_payer_rpc_base_url}" == "http://host.docker.internal" ]] || {
  echo "unexpected flow12 payer rpc base url: ${flow12_payer_rpc_base_url}" >&2
  exit 1
}
[[ "${flow12_backend_ready_url}" == "http://host.docker.internal:9292/session/csrf.json" ]] || {
  echo "unexpected flow12 backend ready url: ${flow12_backend_ready_url}" >&2
  exit 1
}
[[ "${demo_backend_ready_url}" == "http://host.docker.internal:9292/session/csrf.json" ]] || {
  echo "unexpected demo backend ready url: ${demo_backend_ready_url}" >&2
  exit 1
}
[[ "${author_withdrawal_backend_ready_url}" == "http://host.docker.internal:9292/session/csrf.json" ]] || {
  echo "unexpected author withdrawal backend ready url: ${author_withdrawal_backend_ready_url}" >&2
  exit 1
}
[[ "${source_artifact_root}" == "${runtime_root}/source-artifacts" ]] || {
  echo "unexpected source artifact root: ${source_artifact_root}" >&2
  exit 1
}
[[ -f "${runtime_root}/compose.env" ]] || {
  echo "missing runtime compose env" >&2
  exit 1
}
grep -Eq '^FNN_ASSET_SHA256=[0-9a-f]{64}$' "${runtime_root}/compose.env"
grep -q '^POSTGRES_PASSWORD=visual-acceptance-postgres-password$' "${runtime_root}/compose.env"
grep -q '^FIBER_LINK_HMAC_SECRET=visual-acceptance-hmac-secret$' "${runtime_root}/compose.env"

mkdir -p "${artifact_root}/evidence/fake/screenshots"
touch "${artifact_root}/evidence/fake/screenshots/step1-forum-tip-entrypoints.png"
cat > "${manifest_path}" <<'EOF_MANIFEST'
{
  "status": "PASS",
  "summaryFile": "evidence/fake/summary.json",
  "screenshotsDir": "evidence/fake/screenshots",
  "archiveFile": "evidence/fake.tar.gz"
}
EOF_MANIFEST
cat > "${artifact_root}/evidence/fake/summary.json" <<'EOF_SUMMARY'
{"visualAcceptance":{"steps":{}}}
EOF_SUMMARY
touch "${artifact_root}/evidence/fake.tar.gz"
touch "${log_path}"
EOF_RUNNER
chmod +x "${FAKE_RUNNER_DIR}/visual-acceptance-runner"

VISUAL_ACCEPTANCE_RUNNER_SCRIPT="${FAKE_RUNNER_DIR}/visual-acceptance-runner" \
VISUAL_ACCEPTANCE_FNN_ASSET_SHA256=8f9a69361f662438fa1fc29ddc668192810b13021536ebd1101c84dc0cfa330f \
VISUAL_ACCEPTANCE_DOCKER_BIN="${FAKE_BIN_DIR}/docker" \
  "${ROOT_DIR}/scripts/run-visual-acceptance-local.sh" \
  --output-dir "${OUTPUT_ROOT}" \
  --image-tag fake-image \
  > "${CLI_OUTPUT}"

grep -q "^Temp output: ${OUTPUT_ROOT}$" "${CLI_OUTPUT}"
grep -q "^Manifest: ${OUTPUT_ROOT}/manifest.json$" "${CLI_OUTPUT}"
grep -q "^Summary: ${OUTPUT_ROOT}/evidence/fake/summary.json$" "${CLI_OUTPUT}"
grep -q "^Screenshots: ${OUTPUT_ROOT}/evidence/fake/screenshots$" "${CLI_OUTPUT}"
grep -q "^Archive: ${OUTPUT_ROOT}/evidence/fake.tar.gz$" "${CLI_OUTPUT}"

VISUAL_ACCEPTANCE_RUNNER_SCRIPT="${FAKE_RUNNER_DIR}/visual-acceptance-runner" \
TMPDIR="${DEFAULT_TMPDIR}" \
VISUAL_ACCEPTANCE_FNN_ASSET_SHA256=8f9a69361f662438fa1fc29ddc668192810b13021536ebd1101c84dc0cfa330f \
VISUAL_ACCEPTANCE_DOCKER_BIN="${FAKE_BIN_DIR}/docker" \
  "${ROOT_DIR}/scripts/run-visual-acceptance-local.sh" \
  --skip-build \
  --image-tag fake-image \
  > "${DEFAULT_OUTPUT_CAPTURE}"

grep -Eq "^Temp output: ${DEFAULT_TMPDIR}/fiber-link-visual-acceptance\\.[A-Za-z0-9]+$" "${DEFAULT_OUTPUT_CAPTURE}"
