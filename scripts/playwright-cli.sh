#!/usr/bin/env bash
set -euo pipefail

PLAYWRIGHT_CLI_BROWSER="${PLAYWRIGHT_CLI_BROWSER:-chromium}"
has_explicit_browser=0
uses_open_command=0
forwarded_args=()

for arg in "$@"; do
  case "${arg}" in
    --browser|--browser=*)
      has_explicit_browser=1
      ;;
    open)
      uses_open_command=1
      ;;
  esac
  forwarded_args+=("${arg}")
done

if [[ "${uses_open_command}" -eq 1 && "${has_explicit_browser}" -eq 0 && -n "${PLAYWRIGHT_CLI_BROWSER}" ]]; then
  forwarded_args+=("--browser=${PLAYWRIGHT_CLI_BROWSER}")
fi

if command -v npx >/dev/null 2>&1; then
  exec npx --yes --package @playwright/cli playwright-cli "${forwarded_args[@]}"
fi

echo "Error: npx is required but was not found on PATH." >&2
exit 1
