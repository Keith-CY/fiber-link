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

`PARTIAL`

Invoice creation/status and replay controls are validated locally, but this run did not include a settled invoice transition.

Latest run evidence:

- `scripts/e2e-fiber-adapter-docker.sh` path is covered by compose evidence at `deploy/compose/evidence/20260216T184504Z/`.
- Backfill command result: `ok=true`, `errors=0`, `stillUnpaid=1`.

## Exit criteria

- Invoice create/status probes pass against live testnet setup.
- Settlement replay/backfill summary reports convergent results.
- Evidence links are published in acceptance artifacts.
