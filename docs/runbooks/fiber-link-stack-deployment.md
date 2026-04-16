# Fiber Link Stack Deployment Runbook

Last updated: 2026-04-16
Owner: Fiber Link ops (`@Keith-CY`)

This runbook explains how to deploy the Fiber Link stack itself, including:

- FNN
- Postgres
- Redis
- Fiber Link RPC
- Fiber Link worker

It is written as an operator-facing workflow from first Docker bring-up to service verification and basic admin configuration.

## 1. Scope

This document covers the backend/service side only.

It does not cover:

- Discourse installation
- Discourse plugin installation
- Discourse admin configuration

Those are covered separately in:

- `docs/runbooks/discourse-plugin-admin.md`

## 2. Deployment model

Recommended deployment model:

- run the Fiber Link stack with Docker Compose
- validate backend health and signed RPC behavior before connecting Discourse

Core services:

- `postgres`
- `redis`
- `fnn`
- `rpc`
- `worker`

High-level relationship:

```text
rpc -> postgres
rpc -> redis
rpc -> fnn
worker -> postgres
worker -> redis
worker -> fnn
```

## 3. Prerequisites

Before deployment, prepare:

- Linux host with Docker and Docker Compose
- Git access to the repository
- enough CPU / RAM / disk for FNN and application services
- a domain/subdomain plan if this stack will be exposed publicly
- secrets generated before first startup

Clone the repo:

```bash
git clone https://github.com/Keith-CY/fiber-link.git
cd fiber-link
```

## 4. Files and directories you will use

Primary deployment directory:

```bash
deploy/compose/
```

Key files:

- `deploy/compose/docker-compose.yml`
- `deploy/compose/.env.example`
- `deploy/compose/.env`

Useful reference docs:

- `docs/admin-installation.md`
- `docs/runbooks/compose-reference.md`
- `docs/runbooks/mainnet-deployment-checklist.md`

## 5. Required environment variables

From repo root:

```bash
cd deploy/compose
cp .env.example .env
```

At minimum, set these values in `.env`:

- `POSTGRES_PASSWORD`
- `FIBER_SECRET_KEY_PASSWORD`
- `FIBER_LINK_HMAC_SECRET`
- `FNN_ASSET_SHA256`

Commonly important overrides:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PORT`
- `REDIS_PORT`
- `RPC_PORT`
- `FNN_RPC_PORT`
- `FNN_P2P_PORT`
- `FIBER_RPC_URL`
- `FIBER_LINK_HMAC_SECRET_MAP`
- `RPC_HEALTHCHECK_TIMEOUT_MS`
- `WORKER_SHUTDOWN_TIMEOUT_MS`
- `WORKER_SETTLEMENT_INTERVAL_MS`
- `WORKER_SETTLEMENT_BATCH_SIZE`
- `WORKER_READINESS_TIMEOUT_MS`

For production-style deployments, also explicitly set:

- `RPC_RATE_LIMIT_ENABLED`
- `RPC_RATE_LIMIT_WINDOW_MS`
- `RPC_RATE_LIMIT_MAX_REQUESTS`
- `FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS`
- `FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST`
- `FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX`
- `FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX`
- `FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS`
- `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY`

If you intend to enable worker-side channel rotation fallback for underfunded CKB withdrawals, also set:

- `FIBER_LIQUIDITY_FALLBACK_MODE=channel_rotation`
- `FIBER_CHANNEL_ACCEPT_RPC_URL=<reachable payer-side accept RPC endpoint>`
- `FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE`
- `FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT`
- `FIBER_CHANNEL_ROTATION_MAX_CONCURRENT`
- `FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER`
- `FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE`
- `FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER`

Operator note:

- the payer-side accept RPC endpoint may be owned by another operator or stack
- this runbook assumes you have been given a reachable RPC endpoint and peer address for that payer node
- do not assume `fnn` alone is sufficient when channel rotation fallback is enabled

## 6. Stage 1 — Deploy FNN with Docker

FNN is part of the Compose stack, but operationally treat it as its own dependency.

Bring up dependencies in order:

```bash
cd deploy/compose
docker compose up -d postgres redis fnn
```

Check status:

```bash
docker compose ps
docker compose logs --tail=200 fnn
```

What you want to confirm:

- FNN container is running
- no immediate restart loop
- expected RPC and P2P ports are bound correctly
- no startup error caused by wrong `FIBER_SECRET_KEY_PASSWORD`
- no asset/bootstrap mismatch caused by wrong `FNN_ASSET_SHA256`

Operational note:

- if FNN is not healthy, do not continue to Fiber Link RPC/worker debugging yet
- get FNN stable first

## 7. Stage 2 — Deploy Fiber Link services with Docker

Once Postgres, Redis, and FNN are stable:

```bash
docker compose up -d rpc worker
```

Or, if you want the full stack in one step after `.env` is ready:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs --tail=200 rpc worker
```

