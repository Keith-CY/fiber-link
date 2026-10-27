#!/usr/bin/env bash
# Point a Discourse checkout's bin/docker/boot_dev at a pinned dev image.
#
# boot_dev hardcodes `discourse/discourse_dev:release`, a floating tag that
# moved to Ruby 4 while DISCOURSE_REF's Gemfile still requires `ruby "~> 3.3"`,
# so `bundle install` aborts. This rewrites the complete image reference on
# boot_dev's `docker pull <image>` and `<image> /sbin/boot` lines, whatever
# they currently hold, so re-running it on a reused checkout (including with a
# different DISCOURSE_DEV_IMAGE) always converges on exactly one image.
# Keep the default in sync with DISCOURSE_DEV_IMAGE in .github/workflows/ci.yml.
set -euo pipefail

DISCOURSE_DEV_IMAGE="${DISCOURSE_DEV_IMAGE:-discourse/discourse_dev:20260925-0545@sha256:1db7981a20cdff0b55f3f265e7b40163128e04dacaa29cf51ee475f28b6a36e5}"

discourse_root="${1:?usage: pin-discourse-dev-image.sh <discourse-root>}"
boot_dev="${discourse_root}/bin/docker/boot_dev"
[[ -f "${boot_dev}" ]] || {
  printf 'missing boot_dev: %s\n' "${boot_dev}" >&2
  exit 1
}
[[ "${DISCOURSE_DEV_IMAGE}" =~ ^[^[:space:]#\\]+$ ]] || {
  printf 'invalid DISCOURSE_DEV_IMAGE: %s\n' "${DISCOURSE_DEV_IMAGE}" >&2
  exit 1
}

pull_pattern='^([[:space:]]*docker pull )[^[:space:]]+[[:space:]]*$'
run_pattern='^([[:space:]]*)[^[:space:]]+( /sbin/boot)[[:space:]]*$'
pull_count="$(grep -Ec "${pull_pattern}" "${boot_dev}" || true)"
run_count="$(grep -Ec "${run_pattern}" "${boot_dev}" || true)"
if [[ "${pull_count}" != 1 || "${run_count}" != 1 ]]; then
  printf 'unexpected boot_dev layout in %s (pull lines: %s, run lines: %s)\n' \
    "${boot_dev}" "${pull_count}" "${run_count}" >&2
  exit 1
fi

sed -E -i.bak \
  -e "s#${pull_pattern}#\\1${DISCOURSE_DEV_IMAGE}#" \
  -e "s#${run_pattern}#\\1${DISCOURSE_DEV_IMAGE}\\2#" \
  "${boot_dev}"
rm -f "${boot_dev}.bak"

pulled="$(grep -E "${pull_pattern}" "${boot_dev}" | awk '{print $3}')"
booted="$(grep -E "${run_pattern}" "${boot_dev}" | awk '{print $1}')"
if [[ "${pulled}" != "${DISCOURSE_DEV_IMAGE}" || "${booted}" != "${DISCOURSE_DEV_IMAGE}" ]]; then
  printf 'failed to pin %s in %s (pull: %s, run: %s)\n' \
    "${DISCOURSE_DEV_IMAGE}" "${boot_dev}" "${pulled}" "${booted}" >&2
  exit 1
fi
