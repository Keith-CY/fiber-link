# Milestone 1 Acceptance Evidence

This file is the published verification artifact for Milestone 1 acceptance.

- Issue: [#100](https://github.com/Keith-CY/fiber-link/issues/100)
- Public proof issue: [#114](https://github.com/Keith-CY/fiber-link/issues/114)
- Scope reference: `docs/04-research-plan.md`, `docs/06-development-progress.md`
- Retention target: **30 days** (standard default), then promote or archive long-term.

## Required proof artifacts

| Evidence | Source command | Evidence target |
| --- | --- | --- |
| Testnet bootstrap result | `scripts/testnet-smoke.sh` | [`testnet-bootstrap.md`](./testnet-bootstrap.md) |
| Phase 2 / deployment evidence bundle | `scripts/capture-deployment-evidence.sh` | [`deployment-bundle.md`](./deployment-bundle.md) |
| Settlement backfill/recovery summary | `bun run apps/worker/src/scripts/backfill-settlements.ts` | [`settlement-backfill.md`](./settlement-backfill.md) |
| Compose verification logs | `deploy/compose/compose-readiness.sh` | [`compose-logs.md`](./compose-logs.md) |

## Public artifact locations

- Primary publish directory: `docs/runbooks/acceptance-evidence/milestone-1/`
- Raw command logs (non-published): `deploy/compose/evidence/<UTC_TIMESTAMP>/`

## Artifact status (current)

- Testnet bootstrap: **pass** (`RESULT=PASS`) - artifact: `.tmp/testnet-smoke/20260217-033951/`
- Deployment evidence bundle: **pass** (`RESULT=PASS`) - artifact: `deploy/compose/evidence/20260216T184149Z/` (`20260216T184149Z.tar.gz`)
- Settlement backfill summary: **pass** (`ok=true`, `errors=0`) - command: `bun run apps/worker/src/scripts/backfill-settlements.ts -- --limit=20`
- Compose verification logs: **pass** (`summary.status=pass`) - artifact: `deploy/compose/evidence/20260216T184504Z/summary.json`

Update each row with artifact links when verification evidence is attached.
