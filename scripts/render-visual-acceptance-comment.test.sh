#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY_FILE="${ROOT_DIR}/scripts/testdata/visual-acceptance-summary.json"
OUTPUT_FILE="$(mktemp)"
SCREENSHOT_DIR="$(mktemp -d)"
trap 'rm -f "${OUTPUT_FILE}"; rm -rf "${SCREENSHOT_DIR}"' EXIT

mkdir -p "${SCREENSHOT_DIR}/screenshots"
touch "${SCREENSHOT_DIR}/screenshots/step1-forum-tip-entrypoints.png"
touch "${SCREENSHOT_DIR}/screenshots/step2-topic-and-reply.png"
touch "${SCREENSHOT_DIR}/screenshots/flow1-tip-modal-step1-generate.png"
touch "${SCREENSHOT_DIR}/screenshots/flow1-tip-modal-step2-pay.png"
touch "${SCREENSHOT_DIR}/screenshots/flow1-tip-modal-step3-confirmed.png"
touch "${SCREENSHOT_DIR}/screenshots/step4-tipper-dashboard.png"
touch "${SCREENSHOT_DIR}/screenshots/step5-author-dashboard.png"
touch "${SCREENSHOT_DIR}/screenshots/step6-author-withdrawal.png"
touch "${SCREENSHOT_DIR}/screenshots/step6-admin-withdrawal.png"
touch "${SCREENSHOT_DIR}/screenshots/step6-explorer-tx.png"

node "${ROOT_DIR}/scripts/render-visual-acceptance-comment.mjs" \
  --summary-file "${SUMMARY_FILE}" \
  --output-file "${OUTPUT_FILE}" \
  --repository "Keith-CY/fiber-link" \
  --run-id "12345" \
  --screenshots-base-url "https://raw.githubusercontent.com/Keith-CY/fiber-link/visual-acceptance/pr-1" \
  --screenshots-dir "${SCREENSHOT_DIR}/screenshots"

grep -q "<!-- fiber-link-visual-acceptance -->" "${OUTPUT_FILE}"
grep -q "## Visual Acceptance" "${OUTPUT_FILE}"
grep -q "Step 1. Forum shows Fiber Link tip entry points" "${OUTPUT_FILE}"
grep -q "Step 6. Author withdrawal completes with admin and explorer proof" "${OUTPUT_FILE}"
grep -q "https://raw.githubusercontent.com/Keith-CY/fiber-link/visual-acceptance/pr-1/screenshots/step4-tipper-dashboard.png" "${OUTPUT_FILE}"
grep -q "https://github.com/Keith-CY/fiber-link/actions/runs/12345" "${OUTPUT_FILE}"