Minimum acceptance for this stage:

- `postgres`, `redis`, `fnn`, `rpc`, `worker` are all running
- no crash/restart storm in the first 10 minutes
- RPC can reach Postgres/Redis/FNN
- worker can reach Postgres/Redis/FNN

Before treating this stage as complete, verify runtime env propagation for the values that materially affect withdrawal behavior:

```bash
docker compose exec rpc env | grep -E 'FIBER_WITHDRAWAL_CKB_PRIVATE_KEY|FIBER_LIQUIDITY_FALLBACK_MODE|FIBER_CHANNEL_ACCEPT_RPC_URL'
docker compose exec worker env | grep -E 'FIBER_WITHDRAWAL_CKB_PRIVATE_KEY|FIBER_LIQUIDITY_FALLBACK_MODE|FIBER_CHANNEL_ACCEPT_RPC_URL'
```

Why this matters:

- having a value in `.env` is not enough if the running containers were not recreated with it
- on-chain withdrawals require `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY` to be present in the live `rpc`/`worker` runtime, not just in source control or operator notes
- channel rotation fallback requires the live worker to see `FIBER_LIQUIDITY_FALLBACK_MODE=channel_rotation` and a reachable `FIBER_CHANNEL_ACCEPT_RPC_URL`

## 8. Stage 3 — Service health verification

Do not stop at container health.

### Basic health

Use the exposed RPC endpoint to verify liveness/readiness.

Expected checks:

- liveness endpoint returns alive
- readiness endpoint reports ready and dependency checks are `ok`

If you have the endpoint exposed locally, the pattern is typically:

```bash
curl -s http://127.0.0.1:${RPC_PORT:-3000}/healthz/live
curl -s http://127.0.0.1:${RPC_PORT:-3000}/healthz/ready
```

### Logs

Also inspect logs directly:

```bash
docker compose logs --tail=200 rpc worker fnn
```

Look for:

- RPC auth startup issues
- DB connection failures
- Redis connection failures
- FNN RPC connectivity failures
- worker settlement/reconciliation startup errors

## 9. Stage 4 — Signed RPC verification

Before connecting any UI/plugin, confirm the backend really works.

Required checks:

- valid signed request returns success
- invalid signature is rejected
- replay nonce is rejected

This is the real backend acceptance gate.

If this fails, likely causes are:

- wrong `FIBER_LINK_HMAC_SECRET`
- wrong per-app secret override in `FIBER_LINK_HMAC_SECRET_MAP`
- clock/timestamp skew assumptions
- wrong service URL / port / reverse proxy target

## 10. Stage 5 — Invoice / settlement smoke test

Before considering the stack “up”, verify the payment path itself.

Minimum useful smoke test:

- create invoice successfully
- observe expected pending state
- observe settlement processing path

For local or deterministic verification, use the existing repo tooling where appropriate, for example:

```bash
scripts/testnet-smoke.sh
```

Expected minimum:

- script exits with `RESULT=PASS`
- invoice / settlement path reports success

## 11. Admin-side configuration after backend is live

Once the stack is healthy, record and configure the values administrators will need later.

At minimum, you should know and record:

- public RPC URL
- app id(s) that are allowed to call RPC
- app secret(s) used for HMAC auth
- whether secrets come from:
  - DB `apps` table
  - `FIBER_LINK_HMAC_SECRET_MAP`
  - fallback `FIBER_LINK_HMAC_SECRET`

This matters because Discourse/plugin setup depends on these exact values.

### Backend-side admin checks

Operators should verify:

- the intended app id exists and is active
- the secret source used by RPC is the one you expect
- withdrawal policy rows exist if this environment supports withdrawal

