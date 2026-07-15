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

NORMALIZE_TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TEST_TMPDIR}" "${NORMALIZE_TMPDIR}"' EXIT

(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  RUN_DIR="${NORMALIZE_TMPDIR}/run"
  refresh_run_paths
  EXPLORER_TX_URL_TEMPLATE='https://pudge.explorer.nervos.org/transaction/{txHash}}'

  persist_state_env

  grep -q '^EXPLORER_TX_URL_TEMPLATE=https://pudge\.explorer\.nervos\.org/transaction/\\{txHash\\}$' "${STATE_ENV_PATH}"

  EXPLORER_TX_URL_TEMPLATE=""
  load_state_env
  [[ "${EXPLORER_TX_URL_TEMPLATE}" == 'https://pudge.explorer.nervos.org/transaction/{txHash}' ]]
)

COPY_TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TEST_TMPDIR}" "${NORMALIZE_TMPDIR}" "${COPY_TMPDIR}"' EXIT

(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  src="${COPY_TMPDIR}/source.txt"
  dest_one="${COPY_TMPDIR}/one.txt"
  dest_two="${COPY_TMPDIR}/two.txt"

  printf 'copy me\n' > "${src}"
  copy_or_fail_many "${src}" "${dest_one}" "${dest_two}"

  diff -u "${src}" "${dest_one}" >/dev/null
  diff -u "${src}" "${dest_two}" >/dev/null
)

FAUCET_TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TEST_TMPDIR}" "${NORMALIZE_TMPDIR}" "${COPY_TMPDIR}" "${FAUCET_TMPDIR}"' EXIT

# Faucet retry: two transient 504s then success must be accepted, with two
# retry log lines and no fatal.
(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  ARTIFACTS_DIR="${FAUCET_TMPDIR}"
  CKB_FAUCET_ENABLE_FALLBACK=0
  CKB_FAUCET_WAIT_SECONDS=0
  CKB_FAUCET_RETRY_INTERVAL_SECONDS=0
  CURL_COUNT_FILE="${FAUCET_TMPDIR}/curl.count"
  printf '0' > "${CURL_COUNT_FILE}"

  log() { printf '%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet.log"; }
  sleep() { :; }
  fatal() { printf 'fatal:%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet.log"; exit 90; }

  curl() {
    local out=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi
    done
    local n
    n=$(( $(cat "${CURL_COUNT_FILE}") + 1 ))
    printf '%s' "${n}" > "${CURL_COUNT_FILE}"
    if [[ "${n}" -lt 3 ]]; then
      printf '' > "${out}"
      printf '504'
    else
      printf '{}' > "${out}"
      printf '200'
    fi
    return 0
  }

  request_ckb_faucet_for_address "ckt1qtestaddress" "retry-case"

  [[ "$(cat "${CURL_COUNT_FILE}")" == "3" ]]
  [[ "$(grep -c 'transient failure (http=504)' "${FAUCET_TMPDIR}/faucet.log")" == "2" ]]
  grep -q 'ckb faucet(retry-case) accepted' "${FAUCET_TMPDIR}/faucet.log"
  ! grep -q '^fatal:' "${FAUCET_TMPDIR}/faucet.log"
)

# Faucet retry: a hard 4xx (403) must fail fast without retries.
(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  ARTIFACTS_DIR="${FAUCET_TMPDIR}"
  CKB_FAUCET_ENABLE_FALLBACK=0
  CKB_FAUCET_RETRY_INTERVAL_SECONDS=0
  CURL_COUNT_FILE="${FAUCET_TMPDIR}/curl-hard.count"
  printf '0' > "${CURL_COUNT_FILE}"

  log() { printf '%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet-hard.log"; }
  sleep() { :; }
  fatal() { printf 'fatal:%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet-hard.log"; exit 90; }

  curl() {
    local out=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi
    done
    local n
    n=$(( $(cat "${CURL_COUNT_FILE}") + 1 ))
    printf '%s' "${n}" > "${CURL_COUNT_FILE}"
    printf '' > "${out}"
    printf '403'
    return 0
  }

  rc=0
  ( request_ckb_faucet_for_address "ckt1qtestaddress" "hard-case" ) || rc=$?
  [[ "${rc}" == "90" ]]
  [[ "$(cat "${CURL_COUNT_FILE}")" == "1" ]]
  grep -q 'fatal:.*http=403' "${FAUCET_TMPDIR}/faucet-hard.log"
)

# Hot-wallet inventory retry: two docker failures then success.
(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  HOT_WALLET_INVENTORY_RETRY_INTERVAL_SECONDS=0
  DOCKER_COUNT_FILE="${FAUCET_TMPDIR}/docker.count"
  printf '0' > "${DOCKER_COUNT_FILE}"

  log() { printf '%s\n' "$*" >> "${FAUCET_TMPDIR}/inventory.log"; }
  sleep() { :; }
  fatal() { printf 'fatal:%s\n' "$*" >> "${FAUCET_TMPDIR}/inventory.log"; exit 90; }

  docker() {
    local n
    n=$(( $(cat "${DOCKER_COUNT_FILE}") + 1 ))
    printf '%s' "${n}" > "${DOCKER_COUNT_FILE}"
    if [[ "${n}" -lt 3 ]]; then
      return 1
    fi
    printf '{"asset":"CKB","availableAmount":"1"}\n'
    return 0
  }

  capture_hot_wallet_inventory "${FAUCET_TMPDIR}/inventory.json" "CKB" "AGGRON4"

  [[ "$(cat "${DOCKER_COUNT_FILE}")" == "3" ]]
  grep -q '"availableAmount":"1"' "${FAUCET_TMPDIR}/inventory.json"
  [[ "$(grep -c 'inventory capture failed; retry' "${FAUCET_TMPDIR}/inventory.log")" == "2" ]]
  ! grep -q '^fatal:' "${FAUCET_TMPDIR}/inventory.log"
)


# Faucet retry: a 2xx response carrying a logical error body is permanent —
# must fail fast without retries.
(
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/e2e-discourse-four-flows-common.sh"

  ARTIFACTS_DIR="${FAUCET_TMPDIR}"
  CKB_FAUCET_ENABLE_FALLBACK=0
  CKB_FAUCET_RETRY_INTERVAL_SECONDS=0
  CURL_COUNT_FILE="${FAUCET_TMPDIR}/curl-logical.count"
  printf '0' > "${CURL_COUNT_FILE}"

  log() { printf '%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet-logical.log"; }
  sleep() { :; }
  fatal() { printf 'fatal:%s\n' "$*" >> "${FAUCET_TMPDIR}/faucet-logical.log"; exit 90; }

  curl() {
    local out=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi
    done
    local n
    n=$(( $(cat "${CURL_COUNT_FILE}") + 1 ))
    printf '%s' "${n}" > "${CURL_COUNT_FILE}"
    printf '{"error":"address already claimed"}' > "${out}"
    printf '200'
    return 0
  }

  rc=0
  ( request_ckb_faucet_for_address "ckt1qtestaddress" "logical-case" ) || rc=$?
  [[ "${rc}" == "90" ]]
  [[ "$(cat "${CURL_COUNT_FILE}")" == "1" ]]
  grep -q 'fatal:.*http=200' "${FAUCET_TMPDIR}/faucet-logical.log"
)

printf 'e2e-discourse-four-flows-common checks passed\n'
