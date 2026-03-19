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
legacy_env_file=""
git_sha=""
git_branch=""
discourse_ui_base_url=""
host_access_host=""
host_access_base_url=""
discourse_dev_root=""
docker_socket_mount=0
host_gateway_alias=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-host)
      if [[ "$2" == "host.docker.internal:host-gateway" ]]; then
        host_gateway_alias=1
      fi
      shift 2
      ;;
    -v)
      mount_spec="$2"
      if [[ "${mount_spec}" == /var/run/docker.sock:/var/run/docker.sock ]]; then
        docker_socket_mount=1
      elif [[ "${mount_spec}" == *":${runtime_root}" ]]; then
        :
      elif [[ "${mount_spec}" == *"/compose.env" ]]; then
        :
      elif [[ "${mount_spec}" == *":"* ]]; then
        host_mount="${mount_spec%%:*}"
        container_mount="${mount_spec#*:}"
        if [[ "${host_mount}" == "${container_mount}" && "${host_mount}" == *"/fiber-link-visual-acceptance-runtime."* ]]; then
          runtime_root="${host_mount}"
        elif [[ "${host_mount}" == "${container_mount}" && "${host_mount}" == *"/fiber-link-visual-acceptance"* ]]; then
          artifact_root="${host_mount}"
        fi
      fi
      shift 2
      ;;
    --rm)
      shift
      ;;
    -e)
      if [[ "$2" == VISUAL_ACCEPTANCE_ARTIFACT_ROOT=* ]]; then
        artifact_root="${2#VISUAL_ACCEPTANCE_ARTIFACT_ROOT=}"
      elif [[ "$2" == COMPOSE_ENV_FILE=* ]]; then
        compose_env_file="${2#COMPOSE_ENV_FILE=}"
      elif [[ "$2" == ENV_FILE=* ]]; then
        legacy_env_file="${2#ENV_FILE=}"
      elif [[ "$2" == VISUAL_ACCEPTANCE_GIT_SHA=* ]]; then
        git_sha="${2#VISUAL_ACCEPTANCE_GIT_SHA=}"
      elif [[ "$2" == VISUAL_ACCEPTANCE_GIT_BRANCH=* ]]; then
        git_branch="${2#VISUAL_ACCEPTANCE_GIT_BRANCH=}"
      elif [[ "$2" == E2E_DISCOURSE_UI_BASE_URL=* ]]; then
        discourse_ui_base_url="${2#E2E_DISCOURSE_UI_BASE_URL=}"
      elif [[ "$2" == E2E_HOST_ACCESS_HOST=* ]]; then
        host_access_host="${2#E2E_HOST_ACCESS_HOST=}"
      elif [[ "$2" == E2E_HOST_ACCESS_BASE_URL=* ]]; then
        host_access_base_url="${2#E2E_HOST_ACCESS_BASE_URL=}"
      elif [[ "$2" == DISCOURSE_DEV_ROOT=* ]]; then
        discourse_dev_root="${2#DISCOURSE_DEV_ROOT=}"
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
[[ "${docker_socket_mount}" -eq 1 ]] || {
  echo "missing docker socket mount" >&2
  exit 1
}
[[ "${host_gateway_alias}" -eq 1 ]] || {
  echo "missing host gateway alias" >&2
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
[[ "${host_access_host}" == "host.docker.internal" ]] || {
  echo "unexpected host access host: ${host_access_host}" >&2
  exit 1
}
[[ "${host_access_base_url}" == "http://host.docker.internal" ]] || {
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
