#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/private/tmp/discourse-dev-fiber-link}"
DISCOURSE_DEV_CONTAINER="${DISCOURSE_DEV_CONTAINER:-discourse_dev}"
DISCOURSE_BACKEND_READY_URL="${DISCOURSE_BACKEND_READY_URL:-http://127.0.0.1:9292/session/csrf.json}"
DISCOURSE_BACKEND_LOGIN_URL="${DISCOURSE_BACKEND_LOGIN_URL:-http://127.0.0.1:9292/login}"
POLL_INTERVAL_SECONDS="${DISCOURSE_DEV_POLL_INTERVAL_SECONDS:-2}"
BACKEND_WAIT_SECONDS="${DISCOURSE_DEV_BACKEND_WAIT_SECONDS:-180}"
BOOT_WAIT_SECONDS="${DISCOURSE_DEV_BOOT_WAIT_SECONDS:-600}"
APT_TIMEOUT_SECONDS="${DISCOURSE_DEV_APT_TIMEOUT_SECONDS:-300}"
PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS="${DISCOURSE_DEV_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS:-600}"
SYSTEM_PACKAGES=(
  libatk1.0-0
  libatk-bridge2.0-0
  libxkbcommon0
  libatspi2.0-0
  libxcomposite1
  libxdamage1
  libxfixes3
  libxrandr2
  libgbm1
  libasound2
)

ARTIFACT_DIR="${DISCOURSE_DEV_RUNTIME_ARTIFACT_DIR:-$ROOT_DIR/.tmp/discourse-dev-runtime/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$ARTIFACT_DIR"

ENSURE_CONTAINER=1
ENSURE_BACKEND=1
INSTALL_PLAYWRIGHT=0
CLOBBER_ASSETS=0
PRECOMPILE_TEST_ASSETS=0
SKIP_PLAYWRIGHT_SYSTEM_DEPS=0

log() {
  echo "[ensure-discourse-dev] $*"
}

fatal() {
  echo "[ensure-discourse-dev] error: $*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: scripts/ensure-discourse-dev-runtime.sh [options]

Options:
  --container-only        Ensure discourse_dev container is running, skip backend/browser setup
  --no-backend            Do not start or verify the unicorn backend
  --install-playwright    Install Playwright system deps and Chromium browser in discourse_dev
  --skip-playwright-system-deps
                         Skip apt-based Playwright system packages and only install Chromium
  --clobber-assets        Run bin/rake assets:clobber before restarting the backend
  --precompile-test-assets
                         Build test assets after optional clobber so system specs pick up fresh plugin JS
  --help                  Show this help

Environment:
  DISCOURSE_DEV_ROOT                    default: /private/tmp/discourse-dev-fiber-link
  DISCOURSE_DEV_CONTAINER               default: discourse_dev
  DISCOURSE_BACKEND_READY_URL           default: http://127.0.0.1:9292/session/csrf.json
  DISCOURSE_DEV_POLL_INTERVAL_SECONDS   default: 2
  DISCOURSE_DEV_BACKEND_WAIT_SECONDS    default: 180
  DISCOURSE_DEV_BOOT_WAIT_SECONDS       default: 600
  DISCOURSE_DEV_APT_TIMEOUT_SECONDS     default: 300
  DISCOURSE_DEV_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS default: 600
  DISCOURSE_DEV_RUNTIME_ARTIFACT_DIR    override artifact/log directory
EOF
}

while (($#)); do
  case "$1" in
    --container-only)
      ENSURE_BACKEND=0
      INSTALL_PLAYWRIGHT=0
      CLOBBER_ASSETS=0
      shift
      ;;
    --no-backend)
      ENSURE_BACKEND=0
      shift
      ;;
    --install-playwright)
      INSTALL_PLAYWRIGHT=1
      shift
      ;;
    --skip-playwright-system-deps)
      SKIP_PLAYWRIGHT_SYSTEM_DEPS=1
      shift
      ;;
    --clobber-assets)
      CLOBBER_ASSETS=1
      shift
      ;;
    --precompile-test-assets)
      PRECOMPILE_TEST_ASSETS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fatal "unknown argument: $1"
      ;;
  esac