Useful verification pattern for policy rows:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select app_id, allowed_assets, max_per_request, per_user_daily_max, per_app_daily_max, cooldown_seconds, updated_at from withdrawal_policies order by app_id;"
```

## 12. Channel rotation fallback enablement

Use this section only if you want underfunded CKB withdrawals to recover via channel rotation instead of remaining stuck in `LIQUIDITY_PENDING`.

### Preconditions

Before enabling the fallback, verify all of the following:

- the live worker has `FIBER_LIQUIDITY_FALLBACK_MODE=channel_rotation`
- `FIBER_CHANNEL_ACCEPT_RPC_URL` points to a reachable payer-side accept RPC endpoint
- the worker has a valid `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY`
- at least one eligible legacy channel exists
- the legacy channel is already `CHANNEL_READY`
- the legacy channel has no pending TLCs
- the legacy channel local balance is large enough to satisfy your configured minimum recoverable amount

### Database / schema gate

Do not enable new worker-side liquidity fallback code against an old schema.

Before rollout, verify that the current migrations have been applied, especially anything introducing:

- `liquidity_requests`
- `withdrawals.liquidity_request_id`
- `withdrawals.liquidity_pending_reason`
- `withdrawals.liquidity_checked_at`

If these objects are missing, worker may start but channel-rotation and withdrawal flows will fail at runtime.

### Recommended verification sequence

The operator acceptance test for channel rotation should prove the entire state transition, not just config presence:

1. confirm hot wallet inventory is below the total amount required to satisfy the target withdrawal directly
2. submit a normal `withdrawal.request`
3. verify the withdrawal first enters `LIQUIDITY_PENDING`
4. verify a `liquidity_requests` row is created with `recoveryStrategy = CHANNEL_ROTATION`
5. verify replacement-channel metadata appears (`legacyChannelId`, `replacementChannelId`, `expectedRecoveredAmount`)
6. verify the old channel eventually becomes `CLOSED`
7. capture the channel shutdown tx hash from the closed legacy channel
8. verify the withdrawal reaches `COMPLETED`
9. confirm the completed withdrawal tx consumes funds made available by the rotation flow

This is the operational proof that rotation is really enabled.

## 13. Common deployment pitfalls

### Pitfall 1 — container health is green but cross-service wiring is broken

Symptoms:

- RPC starts but invoice flow fails
- worker starts but settlement path fails
- app looks “up” while FNN connectivity is wrong

Check first:

- `FIBER_RPC_URL`
- internal hostnames
- exposed ports
- network reachability between services

### Pitfall 2 — FNN problems look like Fiber Link problems

Symptoms:

- invoice creation fails
- worker logs show downstream RPC failures
- startup sequence looks fine until real calls happen

Rule:

- confirm FNN health and connectivity before debugging RPC/business logic

### Pitfall 3 — secrets are present but the wrong auth source is active

Symptoms:

- signed requests fail even though an app secret was configured somewhere

Rule:

- verify whether RPC is using:
  - app row secret
  - secret map override
  - default HMAC secret

### Pitfall 4 — `.env` and image changes are not enough unless runtime is recreated

Symptoms:

- `.env` contains the right values but live containers do not
- worker behaves like fallback is disabled even though config was edited
- on-chain withdrawal still fails with signer-missing errors after secrets were added

Rule:

- after changing signer, liquidity fallback, or channel-accept endpoint values, recreate the affected containers and re-check runtime env from inside the containers

### Pitfall 5 — deployment success is mistaken for operational readiness

Symptoms observed in later operation:

- scheduled automation did not always run
- withdrawals failed due to real balance/state constraints
- backend was “up” but the environment was not actually ready for long-running operation

Rule:

- after deployment, also validate:
  - balances
  - scheduled tasks / cron execution
  - settlement loops
  - withdrawal readiness
  - channel-rotation readiness if fallback is enabled

## 14. Minimum handoff checklist

Before handing this backend to a Discourse admin or another operator:

- [ ] all backend services are healthy
- [ ] liveness/readiness endpoints pass
- [ ] signed RPC success path passes
- [ ] invalid signature / replay rejection confirmed
- [ ] invoice generation works
- [ ] key service URL is recorded
- [ ] app id / app secret to use from the plugin side is recorded
- [ ] runtime env for signer / fallback-sensitive values was verified inside `rpc` and `worker`
- [ ] latest DB migrations required by the deployed worker are applied
- [ ] if channel rotation fallback is enabled, one end-to-end `LIQUIDITY_PENDING -> CHANNEL_ROTATION -> COMPLETED` proof has been captured
- [ ] evidence/logs from first bring-up are preserved

## 15. Next step

After this runbook is complete, continue with:

- `docs/runbooks/discourse-plugin-admin.md`

That document covers how a Discourse administrator installs the plugin, enables it, and connects it to the live Fiber Link backend.
