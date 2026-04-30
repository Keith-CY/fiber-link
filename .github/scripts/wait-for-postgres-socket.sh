#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="${1:-/var/run/postgresql/.s.PGSQL.5432}"
MAX_ATTEMPTS="${2:-180}"

i=0
while (( i < MAX_ATTEMPTS )); do
  if [ -S "$SOCKET_PATH" ]; then
    echo "Postgres socket ready at $SOCKET_PATH"
    exit 0
  fi

  i=$((i + 1))
  sleep 1
done

echo "postgres socket not ready after ${MAX_ATTEMPTS}s: $SOCKET_PATH"
exit 1