done

run_as_discourse() {
  docker exec -u discourse:discourse -w /src "$DISCOURSE_DEV_CONTAINER" sh -lc "$1"
}

run_as_root() {
  docker exec -u root -w /src "$DISCOURSE_DEV_CONTAINER" sh -lc "$1"
}

wait_http_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while ((SECONDS < deadline)); do
    if curl --max-time 5 -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  return 1
}

ensure_container_running() {
  if docker ps --format '{{.Names}}' | grep -qx "$DISCOURSE_DEV_CONTAINER"; then
    log "container already running: $DISCOURSE_DEV_CONTAINER"
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$DISCOURSE_DEV_CONTAINER"; then
    log "starting existing container: $DISCOURSE_DEV_CONTAINER"
    if docker start "$DISCOURSE_DEV_CONTAINER" >/dev/null 2>&1; then
      return 0
    fi

    local inspect_state
    inspect_state="$(docker inspect -f '{{.State.RemovalInProgress}} {{.State.Dead}}' "$DISCOURSE_DEV_CONTAINER" 2>/dev/null || true)"
    if [[ "$inspect_state" == "true false" || "$inspect_state" == "true true" ]]; then
      log "removing stale container marked for removal: $DISCOURSE_DEV_CONTAINER"
      docker rm -f "$DISCOURSE_DEV_CONTAINER" >/dev/null 2>&1 || true
    else
      fatal "failed to start existing container: $DISCOURSE_DEV_CONTAINER"
    fi
  fi

  local boot_dev="$DISCOURSE_DEV_ROOT/bin/docker/boot_dev"
  [[ -x "$boot_dev" ]] || fatal "missing boot_dev wrapper: $boot_dev"

  local boot_log="$ARTIFACT_DIR/boot-dev.log"
  log "booting discourse_dev via $boot_dev"
  if ! script -q /dev/null "$boot_dev" >"$boot_log" 2>&1; then
    tail -n 80 "$boot_log" >&2 || true
    fatal "boot_dev failed (see $boot_log)"
  fi

  local deadline=$((SECONDS + BOOT_WAIT_SECONDS))
  while ((SECONDS < deadline)); do
    if docker ps --format '{{.Names}}' | grep -qx "$DISCOURSE_DEV_CONTAINER"; then
      log "container is running: $DISCOURSE_DEV_CONTAINER"
      return 0
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  fatal "container did not start within ${BOOT_WAIT_SECONDS}s"
}

