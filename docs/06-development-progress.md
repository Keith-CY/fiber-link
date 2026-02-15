# Fiber Link Development Progress

Last updated: 2026-02-15

This document summarizes what has shipped so far (Phase 2) and what remains (post-Phase 2 roadmap).

## Phase 2 Status (Completed)

Phase 2 implementation plan: `docs/plans/2026-02-07-phase2-delivery-plan.md`

All Phase 2 tasks (Task 1 to Task 10) are now merged into `main` via PRs:

- PR #3: Decisions + DB runtime foundation (Phase2 Task 1 to Task 2)
- PR #4: Fiber adapter + tip persistence + settlement idempotency (Phase2 Task 3 to Task 5)
- PR #5: Retryable withdrawal lifecycle + durable repo (Phase2 Task 6)
- PR #6: App secret cutover to DB (dual-read + backfill + runbook) (Phase2 Task 7)
- PR #7: Admin tRPC wired to DB + role gating (Phase2 Task 8)
- PR #8: Verification gate (CI + runbook) (Phase2 Task 10)
- PR #9: Discourse tip UI + hardened RPC proxy + request/system specs (Phase2 Task 9)
- PR #13: Service + FNN Docker Compose reference deployment baseline

Recent Phase 3 baseline deliveries:
- PR #15: Sprint 1 settlement polling + replay backfill baseline
- PR #16: Settlement observability metrics and runbook sync
- PR #17: Sprint 2 withdrawal execution via Fiber RPC + tx evidence

### Phase 2 Delivered Capabilities

Service:
- Drizzle DB runtime foundation (`fiber-link-service/packages/db`)
- Fiber adapter JSON-RPC client (`fiber-link-service/packages/fiber-adapter`)
- Tip intents persisted with `tip_intents.invoice` UNIQUE invariant (`fiber-link-service/packages/db/src/schema.ts`)
- Settlement crediting idempotency based on durable `tip_intents.id` (`fiber-link-service/apps/worker/src/settlement.ts`)
- Withdrawals persisted and processed with retry metadata + conflict-safe claiming (`fiber-link-service/packages/db/src/withdrawal-repo.ts`, `fiber-link-service/apps/worker/src/withdrawal-batch.ts`)
- App secret source-of-truth moved to DB with safe dual-read rollout + backfill (`fiber-link-service/apps/rpc/src/secret-map.ts`, `fiber-link-service/apps/rpc/src/scripts/backfill-app-secrets.ts`)
- Admin tRPC endpoints wired to DB with role checks (`fiber-link-service/apps/admin/src/server/api`)

Discourse plugin:
- Tip button + tip modal UI (topic connector -> entry component -> modal)
- Server-side RPC proxy hardening:
  - allowlist methods
  - server-derived `fromUserId` and `toUserId`
  - stable JSON-RPC error envelopes for parse/params/method errors
- Expanded plugin request/system specs for tip flow

Verification:
- CI runs bun workspace tests + a Discourse plugin smoke job
- Runbook: `docs/runbooks/phase2-verification.md`

## What's Not Done Yet (Post-Phase 2 Roadmap)

Phase 2 intentionally shipped scaffolding + durable state machines + safety rails. Post-Phase 2 work is now mostly hardening, policy closure, and operationalization.

### A) Product/Protocol Baseline Decisions (Locked)

Decisions are now explicitly captured and accepted:
- `docs/decisions/2026-02-10-settlement-discovery-strategy.md` (Option C: Year 1 = polling + backfill baseline)
- `docs/decisions/2026-02-10-custody-ops-controls.md` (Option A baseline controls + conservative retained balances)
- `docs/decisions/2026-02-10-usd-price-feed-policy.md` (Option B: primary + secondary + bounded fallback)
- `docs/decisions/2026-02-10-admin-membership-model.md` (Option A: app-scoped COMMUNITY_ADMIN via `app_admins`)

Remaining policy item to finalize in implementation tickets:
- concrete MVP asset tuple (CKB + selected stablecoin UDT symbol/id in code/config)

### B) Settlement Detection Worker (Implemented in Sprint 1)

