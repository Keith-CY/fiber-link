#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
OUTPUT_ROOT="$(mktemp -d)"
CLI_OUTPUT="$(mktemp)"
DEFAULT_TMPDIR="$(mktemp -d)"
DEFAULT_OUTPUT_CAPTURE="$(mktemp)"
trap 'rm -rf "${FAKE_BIN_DIR}" "${OUTPUT_ROOT}" "${DEFAULT_TMPDIR}" "${CLI_OUTPUT}" "${DEFAULT_OUTPUT_CAPTURE}"' EXIT

cat > "${FAKE_BIN_DIR}/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "build" ]]; then
  exit 0
fi

if [[ "$1" != "run" ]]; then
  echo "unexpected docker subcommand: $1" >&2
  exit 1
fi

artifact_root=""
runtime_root=""
compose_env_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v)
      if [[ "$2" == *":/artifacts" ]]; then
        artifact_root="${2%%:/artifacts}"
      elif [[ "$2" == *":/runtime:ro" ]]; then
        runtime_root="${2%%:/runtime:ro}"
      fi
      shift 2
      ;;
    --rm|--privileged)
      shift
      ;;
    -e)
      if [[ "$2" == COMPOSE_ENV_FILE=* ]]; then
        compose_env_file="${2#COMPOSE_ENV_FILE=}"
      fi
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[[ -n "${artifact_root}" ]] || {
  echo "missing artifact mount" >&2
  exit 1
}
[[ -n "${runtime_root}" ]] || {
  echo "missing runtime mount" >&2
  exit 1
}
[[ "${compose_env_file}" == "/runtime/compose.env" ]] || {
  echo "unexpected compose env path: ${compose_env_file}" >&2
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
cat > "${artifact_root}/manifest.json" <<'EOF_MANIFEST'
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
touch "${artifact_root}/harness.log"
touch "${artifact_root}/dockerd.log"
EOF_DOCKER
chmod +x "${FAKE_BIN_DIR}/docker"

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

TMPDIR="${DEFAULT_TMPDIR}" \
VISUAL_ACCEPTANCE_FNN_ASSET_SHA256=8f9a69361f662438fa1fc29ddc668192810b13021536ebd1101c84dc0cfa330f \
VISUAL_ACCEPTANCE_DOCKER_BIN="${FAKE_BIN_DIR}/docker" \
  "${ROOT_DIR}/scripts/run-visual-acceptance-local.sh" \
  --image-tag fake-image \
  > "${DEFAULT_OUTPUT_CAPTURE}"

grep -Eq "^Temp output: ${DEFAULT_TMPDIR}/fiber-link-visual-acceptance\\.[A-Za-z0-9]+$" "${DEFAULT_OUTPUT_CAPTURE}"
