#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_CODE_FILE="${ROOT_DIR}/scripts/playwright/workflow-author-withdrawal.run-code.js"

grep -q 'data-fiber-link-withdrawal-result="id"' "${RUN_CODE_FILE}"

if grep -q 'data-fiber-link-withdrawal-result="success"' "${RUN_CODE_FILE}"; then
  echo "author withdrawal workflow should wait for the persisted request id, not the removed success banner" >&2
  exit 1
fi
