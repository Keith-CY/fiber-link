# Security Assumptions and Operational Limits

Version: `2026-02-15`
Status: Active
Owner: Fiber Link security/ops (`@Keith-CY`)
Review cadence: monthly or after any incident touching auth, settlement, or key handling

This runbook makes explicit where the system depends on external trust and what operational boundary applies today.

## Owner Directory

| Area | Owner | Contact |
| --- | --- | --- |
| RPC auth + replay defense | Service owner | GitHub: `@Keith-CY` |
| Fiber node integration + settlement discovery | Node/operator owner | GitHub: `@Keith-CY` |
| Withdrawal execution policy | Wallet operations owner | GitHub: `@Keith-CY` |
| DB durability + recovery | Data operations owner | GitHub: `@Keith-CY` |

## Assumptions and Limits Matrix

| ID | Trust assumption (explicit) | Operational limit / boundary | Fallback condition | Owner / contact | Verification evidence |
| --- | --- | --- | --- | --- | --- |
| SA-001 | `FIBER_RPC_URL` endpoint is trusted to report invoice/payment state truthfully enough for settlement processing. | Settlement polling default interval is `WORKER_SETTLEMENT_INTERVAL_MS=30000`; per-run scan cap default is `WORKER_SETTLEMENT_BATCH_SIZE=200`. | If settlement scan output (`errors > 0`) or backlog does not converge, execute replay in `docs/runbooks/settlement-recovery.md`. | Node/operator owner (`@Keith-CY`) | `bun run apps/worker/src/scripts/backfill-settlements.ts -- --from=<ISO> --to=<ISO>` and inspect `summary.errors`, backlog counters. |
| SA-002 | Network egress to external dependencies (GitHub release assets and CKB testnet RPC) is available during bootstrap/runtime. | Bootstrap is blocked without outbound access; no offline mirror fallback is implemented in this repo version. | If precheck/bootstrap fails due egress, stop deployment and restore network path before retry. | Node/operator owner (`@Keith-CY`) | `scripts/testnet-smoke.sh --dry-run` + `docs/runbooks/compose-reference.md` prerequisites. |
| SA-003 | HMAC secret material and app secrets remain private (not committed/logged in plaintext). | Replay window is bounded by `NONCE_TTL_MS = 5m`; missing/invalid auth headers must always return unauthorized. | On suspected leakage, rotate via `docs/runbooks/secret-cutover.md` and invalidate existing app credentials. | Service owner (`@Keith-CY`) | `fiber-link-service/apps/rpc/src/rpc.test.ts` auth/replay cases; `rg -n "NONCE_TTL_MS" fiber-link-service/apps/rpc/src/rpc.ts`. |
| SA-004 | DB writes are durable enough to preserve ledger and withdrawal state between worker restarts. | Local compose provides single-node persistence (`postgres-data`) only; no built-in PITR/HA guarantee. | If DB corruption/loss is suspected, pause worker and recover from latest validated backup before resuming. | Data operations owner (`@Keith-CY`) | `docs/runbooks/compose-reference.md` data model + incident replay from `docs/runbooks/settlement-recovery.md`. |
| SA-005 | Transient withdrawal RPC failures should not cause unbounded retries or duplicate debits. | Retry budget default is `WORKER_MAX_RETRIES=3` with `WORKER_RETRY_DELAY_MS=60000`; beyond budget transitions to `FAILED`. | If transient failures exceed budget, mark failed and require operator replay/manual action. | Wallet operations owner (`@Keith-CY`) | `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts` retry/failure scenarios; env defaults in `deploy/compose/.env.example`. |
| SA-006 | Settlement correctness relies on polling + backfill (subscription path is not required for correctness in current version). | Current production baseline is polling discovery; subscription is optional future optimization (see decision log). | If polling misses are detected, run bounded backfill window and verify idempotent convergence. | Node/operator owner (`@Keith-CY`) | `docs/decisions/2026-02-10-settlement-discovery-strategy.md` + `docs/runbooks/settlement-recovery.md`. |

## Versioned Changes

- `2026-02-15` (v1): initial published assumptions/limits matrix with owner contacts and runbook verification mapping.
