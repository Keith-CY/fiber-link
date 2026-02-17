# W4 Integration Status Sync (Issue #36)

Snapshot date: 2026-02-17

This document synchronizes W4 integration status for [issue #36](https://github.com/Keith-CY/fiber-link/issues/36) using GitHub issue state + linked PR evidence captured on 2026-02-17.

## W4 Subtask Matrix (2026-02-17)

| Subtask | Issue | Status | Evidence links |
| --- | --- | --- | --- |
| W4.1 Implement RPC `tip.status` endpoint | [#43](https://github.com/Keith-CY/fiber-link/issues/43) | `CLOSED` (`COMPLETED`) | [PR #78](https://github.com/Keith-CY/fiber-link/pull/78) |
| W4.2 Expose adapter create/get invoice flow to API | [#50](https://github.com/Keith-CY/fiber-link/issues/50) | `CLOSED` (`COMPLETED`) | [PR #90](https://github.com/Keith-CY/fiber-link/pull/90) |
| W4.3 Deterministic settlement verification in worker | [#55](https://github.com/Keith-CY/fiber-link/issues/55) | `CLOSED` (`COMPLETED`) | [PR #86](https://github.com/Keith-CY/fiber-link/pull/86) |
| W4.4 Robust settlement failure and retry logic | [#60](https://github.com/Keith-CY/fiber-link/issues/60) | `CLOSED` (`COMPLETED`) | [PR #91](https://github.com/Keith-CY/fiber-link/pull/91) |
| W4.5 End-to-end invoice-payment-settlement tests | [#64](https://github.com/Keith-CY/fiber-link/issues/64) | `CLOSED` (`COMPLETED`) | [PR #93](https://github.com/Keith-CY/fiber-link/pull/93) |
| Legacy: implement RPC `tip.status` method | [#26](https://github.com/Keith-CY/fiber-link/issues/26) | `CLOSED` (`COMPLETED`) | [#26 close record](https://github.com/Keith-CY/fiber-link/issues/26) and delivered by [#43](https://github.com/Keith-CY/fiber-link/issues/43) / [PR #78](https://github.com/Keith-CY/fiber-link/pull/78) |
| Legacy: settlement event subscription path | [#24](https://github.com/Keith-CY/fiber-link/issues/24) | `OPEN` | [#24 status](https://github.com/Keith-CY/fiber-link/issues/24) |
| Legacy: replace heuristic withdrawal error classification | [#28](https://github.com/Keith-CY/fiber-link/issues/28) | `CLOSED` (`COMPLETED`) | [PR #155](https://github.com/Keith-CY/fiber-link/pull/155) |
| Legacy: persist settlement scan cursor across restarts | [#29](https://github.com/Keith-CY/fiber-link/issues/29) | `CLOSED` (`COMPLETED`) | [PR #94](https://github.com/Keith-CY/fiber-link/pull/94) |

## Completed Capabilities (as of 2026-02-17)

- RPC `tip.status` endpoint is implemented and linked into W4 issue chain.
- API exposes adapter invoice create/get flow for plugin/backend usage.
- Worker settlement verification is deterministic with replay/backfill support.
- Settlement retry/failure handling is implemented with durable status progression.
- End-to-end invoice -> payment -> settlement tests are in place.
- Settlement cursor durability across worker restarts is implemented.
- Heuristic withdrawal error classification replacement has been completed.

## Not Completed Yet (as of 2026-02-17)

- Settlement event subscription path remains open in [issue #24](https://github.com/Keith-CY/fiber-link/issues/24).
- W4 umbrella [issue #36](https://github.com/Keith-CY/fiber-link/issues/36) remains `OPEN` pending closure of remaining scope (currently #24).

## Verification Commands

### 1) Status sync check (GitHub issues)

```bash
gh issue view 36 --json number,title,state,updatedAt,url

for i in 43 50 55 60 64 26 24 28 29; do
  gh issue view "$i" --json number,title,state,stateReason,updatedAt,closedAt,closedByPullRequestsReferences,url
done
```

### 2) Integration verification commands

```bash
# From repository root
./scripts/plugin-smoke.sh
scripts/e2e-fiber-adapter-docker.sh

cd fiber-link-service
bun install --frozen-lockfile

(cd apps/rpc && bun run test -- --run --silent) && \
(cd apps/admin && bun run test -- --run --silent) && \
(cd apps/worker && bun run test -- --run --silent) && \
(cd packages/db && bun run test -- --run --silent)
```

Related runbooks:
- [`docs/runbooks/phase2-verification.md`](./phase2-verification.md)
- [`docs/runbooks/fiber-adapter-e2e.md`](./fiber-adapter-e2e.md)

## Operations Checks

1. Run settlement replay/backfill from [`docs/runbooks/settlement-recovery.md`](./settlement-recovery.md) for the target app/time window.
2. Confirm replay convergence (`errors == 0`) and that rerun does not create duplicate credits.
3. Restart worker and verify settlement cursor resumes from persistent `WORKER_SETTLEMENT_CURSOR_FILE`.
4. Review worker logs for unresolved settlement failures and retry scheduling behavior.
