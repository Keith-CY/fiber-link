#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISCOURSE_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
DISCOURSE_REF="${DISCOURSE_REF:-26f3e2aa87a3abb35849183e0740fe7ab84cec67}"
PLUGIN_SMOKE_SKIP_FETCH="${PLUGIN_SMOKE_SKIP_FETCH:-0}"
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

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "Error: plugin directory not found: $PLUGIN_DIR"
  exit 1
fi

if [[ "$PLUGIN_SMOKE_SKIP_FETCH" != "1" ]]; then
  if ! git -C "$DISCOURSE_ROOT" fetch --depth=1 origin "$DISCOURSE_REF"; then
    echo "Warning: failed to fetch Discourse ref $DISCOURSE_REF; continuing with existing local checkout."
  fi
else
  echo "Skipping Discourse fetch because PLUGIN_SMOKE_SKIP_FETCH=1."
fi

if ! git -C "$DISCOURSE_ROOT" checkout "$DISCOURSE_REF"; then
  current_ref="$(git -C "$DISCOURSE_ROOT" rev-parse --short HEAD)"
  echo "Warning: failed to checkout $DISCOURSE_REF; continuing on current ref $current_ref."
fi

# Force rebuild plugin frontend bundle from current source instead of stale dist artifacts.
rm -f "$DISCOURSE_ROOT/frontend/discourse/dist/assets/plugins/fiber-link.js"
rm -f "$DISCOURSE_ROOT/frontend/discourse/dist/assets/plugins/fiber-link.map"

mkdir -p "$DISCOURSE_ROOT/plugins"
ln -sfn "$PLUGIN_DIR" "$DISCOURSE_ROOT/plugins/fiber-link"

(
  cd "$DISCOURSE_ROOT"
  if docker ps -a --format '{{.Names}}' | grep -qx 'discourse_dev'; then
    docker start discourse_dev >/dev/null 2>&1 || true
  else
    ./bin/docker/boot_dev
  fi
  LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rake db:create db:migrate

  specs=($REQUEST_SPECS)
  if [[ -n "$EXTRA_SPECS" ]]; then
    # shellcheck disable=SC2206
    specs+=($EXTRA_SPECS)
  fi

  if (( ${#specs[@]} == 0 )); then
    specs=(plugins/fiber-link/spec/requests)
  fi

  needs_playwright_runtime=0
  for spec in "${specs[@]}"; do
    if [[ "$spec" == *"/spec/system/"* ]]; then
      needs_playwright_runtime=1
      break
    fi
  done

  if (( needs_playwright_runtime )); then
    echo "Ensuring plugin frontend assets are precompiled for system specs..."
    plugin_assets_fingerprint="$(
      find "$PLUGIN_DIR/assets/javascripts" -type f | sort | while IFS= read -r path; do
        shasum "$path"
      done | shasum | awk '{print $1}'
    )"
    plugin_assets_fingerprint_file="$DISCOURSE_ROOT/tmp/fiber-link-system-assets.sha"
    cached_fingerprint=""
    if [[ -f "$plugin_assets_fingerprint_file" ]]; then
      cached_fingerprint="$(cat "$plugin_assets_fingerprint_file")"
    fi

    if [[ "$plugin_assets_fingerprint" != "$cached_fingerprint" ]]; then
      LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rake assets:precompile
      printf "%s" "$plugin_assets_fingerprint" > "$plugin_assets_fingerprint_file"
    else
      echo "Plugin frontend assets unchanged; skipping assets:precompile."
    fi

    echo "Preparing Playwright runtime dependencies for system specs..."
    if ! docker exec -u root discourse_dev bash -lc \
      "dpkg -s libatk1.0-0 libatk-bridge2.0-0 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 >/dev/null 2>&1"; then
      docker exec -u root discourse_dev bash -lc \
        "apt-get update -qq && apt-get install -y -qq libatk1.0-0 libatk-bridge2.0-0 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2"
    else
      echo "Playwright system dependencies already installed."
    fi

    if ! docker exec -u discourse discourse_dev bash -lc \
      "compgen -G '/home/discourse/.cache/ms-playwright/chromium-*/chrome-linux/chrome' >/dev/null"; then
      docker exec -u discourse discourse_dev bash -lc \
        "cd /src && pnpm playwright-install chromium"
    else
      echo "Playwright Chromium already installed."
    fi
  fi

  LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rspec "${specs[@]}"
)
