#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/fiber_link}"
export DATABASE_URL

echo "Applying migrations (pass 1)..."
bunx drizzle-kit migrate --config=drizzle.config.ts

echo "Applying migrations (pass 2, expected no-op)..."
bunx drizzle-kit migrate --config=drizzle.config.ts
