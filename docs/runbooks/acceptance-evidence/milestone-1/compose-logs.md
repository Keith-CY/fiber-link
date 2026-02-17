# Milestone 1: Compose Verification Logs

## Artifact source

- Command: `deploy/compose/compose-readiness.sh`
- Required files: `precheck.log`, `compose-up.log`, `compose-ready-ps.log`, `compose-logs.log`, `rpc-*.json`, `summary.json`.

## Public publication target

- Published copy should be stored at:
  - `docs/runbooks/acceptance-evidence/milestone-1/compose-logs.md` (this file)

## Latest local run

- Date: 2026-02-17
- Command: `cd deploy/compose && ./compose-readiness.sh --verbose`
- Result: `summary.status=pass`
- Evidence directory: `deploy/compose/evidence/20260216T184504Z/`
- Summary file: `deploy/compose/evidence/20260216T184504Z/summary.json`
