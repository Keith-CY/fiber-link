#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
ARGS_FILE="$(mktemp)"
trap 'rm -rf "${FAKE_BIN_DIR}" "${ARGS_FILE}"' EXIT

cat > "${FAKE_BIN_DIR}/npx" <<'EOF_NPX'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${PLAYWRIGHT_CLI_ARGS_FILE}"
EOF_NPX
chmod +x "${FAKE_BIN_DIR}/npx"

run_wrapper() {
  : > "${ARGS_FILE}"
  PATH="${FAKE_BIN_DIR}:${PATH}" \
  PLAYWRIGHT_CLI_ARGS_FILE="${ARGS_FILE}" \
    "${ROOT_DIR}/scripts/playwright-cli.sh" "$@"
}

assert_arg_present() {
  local expected="$1"
  grep -Fx -- "${expected}" "${ARGS_FILE}" >/dev/null || {
    echo "missing arg: ${expected}" >&2
    cat "${ARGS_FILE}" >&2
    exit 1
  }
}

assert_arg_absent() {
  local unexpected="$1"
  if grep -Fx -- "${unexpected}" "${ARGS_FILE}" >/dev/null; then
    echo "unexpected arg: ${unexpected}" >&2
    cat "${ARGS_FILE}" >&2
    exit 1
  fi
}

run_wrapper open about:blank
assert_arg_present "playwright-cli"
assert_arg_present "open"
assert_arg_present "about:blank"
assert_arg_present "--browser=chromium"

run_wrapper -s=fiber-flow open about:blank --headed
assert_arg_present "-s=fiber-flow"
assert_arg_present "--headed"
assert_arg_present "--browser=chromium"

run_wrapper open about:blank --browser=chrome
assert_arg_present "--browser=chrome"
assert_arg_absent "--browser=chromium"

run_wrapper close
assert_arg_present "close"
assert_arg_absent "--browser=chromium"
