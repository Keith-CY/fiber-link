# M1 Checkpoint 3: Backend Skeleton and DB Schema

## Goal

Confirm backend service skeleton and durable schema foundation are established.

## Collected evidence

- Phase 2 delivered capabilities and merged PR trail:
  - `docs/06-development-progress.md`
- Runtime architecture and persistence boundary:
  - `docs/02-architecture.md`
- MVP scope for service responsibilities:
  - `docs/01-scope-mvp.md`

## Current status

`DONE`

Service boundaries (`apps/rpc`, `apps/worker`, `packages/db`, `packages/fiber-adapter`) and DB-based workflow state are documented as shipped baseline.

## Exit criteria

- DB schema and repositories are the default persistence path.
- Tip intent, ledger, and withdrawal lifecycles are represented with durable transitions.
- Documentation references the shipped baseline, not placeholder scaffolding.
