#!/usr/bin/env bash
# Point a Discourse checkout's bin/docker/boot_dev at a pinned dev image.
#
# boot_dev hardcodes `discourse/discourse_dev:release`, a floating tag that
# moved to Ruby 4 while DISCOURSE_REF's Gemfile still requires `ruby "~> 3.3"`,
# so `bundle install` aborts. Rewriting the reference in the checkout (which
# is re-fetched on every run) keeps the image in lockstep with DISCOURSE_REF.
# Keep the default in sync with DISCOURSE_DEV_IMAGE in .github/workflows/ci.yml.
set -euo pipefail

DISCOURSE_DEV_IMAGE="${DISCOURSE_DEV_IMAGE:-discourse/discourse_dev:20260925-0545@sha256:1db7981a20cdff0b55f3f265e7b40163128e04dacaa29cf51ee475f28b6a36e5}"

discourse_root="${1:?usage: pin-discourse-dev-image.sh <discourse-root>}"
boot_dev="${discourse_root}/bin/docker/boot_dev"
[[ -f "${boot_dev}" ]] || {
  printf 'missing boot_dev: %s\n' "${boot_dev}" >&2
  exit 1
}

sed -i.bak "s#discourse/discourse_dev:release#${DISCOURSE_DEV_IMAGE}#g" "${boot_dev}"
rm -f "${boot_dev}.bak"
