#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="${ROOT_DIR}/scripts/pin-discourse-dev-image.sh"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

BOOT_DEV="${WORK_DIR}/bin/docker/boot_dev"
mkdir -p "$(dirname "${BOOT_DEV}")"
# Mirrors the image-bearing lines of upstream bin/docker/boot_dev.
cat > "${BOOT_DEV}" <<'BOOT'
if [ "$(uname -m)" == "aarch64" ]; then
    # Avoiding `docker pull` so we don't override that local image.
    ENV_ARGS+=" -e SE_MANAGER_PATH=/usr/local/bin/selenium-manager "
else
    docker pull discourse/discourse_dev:release
fi

docker run -d \
    --name=discourse_dev \
    discourse/discourse_dev:release /sbin/boot
BOOT
chmod +x "${BOOT_DEV}"

assert_pinned() {
  local image="$1"
  grep -Fxq "    docker pull ${image}" "${BOOT_DEV}"
  grep -Fxq "    ${image} /sbin/boot" "${BOOT_DEV}"
}

DISCOURSE_DEV_IMAGE="example/discourse_dev:pinned@sha256:abc" "${PIN}" "${WORK_DIR}"
assert_pinned "example/discourse_dev:pinned@sha256:abc"
if grep -q "discourse_dev:release" "${BOOT_DEV}"; then
  echo "floating release tag left in boot_dev" >&2
  exit 1
fi
[[ -x "${BOOT_DEV}" ]]

# A reused checkout picks up a changed override instead of keeping the old pin.
DISCOURSE_DEV_IMAGE="other/image:2" "${PIN}" "${WORK_DIR}"
assert_pinned "other/image:2"

# Re-pinning the same release@digest reference is idempotent.
for _ in 1 2 3; do
  DISCOURSE_DEV_IMAGE="discourse/discourse_dev:release@sha256:def" "${PIN}" "${WORK_DIR}"
done
assert_pinned "discourse/discourse_dev:release@sha256:def"

# The default pin must match the plugin-smoke image in CI.
ci_image="$(sed -n 's/^ *DISCOURSE_DEV_IMAGE: //p' "${ROOT_DIR}/.github/workflows/ci.yml")"
"${PIN}" "${WORK_DIR}"
assert_pinned "${ci_image}"

if DISCOURSE_DEV_IMAGE="bad image" "${PIN}" "${WORK_DIR}" 2>/dev/null; then
  echo "expected failure for an invalid image reference" >&2
  exit 1
fi

if "${PIN}" "${WORK_DIR}/missing" 2>/dev/null; then
  echo "expected failure for a checkout without boot_dev" >&2
  exit 1
fi

# An unrecognized wrapper layout fails loudly instead of silently not pinning.
printf 'docker run discourse/discourse_dev:release\n' > "${BOOT_DEV}"
if "${PIN}" "${WORK_DIR}" 2>/dev/null; then
  echo "expected failure for an unrecognized boot_dev layout" >&2
  exit 1
fi

echo "pin-discourse-dev-image tests passed"
