#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMPDIR="$(mktemp -d)"
CALL_LOG="${TEST_TMPDIR}/calls.log"
OUTPUT_LOG="${TEST_TMPDIR}/output.log"
trap 'rm -rf "${TEST_TMPDIR}"' EXIT

(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  LOGS_DIR="${TEST_TMPDIR}"
  DISCOURSE_UI_BASE_URL="http://host.docker.internal:4200"
  HOST_ACCESS_BASE_URL="http://172.17.0.1"

  wait_http_ready() {
    printf 'http:%s:%s\n' "$1" "$2" >> "${CALL_LOG}"
    return 1
  }

  wait_discourse_ui_ready_in_container() {
    printf 'container:%s\n' "$1" >> "${CALL_LOG}"
    return 0
  }

  log() {
    printf '%s\n' "$*" >> "${OUTPUT_LOG}"
  }

  vlog() {
    :
  }

  ensure_discourse_ui_proxy
)

grep -q '^http:http://host.docker.internal:4200/login:120$' "${CALL_LOG}"
grep -q '^container:20$' "${CALL_LOG}"
grep -q 'configured UI is not reachable at http://host.docker.internal:4200/login' "${OUTPUT_LOG}"
