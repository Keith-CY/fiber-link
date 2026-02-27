# Security Assumptions and Operational Limits

Version: `2026-02-27`
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
| SA-006 | Settlement correctness relies on subscription + polling/backfill fallback convergence. | Worker default strategy is `subscription`; low-latency path requires `FIBER_SETTLEMENT_SUBSCRIPTION_URL`, while polling/backfill remains the safety net. | If subscription stream is unavailable or misses are detected, fall back to polling and run bounded backfill window to verify idempotent convergence. | Node/operator owner (`@Keith-CY`) | `fiber-link-service/apps/worker/src/settlement-subscription-runner.integration.test.ts`, `docs/runbooks/settlement-recovery.md`, compose env keys in `deploy/compose/.env.example`. |
| SA-007 | Runtime abuse controls and withdrawal policy defaults must be present even before per-app policy rows are initialized. | RPC requests are bounded by `RPC_RATE_LIMIT_*`; withdrawal request path enforces `FIBER_WITHDRAWAL_POLICY_*` defaults when DB policy row is absent. | If rate-limited responses spike or policy violations spike unexpectedly, reduce effective limits and audit app traffic/policy assignments before restoring throughput. | Service owner (`@Keith-CY`) | `fiber-link-service/apps/rpc/src/rate-limit.test.ts`, `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`, compose env keys in `deploy/compose/.env.example`. |

## Versioned Changes

- `2026-02-27` (v2): added runtime abuse + withdrawal policy default-control assumption (`SA-007`).
- `2026-02-27` (v3): updated settlement assumption (`SA-006`) to subscription-primary with polling/backfill fallback.
- `2026-02-15` (v1): initial published assumptions/limits matrix with owner contacts and runbook verification mapping.
