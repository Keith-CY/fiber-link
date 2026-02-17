# M2 Checkpoint 2: Backend Endpoints for Discourse Integration

## Goal

Provide stable backend RPC surface and auth boundary for plugin calls.

## Collected evidence

- Architecture boundary for `apps/rpc`:
  - `docs/02-architecture.md`
- Progress records for hardened proxy and API behavior:
  - `docs/06-development-progress.md`
- Verification and request-spec gate:
  - `docs/runbooks/phase2-verification.md`

## Current status

`DONE`

Backend integration endpoint path, auth checks, and plugin-facing request handling are documented and part of verification flow.

## Exit criteria

- Plugin can call backend methods through signed/authenticated path.
- Request validation and error envelope behavior remain stable.
