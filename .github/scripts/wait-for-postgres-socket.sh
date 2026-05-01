#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="${1:-/var/run/postgresql/.s.PGSQL.5432}"
MAX_ATTEMPTS="${2:-180}"
SOCKET_DIR="$(dirname "$SOCKET_PATH")"

is_ready=false

i=0
while (( i < MAX_ATTEMPTS )); do
  if [ -S "$SOCKET_PATH" ]; then
    if command -v pg_isready >/dev/null 2>&1; then
      if pg_isready -q -h "$SOCKET_DIR" -p 5432 >/dev/null 2>&1; then
        is_ready=true
        break
      fi
    else
      if su - postgres -c "psql -h \"$SOCKET_DIR\" -p 5432 -d postgres -c 'SELECT 1'" >/dev/null 2>&1; then
        is_ready=true
        break
      fi
    fi
  fi

  i=$((i + 1))
  sleep 1
done

if [ "$is_ready" = true ]; then
  echo "Postgres socket ready and accepting connections at $SOCKET_PATH"
  exit 0
fi

echo "postgres not ready to accept connections after ${MAX_ATTEMPTS}s: $SOCKET_PATH"
exit 1
