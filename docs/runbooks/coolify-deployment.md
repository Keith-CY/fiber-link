# Fiber Link on Coolify Runbook

Last updated: 2026-04-16
Owner: Fiber Link ops (`@Keith-CY`)

This runbook captures the recommended way to deploy Fiber Link on Coolify and the main lessons learned from the previous end-to-end deployment attempts.

It is intentionally opinionated:

- deploy the Fiber Link service stack first
- verify real service-to-service behavior before adding Discourse
- treat Discourse/plugin integration as a separate stage
- if Discourse-on-Coolify becomes too operationally expensive, use direct Docker for Discourse instead of forcing platform uniformity

## 1. Scope

This runbook covers the Coolify deployment of:

- `postgres`
- `redis`
- `fnn`
- `rpc`
- `worker`

Optional later stage:

- Discourse
- Fiber Link Discourse plugin

## 2. Recommended deployment topology

### Coolify project structure

Recommended layout:

- one dedicated Coolify project for Fiber Link environments
- separate environments for:
  - `testnet`
  - `mainnet`
- one Compose application for the Fiber Link service stack
- Discourse tracked as a separate application, even if hosted in the same Coolify project

Reason:

- the Fiber Link stack and the Discourse stack fail in different ways
- separating them makes restart, rollback, and debugging much easier

### Internal service graph

```text
Discourse plugin
  -> RPC
     -> Postgres
     -> Redis
     -> FNN
Worker
  -> Postgres
  -> Redis
  -> FNN
```

Operational rule:

- do not treat container health as sufficient
- verify cross-service behavior explicitly

## 3. Prerequisites

Before creating the Coolify application:

- a domain / subdomain plan exists
- DNS is under your control
- target host has enough CPU / RAM / disk for FNN + app services
- required secrets are generated before bring-up
- the repo revision to deploy is pinned

Use these docs together with this runbook:

- `docs/admin-installation.md`
- `docs/runbooks/testnet-bootstrap.md`
- `docs/runbooks/mainnet-deployment-checklist.md`

## 4. Environment variables to prepare up front

Minimum required secrets / settings:

- `POSTGRES_PASSWORD`
- `FIBER_SECRET_KEY_PASSWORD`
- `FIBER_LINK_HMAC_SECRET`
- `FNN_ASSET_SHA256`

Commonly important overrides:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `FIBER_RPC_URL`
- `FIBER_LINK_HMAC_SECRET_MAP`
- `RPC_HEALTHCHECK_TIMEOUT_MS`
- `WORKER_READINESS_TIMEOUT_MS`
- `WORKER_SETTLEMENT_INTERVAL_MS`
- `WORKER_SETTLEMENT_BATCH_SIZE`

For production / mainnet preparation also explicitly set:

- `RPC_RATE_LIMIT_ENABLED`
- `RPC_RATE_LIMIT_WINDOW_MS`
- `RPC_RATE_LIMIT_MAX_REQUESTS`
- `FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS`
- `FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST`
- `FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX`
- `FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX`
- `FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS`
- `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY`

## 5. Deployment order

Do not deploy everything and start debugging from the top of the UI. Use staged bring-up.

### Stage A — DNS / public endpoint readiness

Before blaming the application:

- confirm the hostname resolves to the expected ingress
- confirm Coolify has attached the domain to the correct app
- confirm TLS is actually ready
- confirm the public endpoint reaches the intended container/service

Why this matters:

Previous failures looked like app bugs at first, but were really DNS / ingress / readiness timing problems.

### Stage B — Deploy only the Fiber Link service stack

Start with the Compose stack containing:

- `postgres`
- `redis`
- `fnn`
- `rpc`
- `worker`

Do not add Discourse until this stage is stable.

Expected outcomes:

- all containers running
- no restart loop in the first 10 minutes
- FNN reachable from RPC and worker
- Postgres and Redis reachable from RPC and worker

### Stage C — Verify service-to-service behavior

Required checks after bring-up:

- liveness endpoint works
- readiness endpoint works
- signed RPC request succeeds
- invalid signature is rejected
- replay nonce is rejected
- invoice flow can be exercised successfully

If these fail, treat it as a service wiring problem first:

- wrong internal hostname
- wrong port
- wrong env var
- wrong Coolify network assumption
- wrong secret pairing

### Stage D — Add Discourse as a separate integration step

Only after Stage C passes should Discourse be introduced.

At this stage, verify separately:

