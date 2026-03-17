# 2026-03-18 Production Readiness Audit

Owner: Codex audit session
Baseline: `origin/main` at `7c3126d3d2e2f2c0e12b4f3c4ceb50c3bf92d73b`

This audit scores current production readiness against a strict self-hosted production/mainnet bar, not the milestone acceptance bar.

Historical note:
- this document is the baseline gap assessment taken from `origin/main`
- current repo-backed closeout status is tracked in `docs/plans/2026-03-18-production-hardening-closeout.md`

## Scorecard

| Area | Completion | Maturity | Verdict |
| --- | --- | --- | --- |
| Admin controls | Partial | Needs hardening | Runtime policy controls exist, but operator-facing management is not production-ready. |
| Monitoring | Partial | Prod blocker | Health/readiness checks exist, but there is no observability or alerting stack. |
| Rate limiting | Implemented | Needs hardening | Live request throttling exists, but it is single-process and too coarse for production scale. |
| Backups | Doc-only | Prod blocker | Backup expectations are documented, but no backup/restore automation ships in the repo. |
| Documentation polish | Partial | Needs hardening | Docs are broad, but key pages still mix acceptance-complete language with explicit non-production limits. |

## Findings By Area

### 1. Admin controls

Status: `Partial` completion, `Needs hardening` maturity.

Evidence:

- `fiber-link-service/apps/admin/src/server/api/routers/withdrawal-policy.ts` implements list/upsert for allowed assets, per-request limits, daily caps, and cooldowns.
- `fiber-link-service/packages/db/src/withdrawal-policy-repo.ts` persists policy rows and usage snapshots.
- Baseline verification passed:
  - `bun test apps/admin/src/server/api/routers/withdrawal-policy.test.ts`
  - `bun test packages/db/src/withdrawal-policy-repo.test.ts`
- The shipped admin page at `fiber-link-service/apps/admin/src/pages/index.tsx` shows status summaries, app list, and withdrawals only. It does not expose policy management workflows.

Production gap:

- The repo has backend policy controls, but not a complete operator workflow for reviewing, editing, auditing, and safely rolling out policy changes from the admin surface.
- Supporting admin feature modules such as `fiber-link-service/apps/admin/src/features/config/config-profiles.ts` and `fiber-link-service/apps/admin/src/features/healthcheck/health-check.ts` are utility-level building blocks, not a wired production UI flow.

### 2. Monitoring

Status: `Partial` completion, `Prod blocker` maturity.

Evidence:

- `deploy/compose/docker-compose.yml` defines health checks for `postgres`, `redis`, `fnn`, `rpc`, and `worker`.
- `docs/runbooks/compose-reference.md` documents liveness/readiness semantics for the compose stack.
- `fiber-link-service/apps/rpc/src/rpc.ts`, `fiber-link-service/apps/rpc/src/scripts/healthcheck-ready.ts`, and `fiber-link-service/apps/worker/src/scripts/healthcheck.ts` provide live/readiness endpoints and probe scripts.
- `docs/runbooks/compose-reference.md` explicitly says the current setup does not include a production observability stack.

Production gap:

- There is no metrics pipeline, dashboarding, alert routing, on-call signal definition, or error aggregation integration in this repo.
- Health endpoints are useful for startup gating, but they are not enough for production incident detection or trend monitoring.

### 3. Rate limiting

Status: `Implemented` completion, `Needs hardening` maturity.

Evidence:

- `fiber-link-service/apps/rpc/src/rate-limit.ts` implements `InMemoryRateLimitStore`.
- `fiber-link-service/apps/rpc/src/rpc.ts` enforces rate limiting and returns `x-ratelimit-*` headers.
- Baseline verification passed:
  - `bun test apps/rpc/src/rate-limit.test.ts`
- Runtime env knobs exist in `deploy/compose/.env.example` and are called out in `docs/runbooks/mainnet-deployment-checklist.md`.

Production gap:

- The limiter is in-memory only, so limits reset on process restart and do not coordinate across multiple RPC instances.
- The rate-limit key is `appId:method`, which leaves out user-level, community-level, and source-level abuse partitioning.
- There is no operator visibility for spikes, saturation, exemptions, or alert thresholds.

### 4. Backups

Status: `Doc-only` completion, `Prod blocker` maturity.

Evidence:

- `docs/runbooks/mainnet-deployment-checklist.md` requires a pre-deploy backup snapshot and a restore rehearsal.
- `docs/runbooks/security-assumptions.md` states that DB durability is limited to single-node persistence and recovery depends on the latest validated backup.
- `docs/runbooks/compose-reference.md` explicitly says the compose setup does not include backup controls.
- `docs/runbooks/deployment-evidence.md` standardizes evidence capture, not backup creation or restore automation.

Production gap:

- There is no backup script, restore script, scheduled backup workflow, snapshot retention automation, or restore verification harness in the repo.
- The current docs assume an external backup process exists, but the repository does not provide one.

### 5. Documentation polish

Status: `Partial` completion, `Needs hardening` maturity.

Evidence:

- `docs/acceptance/milestone-3/checkpoint-2-admin-controls.md` and `docs/acceptance/milestone-3/checkpoint-3-production-hardening.md` both mark the work `DONE`.
- `docs/runbooks/compose-reference.md` still states that the setup is intended for local/staging bring-up and does not include production controls such as backup and observability.
- `docs/README.md` contains strong coverage across acceptance docs, runbooks, and evidence references.

Production gap:

- The docs are useful, but they do not yet give a single operator-facing “what is production-ready vs not” narrative.
- Acceptance status and production-readiness language are currently easy to conflate, which increases deployment risk.

## Baseline Verification Snapshot

Validated from this audit worktree:

- Passed:
  - `bun test apps/admin/src/server/api/routers/withdrawal-policy.test.ts`
  - `bun test packages/db/src/withdrawal-policy-repo.test.ts`
  - `bun test apps/rpc/src/rate-limit.test.ts`
  - `./deploy/compose/compose-reference.test.sh`
- Failed on `origin/main` baseline:
  - `bun test apps/rpc/src/rpc.test.ts`

Observed baseline failures in `apps/rpc/src/rpc.test.ts`:

- `returns invalid params when withdrawal policy rejects request`
- `returns standardized tip.status not-found error`
- `supports tip.create -> tip.get happy path with deterministic invoice`
- `returns JSON-RPC unauthorized when auth headers are missing`

These failures are not directly in the requested hardening list, but they reduce confidence in current production readiness and should be treated as a nearby stability concern.

## Recommended Next Task Order

1. Ship backup and restore automation for the compose deployment path.
2. Add a minimum viable monitoring stack with alertable signals for RPC, worker, DB, and settlement backlog health.
3. Replace the in-memory rate limiter with shared state and stronger limit keys.
4. Add a production admin workflow for reviewing and changing withdrawal policies.
5. Consolidate acceptance and runbook language so production limits are obvious to operators.

## Recommended Immediate Follow-up

If only one next task is taken, start with backup hardening:

- add a repeatable backup command for Postgres and runtime evidence artifacts
- add a restore command with rehearsal instructions
- wire retention policy into the runnable tooling instead of checklists only
- document the exact release gate using the runnable commands
