#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SOURCE_ENV_FILE="${ROOT_DIR}/deploy/compose/.env"
DEFAULT_TEMPLATE_ENV_FILE="${ROOT_DIR}/deploy/compose/.env.example"
OUTPUT_PATH=""
SOURCE_ENV_FILE="${VISUAL_ACCEPTANCE_COMPOSE_ENV_FILE:-}"

usage() {
  cat <<'USAGE'
Usage: scripts/prepare-visual-acceptance-compose-env.sh --output <path> [--source <path>]

Create a runnable compose env file for visual-acceptance execution without mutating
the repository copy of deploy/compose/.env.
USAGE
}

get_env_value_from_file() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "${file}" | tail -n1 || true)"
  [[ -n "${line}" ]] || {
    printf ''
    return
  }
  printf '%s' "${line#*=}" | tr -d '\r'
}

set_env_value_in_file() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file
  temp_file="$(mktemp)"
  awk -v wanted_key="${key}" -v new_value="${value}" '
    BEGIN { replaced = 0 }
    index($0, wanted_key "=") == 1 {
      print wanted_key "=" new_value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print wanted_key "=" new_value
      }
    }
  ' "${file}" > "${temp_file}"
  mv "${temp_file}" "${file}"
}

needs_placeholder_value() {
  local value="$1"
  [[ -z "${value}" || "${value}" == "change-me-before-prod" || "${value}" == "replace-with-release-sha256" ]]
}

is_valid_sha256() {
  local value="$1"
  [[ "${value}" =~ ^[0-9a-fA-F]{64}$ ]]
}

to_lower_hex() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

release_api_json() {
  local version="$1"
  local api_url="https://api.github.com/repos/nervosnetwork/fiber/releases/tags/${version}"
  local -a curl_args
  curl_args=(
    -fsSL
    -H
    "Accept: application/vnd.github+json"
  )
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  elif [[ -n "${GH_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GH_TOKEN}")
  fi

  curl_args+=("${api_url}")
  curl "${curl_args[@]}"
}

resolve_fnn_asset_sha256() {
  local version="$1"
  local asset="$2"
  local forced_sha="${VISUAL_ACCEPTANCE_FNN_ASSET_SHA256:-}"
  local release_json digest download_url

  if is_valid_sha256 "${forced_sha}"; then
    printf '%s' "${forced_sha,,}"
    return 0
  fi

  release_json="$(release_api_json "${version}")"
  digest="$(printf '%s' "${release_json}" | jq -r --arg asset "${asset}" '.assets[] | select(.name == $asset) | (.digest // "")' | head -n1)"
  if [[ "${digest}" == sha256:* ]]; then
    digest="${digest#sha256:}"
  fi
  if is_valid_sha256 "${digest}"; then
    to_lower_hex "${digest}"
    return 0
  fi

  download_url="$(printf '%s' "${release_json}" | jq -r --arg asset "${asset}" '.assets[] | select(.name == $asset) | .browser_download_url' | head -n1)"
  [[ -n "${download_url}" ]] || {
    printf 'failed to resolve download url for %s %s\n' "${version}" "${asset}" >&2
    return 1
  }

  curl -fsSL "${download_url}" | sha256sum | awk '{print $1}'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      OUTPUT_PATH="$2"
      shift
      ;;
    --source)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      SOURCE_ENV_FILE="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

[[ -n "${OUTPUT_PATH}" ]] || { usage >&2; exit 2; }

if [[ -z "${SOURCE_ENV_FILE}" ]]; then
  if [[ -f "${DEFAULT_SOURCE_ENV_FILE}" ]]; then
    SOURCE_ENV_FILE="${DEFAULT_SOURCE_ENV_FILE}"
  else
    SOURCE_ENV_FILE="${DEFAULT_TEMPLATE_ENV_FILE}"
  fi
fi

[[ -f "${SOURCE_ENV_FILE}" ]] || {
  printf 'missing source env file: %s\n' "${SOURCE_ENV_FILE}" >&2
  exit 10
}

mkdir -p "$(dirname "${OUTPUT_PATH}")"
cp "${SOURCE_ENV_FILE}" "${OUTPUT_PATH}"

current_postgres_password="$(get_env_value_from_file "${OUTPUT_PATH}" POSTGRES_PASSWORD)"
current_fiber_secret_password="$(get_env_value_from_file "${OUTPUT_PATH}" FIBER_SECRET_KEY_PASSWORD)"
current_hmac_secret="$(get_env_value_from_file "${OUTPUT_PATH}" FIBER_LINK_HMAC_SECRET)"
current_fnn_asset_sha="$(get_env_value_from_file "${OUTPUT_PATH}" FNN_ASSET_SHA256)"
fnn_version="$(get_env_value_from_file "${OUTPUT_PATH}" FNN_VERSION)"
fnn_asset="$(get_env_value_from_file "${OUTPUT_PATH}" FNN_ASSET)"

if needs_placeholder_value "${current_postgres_password}"; then
  set_env_value_in_file "${OUTPUT_PATH}" POSTGRES_PASSWORD "visual-acceptance-postgres-password"
fi
if needs_placeholder_value "${current_fiber_secret_password}"; then
  set_env_value_in_file "${OUTPUT_PATH}" FIBER_SECRET_KEY_PASSWORD "visual-acceptance-fiber-secret-password"
fi
if needs_placeholder_value "${current_hmac_secret}"; then
  set_env_value_in_file "${OUTPUT_PATH}" FIBER_LINK_HMAC_SECRET "visual-acceptance-hmac-secret"
fi

if ! is_valid_sha256 "${current_fnn_asset_sha}"; then
  [[ -n "${fnn_version}" && -n "${fnn_asset}" ]] || {
    printf 'missing FNN_VERSION or FNN_ASSET in %s\n' "${OUTPUT_PATH}" >&2
    exit 10
  }
  resolved_sha="$(resolve_fnn_asset_sha256 "${fnn_version}" "${fnn_asset}")"
  is_valid_sha256 "${resolved_sha}" || {
    printf 'failed to resolve a valid sha256 for %s %s\n' "${fnn_version}" "${fnn_asset}" >&2
    exit 10
  }
  set_env_value_in_file "${OUTPUT_PATH}" FNN_ASSET_SHA256 "${resolved_sha}"
fi

printf 'RESULT=PASS OUTPUT=%s SOURCE=%s\n' "${OUTPUT_PATH}" "${SOURCE_ENV_FILE}"