- Discourse boots and is reachable
- plugin is installed and enabled
- `fiber_link_service_url` points to a reachable RPC endpoint
- `fiber_link_app_id` / `fiber_link_app_secret` pair correctly with RPC auth
- plugin can generate a valid invoice through the live backend

## 6. Coolify-specific operator guidance

### Use explicit service contracts

Document for each environment:

- service name
- internal hostname used by peer containers
- exposed public URL, if any
- required env vars
- dependency order

Do not rely on memory for internal URL wiring.

### Keep Discourse separate from the payment stack

Even in the same Coolify project, operate them separately.

Why:

- restarting Discourse should not imply restarting Fiber Link services
- plugin debugging is a different problem from RPC/FNN debugging
- rollback blast radius is smaller

### Prefer deterministic verification over dashboard status

Coolify showing "healthy" is necessary but not sufficient.

Operator sign-off should always include:

- actual HTTP checks
- actual signed RPC checks
- actual invoice generation
- actual settlement / withdrawal evidence when relevant

## 7. Known pitfalls

### Pitfall 1 — DNS looks close enough, but the app is not really reachable

Symptoms:

- domain resolves inconsistently
- Coolify shows a deployed app, but public traffic still fails
- TLS/hostname behavior is flaky during first validation

Action:

- validate DNS first
- validate ingress next
- only then debug app behavior

### Pitfall 2 — containers are healthy, but services are not wired correctly

Symptoms:

- RPC starts but cannot talk to FNN
- worker starts but settlement/invoice paths fail
- health looks green while cross-service functionality is broken

Action:

- verify internal hostnames and ports
- verify service environment variables
- verify FNN RPC endpoint from inside the app network context

### Pitfall 3 — Discourse running does not mean the plugin path is correct

Symptoms:

- forum is up
- plugin is enabled
- payment actions still fail

Action:

- validate `fiber_link_service_url`
- validate app id / secret pairing
- test a real signed request path
- verify invoice creation from the plugin surface

### Pitfall 4 — trying to force Discourse onto Coolify when it is slowing down delivery

Symptoms:

- repeated operational friction specific to the forum layer
- most time spent on hosting mechanics rather than Fiber Link behavior

Action:

- switch Discourse to direct Docker if needed
- keep Fiber Link service stack on Coolify if that portion is stable

### Pitfall 5 — deployment success does not imply operational readiness

Symptoms observed later in testnet/demo operation:

- scheduled activity did not always execute
- withdrawals could fail due to real balance/state constraints
- post-deploy automation exposed hidden assumptions

Action:

- after deploy, also verify:
  - balances
  - cron / orchestrator execution
  - withdrawal readiness
  - synthetic activity dependencies

## 8. Discourse integration notes

If Discourse is part of the environment:

1. deploy and validate Discourse itself
2. install the Fiber Link plugin
3. configure:
   - `fiber_link_enabled = true`
   - `fiber_link_service_url`
   - `fiber_link_app_id`
   - `fiber_link_app_secret`
4. verify plugin-to-RPC auth pairing rules
5. execute a real invoice-generation smoke test from the forum UI

Operational note:

- a forum page loading successfully is not an acceptance check
- a successful plugin-backed invoice request is the minimum useful check

## 9. Fallback policy for Discourse

If Discourse-on-Coolify becomes too problematic:

- do not block the Fiber Link stack waiting for a perfect shared hosting model
- move Discourse to direct Docker
- keep the integration contract stable:
  - public forum URL
  - reachable RPC URL
  - app id / secret pairing

The goal is reliable system behavior, not platform purity.

## 10. Minimum post-deploy checklist

### Fiber Link stack

- [ ] `postgres`, `redis`, `fnn`, `rpc`, `worker` are running without restart loop
- [ ] liveness/readiness endpoints pass
- [ ] signed RPC smoke test passes
- [ ] invalid signature and replay nonce checks fail as expected
- [ ] invoice generation works

### Discourse/plugin

- [ ] Discourse reachable
- [ ] plugin enabled
- [ ] plugin config points to the correct RPC URL
- [ ] app id / secret pairing verified
- [ ] invoice can be created from UI

### Operations

- [ ] logs collected for first deployment window
- [ ] deployment evidence bundle captured
- [ ] rollback path documented before expanding traffic

## 11. Relationship to mainnet readiness

This runbook is for deployment mechanics.

Mainnet release readiness still requires the full gate in:

- `docs/runbooks/mainnet-deployment-checklist.md`

Use this Coolify runbook to get the system deployed correctly.
Use the mainnet checklist to decide whether it is safe to launch.
