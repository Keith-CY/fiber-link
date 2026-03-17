# M3 Checkpoint 3: Production Hardening

## Goal

Close production hardening items for monitoring, rate limiting, backups, and docs polish.

## Collected evidence

- Security assumptions and owner matrix:
  - `docs/runbooks/security-assumptions.md`
- Security controls to evidence mapping:
  - `docs/runbooks/security-controls-evidence-map.md`
- Threat-model checklist and sign-off guidance:
  - `docs/runbooks/threat-model-evidence-checklist.md`
- Deployment evidence capture and retention policy:
  - `docs/runbooks/deployment-evidence.md`
  - `docs/runbooks/evidence-template/deployment/retention-policy.md`
- Remaining hardening notes:
  - `docs/06-development-progress.md`

## Current status

`DONE`

Production hardening controls are implemented and mapped to evidence.

Latest hardening updates (2026-02-27):

- RPC rate limiting controls are enabled/configurable in compose runtime env.
- Withdrawal policy defaults are explicit in compose env templates.
- Mainnet deployment checklist is published with backup/rollback gates.
- Security assumptions and control-evidence mapping are updated for policy/rate-limit controls.

Latest hardening updates (2026-03-18):

- Compose backup and restore are runnable via `scripts/capture-compose-backup.sh` and `scripts/restore-compose-backup.sh`.
- Shared Redis-backed RPC rate limiting is wired through compose (`FIBER_LINK_RATE_LIMIT_REDIS_URL`) and covered by targeted tests.
- Compose monitoring baseline is runnable via `deploy/compose/compose-ops-summary.sh`, with exit-code semantics and documented thresholds.
- Admin withdrawal policy operations are runnable via `fiber-link-service/apps/admin/src/scripts/manage-withdrawal-policy.ts`, and the admin dashboard now shows current policy rows.

## Exit criteria

- Monitoring and alerting controls are explicitly verified in release evidence.
- Rate limiting and backup/recovery procedures are validated and linked.
- Documentation is internally consistent and release-ready.
