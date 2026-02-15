# Threat-Model Evidence Checklist and Acceptance Matrix (W1)

Version: `2026-02-15`
Scope: W1 threat controls in `docs/05-threat-model.md`
Primary owner: Fiber Link security/ops (`@Keith-CY`)

This runbook gives reviewers a one-pass checklist for proving each high-priority W1 threat control with code, config, logs, and tests.

## Linked Sources

- Threat model: `docs/05-threat-model.md`
- Security assumptions and owners: `docs/runbooks/security-assumptions.md`
- Verification gate: `docs/runbooks/phase2-verification.md`
- Settlement replay runbook: `docs/runbooks/settlement-recovery.md`
- CI workflow (jobs: `test-service`, `plugin-smoke`): `.github/workflows/ci.yml`

## Local Verification Commands

Run from repo root unless stated otherwise.

```bash
cd fiber-link-service
bun install --frozen-lockfile

(cd apps/rpc && bun run test -- --run --silent src/rpc.test.ts src/nonce-store.test.ts)
(cd packages/db && bun run test -- --run --silent src/tip-intent-repo.test.ts)
(cd apps/worker && bun run test -- --run --silent src/settlement.test.ts src/settlement-discovery.test.ts src/withdrawal-batch.test.ts)
```

Manual operational verification commands:

```bash
rg -n "NONCE_TTL_MS|FIBER_LINK_HMAC_SECRET|FIBER_LINK_NONCE_REDIS_URL" fiber-link-service/apps/rpc/src/rpc.ts
rg -n "WORKER_MAX_RETRIES|WORKER_RETRY_DELAY_MS|WORKER_SETTLEMENT_INTERVAL_MS|WORKER_SETTLEMENT_BATCH_SIZE" fiber-link-service/apps/worker/src/entry.ts
bash deploy/compose/compose-reference.test.sh
```

## W1 Control Checklist

| Check | Control ID | Status | Manual command(s) | Expected log/test output | Code/config evidence | CI evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | TM-W1-AUTH-01 HMAC auth + replay defense | Implemented | `cd fiber-link-service/apps/rpc && bun run test -- --run --silent src/rpc.test.ts src/nonce-store.test.ts` | `rpc.test.ts` covers invalid signature and missing auth; `nonce-store.test.ts` confirms replay detection. | `fiber-link-service/apps/rpc/src/rpc.ts`, `fiber-link-service/apps/rpc/src/nonce-store.ts`; env vars `FIBER_LINK_HMAC_SECRET`, `FIBER_LINK_NONCE_REDIS_URL`; constant `NONCE_TTL_MS`. | `.github/workflows/ci.yml` job `test-service` |
| [ ] | TM-W1-DATA-01 Invoice integrity (1:1 invoice mapping + state transitions) | Implemented | `cd fiber-link-service/packages/db && bun run test -- --run --silent src/tip-intent-repo.test.ts` | Tests include `rejects duplicate invoice inserts...` and `updates invoice state idempotently`. | `fiber-link-service/packages/db/src/schema.ts`, `fiber-link-service/packages/db/src/tip-intent-repo.ts` | `.github/workflows/ci.yml` job `test-service` |
| [ ] | TM-W1-INGEST-01 Settlement ingestion idempotency | Implemented | `cd fiber-link-service/apps/worker && bun run test -- --run --silent src/settlement.test.ts src/settlement-discovery.test.ts` | `settlement.test.ts` covers duplicate settlement no-op; discovery summary includes `settledDuplicates` and `errors`. | `fiber-link-service/apps/worker/src/settlement.ts`, `fiber-link-service/apps/worker/src/settlement-discovery.ts` | `.github/workflows/ci.yml` job `test-service` |
| [ ] | TM-W1-VERIFY-01 Settlement verification/backfill path | Implemented (manual evidence required) | `cd fiber-link-service && DATABASE_URL=... FIBER_RPC_URL=... bun run apps/worker/src/scripts/backfill-settlements.ts -- --from=<ISO> --to=<ISO> --limit=500` | JSON summary includes `errors`, `backlogUnpaidBeforeScan`, `backlogUnpaidAfterScan`, `detectionLatencyMs`. | `fiber-link-service/apps/worker/src/scripts/backfill-settlements.ts`, `docs/runbooks/settlement-recovery.md` | N/A (runbook/manual gate) |
| [ ] | TM-W1-WITHDRAW-01 Withdrawal retry boundaries and failure classification | Implemented | `cd fiber-link-service/apps/worker && bun run test -- --run --silent src/withdrawal-batch.test.ts` | Tests include transient failure to `RETRY_PENDING`, exhausted retries to `FAILED`, and Fiber RPC error classification. | `fiber-link-service/apps/worker/src/withdrawal-batch.ts`; env vars `WORKER_MAX_RETRIES`, `WORKER_RETRY_DELAY_MS`. | `.github/workflows/ci.yml` job `test-service` |
| [ ] | TM-W1-OPS-01 External dependency and secret-handling controls | Implemented (manual sign-off required) | `bash deploy/compose/compose-reference.test.sh` | Script exits `0` and confirms required env placeholders/guards exist. | `deploy/compose/.env.example`, `deploy/compose/docker-compose.yml`, `docs/runbooks/compose-reference.md`, `docs/runbooks/security-assumptions.md` | N/A (runbook/manual gate) |

## High-Priority Risk Acceptance Matrix

| High-priority risk (from threat model) | Evidence checklist control(s) | Acceptance proof |
| --- | --- | --- |
| Key security (withdrawal + hub node keys) | `TM-W1-OPS-01`, `TM-W1-WITHDRAW-01` | Compose/env guard checks + withdrawal retry/failure tests + owner sign-off in evidence bundle. |
| Ledger correctness (exactly-once credit + reconciliation) | `TM-W1-DATA-01`, `TM-W1-INGEST-01`, `TM-W1-VERIFY-01` | DB invariants tests + settlement idempotency tests + replay/backfill summary (`errors == 0`). |
| Auth between Discourse and service | `TM-W1-AUTH-01` | RPC auth/replay tests pass; nonce replay storage behavior verified. |
| Withdrawal controls (limits, retries, monitoring) | `TM-W1-WITHDRAW-01`, `TM-W1-OPS-01` | Worker retry/failure tests + runtime env guard checks and operational evidence capture. |

## Evidence Retention and Sign-Off Rule

- Storage location:
  - keep generated artifacts under `deploy/compose/evidence/<UTC_TIMESTAMP>/`
  - generated evidence stays out of git history unless policy explicitly requires a committed artifact
- Mandatory artifacts per verification pass:
  - command transcript (`commands.log`)
  - test output summaries (local and/or CI links)
  - relevant runbook outputs (for example backfill summary JSON)
- Sign-off roles:
  - service owner signs off code/test evidence
  - security/ops owner signs off operational/manual evidence and retention metadata
- Sign-off record location:
  - PR description or PR comment referencing this checklist and evidence directory path
