#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISCOURSE_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
DISCOURSE_REF="${DISCOURSE_REF:-26f3e2aa87a3abb35849183e0740fe7ab84cec67}"
PLUGIN_DIR="${PLUGIN_DIR:-$REPO_ROOT/fiber-link-discourse-plugin}"

DEFAULT_REQUEST_SPECS="plugins/fiber-link/spec/requests/fiber_link_spec.rb plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb"
REQUEST_SPECS="${PLUGIN_SMOKE_REQUEST_SPECS:-$DEFAULT_REQUEST_SPECS}"
EXTRA_SPECS="${PLUGIN_SMOKE_EXTRA_SPECS:-}"

command -v docker >/dev/null 2>&1 || {
  echo "Error: docker is required for local plugin smoke specs."
  exit 1
}
command -v git >/dev/null 2>&1 || {
  echo "Error: git is required for local plugin smoke specs."
  exit 1
}

if [[ ! -d "$DISCOURSE_ROOT/.git" ]]; then
  git clone https://github.com/discourse/discourse.git "$DISCOURSE_ROOT"
fi

git -C "$DISCOURSE_ROOT" fetch --depth=1 origin "$DISCOURSE_REF"
git -C "$DISCOURSE_ROOT" checkout "$DISCOURSE_REF"

mkdir -p "$DISCOURSE_ROOT/plugins"
ln -sfn "$PLUGIN_DIR" "$DISCOURSE_ROOT/plugins/fiber-link"

(
  cd "$DISCOURSE_ROOT"
  ./bin/docker/boot_dev
  LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rake db:create db:migrate

  specs=($REQUEST_SPECS)
  if [[ -n "$EXTRA_SPECS" ]]; then
    # shellcheck disable=SC2206
    specs+=($EXTRA_SPECS)
  fi

  if (( ${#specs[@]} == 0 )); then
    specs=(plugins/fiber-link/spec/requests)
  fi

  LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rspec "${specs[@]}"
)
