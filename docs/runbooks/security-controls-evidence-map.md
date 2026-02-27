# Security Controls to Evidence Map

Version: `2026-02-27`
Scope: auditable security-control mapping for invoice lifecycle flows

This document maps each control to verifiable repo evidence so reviewers can validate in one pass.

## Control Mapping Table

| Control ID | Control objective | Flow coverage | Code path evidence | Config evidence | Log / test evidence |
| --- | --- | --- | --- | --- | --- |
| SCM-01 | Authenticate RPC caller and block replay requests | shared precondition for all RPC flows | `fiber-link-service/apps/rpc/src/rpc.ts` (`verifyHmac.check`, timestamp freshness, nonce replay check) | `FIBER_LINK_HMAC_SECRET`, `FIBER_LINK_NONCE_REDIS_URL`, `NONCE_TTL_MS` in `fiber-link-service/apps/rpc/src/rpc.ts` | `fiber-link-service/apps/rpc/src/rpc.test.ts` (`does not burn nonce when signature is invalid`), `fiber-link-service/apps/rpc/src/nonce-store.test.ts` |
| SCM-02 | Validate and normalize invoice creation from Fiber RPC | `create_invoice` | `fiber-link-service/packages/fiber-adapter/src/index.ts` (`createInvoice` using method `create_invoice`) and `fiber-link-service/apps/rpc/src/methods/tip.ts` (`handleTipCreate`) | `FIBER_RPC_URL` required in `fiber-link-service/apps/rpc/src/methods/tip.ts` | `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts` (`createInvoice calls node rpc...`, `createInvoice throws when invoice is missing...`), `fiber-link-service/apps/rpc/src/methods/tip.test.ts` (`creates a tip intent with invoice`) |
| SCM-03 | Return stable invoice state with standardized `tip.status` error behavior | `tip.status` | `fiber-link-service/apps/rpc/src/rpc.ts` (`TipStatusSchema`, dispatch for `tip.status`, not-found mapping `-32004`), `fiber-link-service/apps/rpc/src/methods/tip.ts` (`handleTipStatus`) | `FIBER_RPC_URL` required in `getDefaultAdapter` path (`fiber-link-service/apps/rpc/src/methods/tip.ts`) | `fiber-link-service/apps/rpc/src/rpc.test.ts` (`returns tip.status result from handler`, `returns JSON-RPC error on invalid tip.status params`, `returns standardized tip.status not-found error`), `fiber-link-service/apps/rpc/src/methods/tip.test.ts` (`returns UNPAID...`, `updates and returns SETTLED...`, `updates and returns FAILED...`) |
| SCM-04 | Ingest settlements idempotently and prevent duplicate credits | settlement ingestion | `fiber-link-service/apps/worker/src/settlement.ts` (`markSettled`, idempotency key `settlement:tip_intent:<id>`) and `fiber-link-service/packages/db/src/ledger-repo.ts` (`creditOnce`) | settlement polling knobs in `deploy/compose/.env.example`: `WORKER_SETTLEMENT_INTERVAL_MS`, `WORKER_SETTLEMENT_BATCH_SIZE` | `fiber-link-service/apps/worker/src/settlement.test.ts` (`ignores duplicate settlement events for same tip_intent`, `marks invoice SETTLED even when credit already exists...`) |
| SCM-05 | Verify settlement state via replay-safe polling/backfill path | settlement verification | `fiber-link-service/apps/worker/src/settlement-discovery.ts` (`runSettlementDiscovery`) and `fiber-link-service/apps/worker/src/scripts/backfill-settlements.ts` | `FIBER_RPC_URL`, `WORKER_SETTLEMENT_INTERVAL_MS`, `WORKER_SETTLEMENT_BATCH_SIZE` | Worker log keys: `[worker] settlement discovery item failed`, `[worker] settlement discovery summary`; tests in `fiber-link-service/apps/worker/src/settlement-discovery.test.ts` (`is idempotent for replays...`, `supports app and time-window filters for backfill`) |
| SCM-06 | Bound RPC abuse with per-app/method request limits | RPC request handling | `fiber-link-service/apps/rpc/src/rpc.ts` (rate-limit middleware), `fiber-link-service/apps/rpc/src/rate-limit.ts` | `RPC_RATE_LIMIT_ENABLED`, `RPC_RATE_LIMIT_WINDOW_MS`, `RPC_RATE_LIMIT_MAX_REQUESTS` in `deploy/compose/.env.example` and `deploy/compose/docker-compose.yml` | `fiber-link-service/apps/rpc/src/rate-limit.test.ts`, `fiber-link-service/apps/rpc/src/rpc.test.ts` (`returns rate-limited error after limit is exhausted`) |
| SCM-07 | Enforce withdrawal policy guardrails (assets/caps/daily limits/cooldown) | `withdrawal.request` | `fiber-link-service/apps/rpc/src/methods/withdrawal.ts`, `fiber-link-service/packages/db/src/withdrawal-policy-repo.ts`, `fiber-link-service/apps/admin/src/server/api/routers/withdrawal-policy.ts` | `FIBER_WITHDRAWAL_POLICY_*` env defaults in `deploy/compose/.env.example` and runtime pass-through in `deploy/compose/docker-compose.yml` | `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`, `fiber-link-service/apps/admin/src/server/api/routers/withdrawal-policy.test.ts`, `fiber-link-service/packages/db/src/withdrawal-policy-repo.test.ts` |

## One-Pass Local Verification

```bash
cd fiber-link-service
bun install --frozen-lockfile

(cd apps/rpc && bun run test -- --run --silent src/rpc.test.ts src/methods/tip.test.ts src/nonce-store.test.ts)
(cd packages/fiber-adapter && bun run test -- --run --silent src/fiber-adapter.test.ts)
(cd apps/worker && bun run test -- --run --silent src/settlement.test.ts src/settlement-discovery.test.ts)
(cd apps/rpc && bun run test -- --run --silent src/rate-limit.test.ts src/methods/withdrawal.test.ts)
(cd apps/admin && bun run test -- --run --silent src/server/api/routers/withdrawal-policy.test.ts)
(cd packages/db && bun run test -- --run --silent src/withdrawal-policy-repo.test.ts)
```

Operational replay validation:

```bash
cd fiber-link-service
DATABASE_URL="$DATABASE_URL" \
FIBER_RPC_URL="$FIBER_RPC_URL" \
bun run apps/worker/src/scripts/backfill-settlements.ts -- --from=<ISO> --to=<ISO> --limit=500
```

Expected operational output: JSON summary with `errors`, `settledCredits`, `settledDuplicates`, and backlog metrics.

## CI Reference

- Workflow: `.github/workflows/ci.yml`
- Job `test-service` runs the service package tests that provide the primary evidence above.
- Job `plugin-smoke` validates request-spec integration boundaries at plugin level.