cleanup_discourse_unicorn() {
  run_as_root "
    unicorn_pid_path='/src/tmp/pids/unicorn.pid'
    if [ -f \"\$unicorn_pid_path\" ]; then
      pid=\$(cat \"\$unicorn_pid_path\" 2>/dev/null || true)
      if [ -n \"\$pid\" ] && kill -0 \"\$pid\" 2>/dev/null; then
        kill -9 \"\$pid\" >/dev/null 2>&1 || true
      fi
      rm -f \"\$unicorn_pid_path\" >/dev/null 2>&1 || true
    fi
    pkill -f '[u]nicorn master' >/dev/null 2>&1 || true
    pkill -f '[b]in/unicorn' >/dev/null 2>&1 || true
  " >/dev/null 2>&1 || true
}

cleanup_stale_playwright_processes() {
  run_as_root "
    pkill -f 'node node_modules/playwright/cli.js install' >/dev/null 2>&1 || true
    pkill -f 'pnpm playwright-install chromium' >/dev/null 2>&1 || true
    pkill -f 'node_modules/.bin/playwright --help' >/dev/null 2>&1 || true
    pkill -f 'compgen -G /home/discourse/.cache/ms-playwright' >/dev/null 2>&1 || true
    pkill -f 'find /home/discourse/.cache/ms-playwright' >/dev/null 2>&1 || true
  " >/dev/null 2>&1 || true
}

clobber_assets_if_requested() {
  if (( ! CLOBBER_ASSETS )); then
    return 0
  fi

  log "clobbering stale frontend assets"
  run_as_discourse "bin/rake assets:clobber" >"$ARTIFACT_DIR/assets-clobber.log" 2>&1 || {
    tail -n 80 "$ARTIFACT_DIR/assets-clobber.log" >&2 || true
    fatal "assets:clobber failed"
  }
  cleanup_discourse_unicorn
  CLOBBER_ASSETS=0
}

precompile_test_assets() {
  local rake_wrapper="$DISCOURSE_DEV_ROOT/bin/docker/rake"
  [[ -x "$rake_wrapper" ]] || fatal "missing rake wrapper: $rake_wrapper"

  log "precompiling test assets"
  if ! script -q /dev/null "$rake_wrapper" assets:precompile LOAD_PLUGINS=1 RAILS_ENV=test >"$ARTIFACT_DIR/assets-precompile.log" 2>&1; then
    tail -n 120 "$ARTIFACT_DIR/assets-precompile.log" >&2 || true
    fatal "assets:precompile failed"
  fi
}

ensure_discourse_backend() {
  clobber_assets_if_requested

  if wait_http_ready "$DISCOURSE_BACKEND_READY_URL" 5; then
    if curl -fsS -m 5 "$DISCOURSE_BACKEND_LOGIN_URL" 2>/dev/null | grep -q "Ember CLI is Required in Development Mode"; then
      log "backend is running without proxy bypass; restarting unicorn"
      cleanup_discourse_unicorn
    else
      log "backend already ready: $DISCOURSE_BACKEND_READY_URL"
      return 0
    fi
  fi

  local unicorn_log="$ARTIFACT_DIR/discourse-unicorn.log"
  log "starting discourse unicorn backend"
  docker exec -u discourse:discourse -w /src "$DISCOURSE_DEV_CONTAINER" \
    sh -lc 'ALLOW_EMBER_CLI_PROXY_BYPASS=1 bin/unicorn' >"$unicorn_log" 2>&1 &

  if ! wait_http_ready "$DISCOURSE_BACKEND_READY_URL" "$BACKEND_WAIT_SECONDS"; then
    tail -n 120 "$unicorn_log" >&2 || true
    fatal "backend did not become ready at $DISCOURSE_BACKEND_READY_URL"
  fi

  log "backend ready: $DISCOURSE_BACKEND_READY_URL"
}

ensure_playwright_runtime() {
  local pkg_check_cmd pkg_install_cmd apt_options
  pkg_check_cmd="dpkg -s ${SYSTEM_PACKAGES[*]} >/dev/null 2>&1"
  apt_options="-o Acquire::ForceIPv4=true -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20"
  pkg_install_cmd="timeout ${APT_TIMEOUT_SECONDS} sh -lc 'apt-get ${apt_options} update -qq && apt-get ${apt_options} install -y -qq ${SYSTEM_PACKAGES[*]}'"

  cleanup_stale_playwright_processes

  if (( SKIP_PLAYWRIGHT_SYSTEM_DEPS )); then
    log "skipping Playwright system package install by request"
  elif run_as_root "$pkg_check_cmd"; then
    log "Playwright system packages already installed"
  else
    log "installing Playwright system packages"
    run_as_root "$pkg_install_cmd" >"$ARTIFACT_DIR/playwright-system-deps.log" 2>&1 || {
      tail -n 120 "$ARTIFACT_DIR/playwright-system-deps.log" >&2 || true
      fatal "failed to install Playwright system packages within ${APT_TIMEOUT_SECONDS}s"
    }
  fi

  log "installing Playwright Chromium"
  run_as_discourse "timeout ${PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS} pnpm playwright-install chromium" >"$ARTIFACT_DIR/playwright-install.log" 2>&1 || {
    tail -n 120 "$ARTIFACT_DIR/playwright-install.log" >&2 || true
    fatal "failed to install Playwright Chromium within ${PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS}s"
  }
}

main() {
  ensure_container_running

  if (( INSTALL_PLAYWRIGHT )); then
    ensure_playwright_runtime
  fi

  if (( PRECOMPILE_TEST_ASSETS )); then
    clobber_assets_if_requested
    precompile_test_assets
  fi

  if (( ENSURE_BACKEND )); then
    ensure_discourse_backend
  fi

  log "artifact dir: $ARTIFACT_DIR"
  log "done"
}

main "$@"
