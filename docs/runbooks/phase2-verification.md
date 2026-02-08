# Phase 2 Verification Gate

This runbook is the required verification gate for Phase 2 changes (happy path plus failure path).

## Service (Bun) Tests

Run all service tests:

```bash
cd fiber-link-service
bun install --frozen-lockfile

cd apps/rpc && bun run test -- --run --silent
cd ../admin && bun run test -- --run --silent
cd ../worker && bun run test -- --run --silent
cd ../../packages/db && bun run test -- --run --silent
```

## Discourse Plugin Smoke/Specs

Prereqs:
- Docker daemon running (the Discourse dev harness uses Docker).

Bootstrap a local Discourse dev checkout and link the plugin (idempotent):

```bash
export FIBER_LINK_ROOT="${FIBER_LINK_ROOT:-$(pwd)}"
export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"

[ -d "$DISCOURSE_DEV_ROOT/.git" ] || git clone https://github.com/discourse/discourse.git "$DISCOURSE_DEV_ROOT"

mkdir -p "$DISCOURSE_DEV_ROOT/plugins"
ln -sfn "$FIBER_LINK_ROOT/fiber-link-discourse-plugin" "$DISCOURSE_DEV_ROOT/plugins/fiber-link-discourse-plugin"

cd "$DISCOURSE_DEV_ROOT"
./bin/docker/boot_dev
RAILS_ENV=test ./bin/docker/rake db:create db:migrate
```

Run plugin specs:

```bash
export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
cd "$DISCOURSE_DEV_ROOT"

# Smoke
./bin/docker/rspec plugins/fiber-link-discourse-plugin/spec/requests/fiber_link_spec.rb

# System (tip lifecycle)
./bin/docker/rspec plugins/fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb
```

## Security/Failure Gates (Must Verify)

These scenarios must be verified before merge/deploy. Some are covered by unit tests; others may require environment setup.

- replay nonce rejected
  - Covered by: `fiber-link-service/apps/rpc/src/nonce-store.test.ts`
- unauthorized appId rejected
  - Expected behavior: when per-app secrets are enforced (no global fallback), unknown `x-app-id` must be rejected.
- invalid signature rejected
  - Covered by: `fiber-link-service/apps/rpc/src/rpc.test.ts` ("does not burn nonce when signature is invalid")
- insufficient funds withdrawal rejected
  - Expected behavior: withdrawal request should be rejected when user balance is insufficient.
- worker restart does not duplicate ledger credit
  - Covered by: `fiber-link-service/apps/worker/src/settlement.test.ts` ("ignores duplicate settlement events for same tip_intent")
- transient withdrawal failure retries then recovers
  - Covered by: `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts` ("moves transient failure to RETRY_PENDING with nextRetryAt")