Delivered:
- Polling-based settlement discovery loop in worker runtime (`fiber-link-service/apps/worker/src/worker-runtime.ts`, `fiber-link-service/apps/worker/src/settlement-discovery.ts`).
- Reconciliation/backfill command with app/time window filters (`fiber-link-service/apps/worker/src/scripts/backfill-settlements.ts`).
- Idempotent replay behavior preserved through settlement credit invariants (`fiber-link-service/apps/worker/src/settlement.ts`).
- Cursor-based scan progression to avoid fixed-limit starvation of newer unpaid invoices (`fiber-link-service/apps/worker/src/entry.ts`, `fiber-link-service/packages/db/src/tip-intent-repo.ts`).
- Settlement observability fields in discovery summaries:
  - pending backlog before/after scan
  - detection latency (p50/p95/max)
  - replay/scan counts

Remaining optimization (non-blocking):
- Event-subscription path for lower latency once upstream interface stability is proven.

### C) Withdrawal Execution (Implemented Baseline in Sprint 2)

Delivered:
- Worker default executor now invokes Fiber node RPC via adapter (`send_payment`) instead of returning `ok: true` stub (`fiber-link-service/apps/worker/src/withdrawal-batch.ts`, `fiber-link-service/packages/fiber-adapter/src/index.ts`).
- Completed withdrawals persist execution evidence via `tx_hash` / `txHash` (`fiber-link-service/packages/db/src/schema.ts`, `fiber-link-service/packages/db/src/withdrawal-repo.ts`).
- Retry classification now distinguishes transient vs permanent execution failures using RPC code/message heuristics (`fiber-link-service/apps/worker/src/withdrawal-batch.ts`).
- Admin withdrawal listing includes `txHash` for operational traceability (`fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts`).

Remaining follow-up:
- Replace heuristic classification with explicit Fiber error contract mapping once upstream error taxonomy is stabilized.
- Confirm long-term destination semantics (`toAddress` vs payment request) before plugin withdrawal UI rollout.

### D) Balance + Insufficient Funds Gate (Implemented Baseline)

Delivered:
- Withdrawal request path enforces insufficient-funds checks via `createWithBalanceCheck` (`fiber-link-service/apps/rpc/src/methods/withdrawal.ts`, `fiber-link-service/packages/db/src/withdrawal-repo.ts`).
- Available balance computation accounts for current pending withdrawals before allowing new requests (`fiber-link-service/packages/db/src/withdrawal-repo.ts`).
- Withdrawal completion writes a durable ledger debit with idempotency key `withdrawal:debit:<withdrawal_id>` (`fiber-link-service/packages/db/src/withdrawal-repo.ts`, `fiber-link-service/apps/worker/src/withdrawal-batch.ts`).

Remaining hardening:
- Add explicit per-app/per-user withdrawal policy limits (caps, cooldown rules) above the invariant baseline.
- Add operator-facing reconciliation/reporting focused on debit/txHash parity and exception handling playbooks.

### E) Admin Data Scoping (Policy Chosen, Ops Path Still Needed)

Current state:
- Admin routers allow `SUPER_ADMIN` and `COMMUNITY_ADMIN`.
- `SUPER_ADMIN` can list all apps and withdrawals.
- `COMMUNITY_ADMIN` is scoped by app membership via `app_admins` (requires `adminUserId` in admin tRPC context).

Open implementation question:
- How are `app_admins` memberships managed operationally in Year 1 (seed script vs SUPER_ADMIN endpoint) and audited?

### F) CI/Runbook Alignment and Coverage

Current state:
- CI `plugin-smoke` runs an explicit request-spec set:
  - `plugins/fiber-link/spec/requests/fiber_link_spec.rb`
  - `plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb`
- Runbook `docs/runbooks/phase2-verification.md` default scope matches the same two request specs through `scripts/plugin-smoke.sh`.

Next work:
- Decide whether to add plugin system specs to CI (trade-off: runtime vs coverage).
- Keep `PLUGIN_SMOKE_EXTRA_SPECS` as the opt-in path for broader local/CI smoke coverage when needed.

## Suggested Next Milestone (Phase 3)

Phase 3 Sprint 1 and Sprint 2 baselines are complete. Balance/debit invariants are now implemented at baseline, so next work should focus on policy and operational hardening.

- Sprint 3 (next): policy limits, dispute handling, and operations-grade reconciliation/reporting.

Historical reference (Sprint 1 plan): `docs/plans/2026-02-11-phase3-sprint1-settlement-v1-plan.md`

Next plan should be captured as a dedicated Sprint 3 plan doc before implementation starts.
