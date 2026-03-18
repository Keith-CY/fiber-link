#!/usr/bin/env bash
set -euo pipefail

if command -v npx >/dev/null 2>&1; then
  exec npx --yes --package @playwright/cli playwright-cli "$@"
fi

echo "Error: npx is required but was not found on PATH." >&2
exit 1
