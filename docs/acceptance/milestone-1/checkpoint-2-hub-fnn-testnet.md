# M1 Checkpoint 2: Stand Up Hub FNN on Testnet

## Goal

Bring up Hub FNN with compose and validate deterministic testnet bootstrap.

## Collected evidence

- Compose topology and runtime assumptions:
  - `docs/runbooks/compose-reference.md`
- Deterministic bootstrap sequence and ordered checkpoints:
  - `docs/runbooks/testnet-bootstrap.md`
- Integration probe from adapter to `fnn` RPC inside docker network:
  - `docs/runbooks/fiber-adapter-e2e.md`
- Legacy Milestone 1 evidence status:
  - `docs/runbooks/acceptance-evidence/milestone-1/index.md`

## Verification commands

- `scripts/testnet-smoke.sh`
- `scripts/e2e-fiber-adapter-docker.sh`
- `cd deploy/compose && ./compose-readiness.sh`

## Current status

`DONE`

Latest local runs completed with pass artifacts:

- `.tmp/testnet-smoke/20260217-033951/`
- `deploy/compose/evidence/20260216T184149Z/`
- `deploy/compose/evidence/20260216T184504Z/summary.json`

## Exit criteria

- All bootstrap checkpoints pass in order.
- Compose readiness completes with healthy/running services.
- Evidence bundle links are updated with latest successful artifacts.
