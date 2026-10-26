#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

mkdir -p "${WORK_DIR}/bin/docker"
cat > "${WORK_DIR}/bin/docker/boot_dev" <<'BOOT'
docker pull discourse/discourse_dev:release
docker run -d --name=discourse_dev discourse/discourse_dev:release /sbin/boot
BOOT
chmod +x "${WORK_DIR}/bin/docker/boot_dev"

DISCOURSE_DEV_IMAGE="example/discourse_dev:pinned@sha256:abc" \
  "${ROOT_DIR}/scripts/pin-discourse-dev-image.sh" "${WORK_DIR}"

grep -q "docker pull example/discourse_dev:pinned@sha256:abc" "${WORK_DIR}/bin/docker/boot_dev"
grep -q "discourse_dev example/discourse_dev:pinned@sha256:abc /sbin/boot" "${WORK_DIR}/bin/docker/boot_dev"
! grep -q "discourse_dev:release" "${WORK_DIR}/bin/docker/boot_dev"
[[ -x "${WORK_DIR}/bin/docker/boot_dev" ]]

# The default pin must match the plugin-smoke image in CI.
ci_image="$(sed -n 's/^ *DISCOURSE_DEV_IMAGE: //p' "${ROOT_DIR}/.github/workflows/ci.yml")"
grep -q "DISCOURSE_DEV_IMAGE:-${ci_image}}" "${ROOT_DIR}/scripts/pin-discourse-dev-image.sh"

if "${ROOT_DIR}/scripts/pin-discourse-dev-image.sh" "${WORK_DIR}/missing" 2>/dev/null; then
  echo "expected failure for a checkout without boot_dev" >&2
  exit 1
fi

echo "pin-discourse-dev-image tests passed"
