# 2026-03-18 Production Hardening Closeout

Owner: Codex implementation session
Follow-up to: `docs/plans/2026-03-18-production-readiness-audit.md`

This note closes the production-hardening gaps identified in the audit and records the current repo-backed operator baseline.

## Current Status

| Area | Completion | Maturity | Current operator path |
| --- | --- | --- | --- |
| Admin controls | Implemented | Near-ready | browser-editable dashboard + `manage-withdrawal-policy.ts` fallback |
| Monitoring | Implemented | Near-ready | `deploy/compose/compose-ops-summary.sh` + thresholded JSON/exit codes |
| Rate limiting | Implemented | Near-ready | shared Redis-backed limiter via `FIBER_LINK_RATE_LIMIT_REDIS_URL` |
| Backups | Implemented | Near-ready | `capture-compose-backup.sh` + `restore-compose-backup.sh` |
| Documentation polish | Implemented | Near-ready | compose/reference/checklist/acceptance/progress docs aligned |

## Evidence By Area

### Admin controls

- Browser-editable dashboard:
  - `fiber-link-service/apps/admin/src/pages/index.tsx`
  - `fiber-link-service/apps/admin/src/pages/api/withdrawal-policies.ts`
  - `fiber-link-service/apps/admin/src/server/dashboard-policy-action.ts`
  - `fiber-link-service/apps/admin/src/server/dashboard-fixture-store.ts`
- Shared policy input parsing:
  - `fiber-link-service/apps/admin/src/withdrawal-policy-input.ts`
- Operator command:
  - `fiber-link-service/apps/admin/src/scripts/manage-withdrawal-policy.ts`
- Tested operator module:
  - `fiber-link-service/apps/admin/src/withdrawal-policy-ops.test.ts`
  - `fiber-link-service/apps/admin/src/pages/index.page.test.tsx`
  - `fiber-link-service/apps/admin/src/server/dashboard-policy-action.test.ts`
  - `fiber-link-service/apps/admin/src/server/dashboard-fixture-store.test.ts`
- Browser-proof contract:
  - `scripts/admin-dashboard-proof.sh`
  - `scripts/admin-dashboard-proof.test.sh`
- Runbook:
  - `docs/runbooks/withdrawal-policy-operations.md`

### Monitoring

- Worker ops summary:
  - `fiber-link-service/apps/worker/src/ops-summary.ts`
  - `fiber-link-service/apps/worker/src/scripts/ops-summary.ts`
- Shared readiness logic:
  - `fiber-link-service/apps/worker/src/worker-readiness.ts`
- Compose wrapper + contract:
  - `deploy/compose/compose-ops-summary.sh`
  - `deploy/compose/compose-ops.test.sh`
- Runbook:
  - `docs/runbooks/compose-ops-monitoring.md`

### Rate limiting

- Shared Redis-backed store:
  - `fiber-link-service/apps/rpc/src/rate-limit.ts`
- Runtime wiring:
  - `deploy/compose/docker-compose.yml`
  - `deploy/compose/.env.example`
- Verification:
  - `fiber-link-service/apps/rpc/src/rate-limit.test.ts`

### Backups

- Capture:
  - `scripts/capture-compose-backup.sh`
- Restore:
  - `scripts/restore-compose-backup.sh`
- Contract:
  - `deploy/compose/compose-backup.test.sh`
- Runbook:
  - `docs/runbooks/compose-backup-recovery.md`

### Documentation polish

- Compose reference:
  - `docs/runbooks/compose-reference.md`
- Mainnet checklist:
  - `docs/runbooks/mainnet-deployment-checklist.md`
- Acceptance checkpoint:
  - `docs/acceptance/milestone-3/checkpoint-3-production-hardening.md`
- Progress narrative:
  - `docs/06-development-progress.md`

## Remaining External Dependencies

The repo now provides a production-ready operational baseline for the requested scope. The following are still external platform responsibilities rather than missing repo features:

- TLS termination and public ingress controls
- secret-manager backed runtime secret distribution
- offsite backup replication / PITR beyond the local compose snapshot path
- alert delivery target selection (PagerDuty/email/Slack/etc.) wired to the documented exit codes

Those are deployment-environment concerns, not unimplemented gaps in the repository.
