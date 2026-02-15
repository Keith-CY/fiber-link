# Phase 2 Verification Gate

This runbook is the required verification gate for Phase 2 changes (happy path plus failure path).

## Deployment Evidence Capture

For standardized deployment evidence (artifacts, checklist, and retention policy), run:

```bash
scripts/capture-deployment-evidence.sh --invoice-id <invoice_id> --settlement-id <settlement_id_or_tx_hash>
```

Reference:

- `docs/runbooks/deployment-evidence.md`

## Service (Bun) Tests

Run all service tests:

```bash
cd fiber-link-service
bun install --frozen-lockfile

(cd apps/rpc && bun run test -- --run --silent) && \
(cd apps/admin && bun run test -- --run --silent) && \
(cd apps/worker && bun run test -- --run --silent) && \
(cd packages/db && bun run test -- --run --silent)
```

## Discourse Plugin Smoke/Specs

Prereqs:
- Docker daemon running (the Discourse dev harness uses Docker).
- Ruby/Gem environment **is optional** (script runs through the Discourse container, so no local `bundle exec` required).

Use the repo helper script for a single local entrypoint:

```bash
./scripts/plugin-smoke.sh
```

Default scope (request specs):
```bash
plugins/fiber-link/spec/requests/fiber_link_spec.rb
plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb
```

Run only additional scopes by extending the env var (example for system spec):

```bash
PLUGIN_SMOKE_EXTRA_SPECS="plugins/fiber-link/spec/system/fiber_link_tip_spec.rb plugins/fiber-link/spec/system/fiber_link_feed_spec.rb" \
  ./scripts/plugin-smoke.sh
```

Override the default Discourse checkout location/ref if needed:

```bash
export DISCOURSE_DEV_ROOT=/tmp/discourse-dev
export DISCOURSE_REF=26f3e2aa87a3abb35849183e0740fe7ab84cec67
./scripts/plugin-smoke.sh
```

Legacy fallback (for environments without the helper script):

```bash
export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"
cd "$DISCOURSE_DEV_ROOT"
./bin/docker/boot_dev
LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rake db:create db:migrate
LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rspec plugins/fiber-link/spec/requests/fiber_link_spec.rb
```

If specs fail:
- Ensure the plugin path is `plugins/fiber-link`.
- Confirm Discourse boot is healthy (`docker ps`, `docker logs` on the latest booted container).
- For verbose output, run the rspec target directly inside the same Discourse checkout:
  `LOAD_PLUGINS=1 RAILS_ENV=test ./bin/docker/rspec --format documentation plugins/fiber-link/spec/requests/fiber_link_spec.rb`.

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

## Security Assumptions Gate

Before merge/deploy, verify the current assumptions register in:
- `docs/runbooks/security-assumptions.md`
- `docs/runbooks/threat-model-evidence-checklist.md`

Minimum checks:
- Assumption version/date is current for this release.
- Owners/contacts are still valid.
- W1 checklist items used in this release have attached command/test evidence.
- Operational boundaries still match code/config defaults:
  - `rg -n "NONCE_TTL_MS" fiber-link-service/apps/rpc/src/rpc.ts`
  - `rg -n "WORKER_MAX_RETRIES|WORKER_RETRY_DELAY_MS|WORKER_SETTLEMENT_INTERVAL_MS|WORKER_SETTLEMENT_BATCH_SIZE" fiber-link-service/apps/worker/src/entry.ts`
