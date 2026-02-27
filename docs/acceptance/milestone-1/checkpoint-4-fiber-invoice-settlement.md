# M1 Checkpoint 4: Invoice and Settlement via Fiber Interfaces

## Goal

Validate invoice creation and settlement verification through Fiber-facing interfaces.

## Collected evidence

- Interface-level lifecycle traces:
  - `docs/02-architecture.md`
- Adapter docker-network e2e probe:
  - `docs/runbooks/fiber-adapter-e2e.md`
- Phase verification gate and required security/failure checks:
  - `docs/runbooks/phase2-verification.md`
- Settlement replay/backfill command and convergence checks:
  - `docs/runbooks/settlement-recovery.md`
- Security control to evidence mapping:
  - `docs/runbooks/security-controls-evidence-map.md`

## Verification commands

- `scripts/e2e-fiber-adapter-docker.sh`
- `cd fiber-link-service && bun run apps/worker/src/scripts/backfill-settlements.ts -- --from=<ISO> --to=<ISO> --limit=<N>`

## Current status

`DONE`

Invoice creation/status and replay controls are validated in automated suites and replay-safe worker tests.

Latest verification evidence (2026-02-27):

- `cd fiber-link-service/apps/worker && bun run test -- --run --silent`:
  - `invoice-payment-settlement.e2e.test.ts` passed (`3` tests)
  - `settlement-discovery.test.ts` passed (`12` tests)
- `cd fiber-link-service/apps/rpc && bun run test -- --run --silent`:
  - `tip.create` and `tip.status` contract/handler tests passed.
- Published acceptance evidence index:
  - `docs/runbooks/acceptance-evidence/milestone-1/index.md`

## Exit criteria

- Invoice create/status probes pass against live testnet setup.
- Settlement replay/backfill summary reports convergent results.
- Evidence links are published in acceptance artifacts.
