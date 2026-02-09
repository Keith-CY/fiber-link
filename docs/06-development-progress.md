# Fiber Link Development Progress

Last updated: 2026-02-09

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

Phase 2 intentionally shipped scaffolding + durable state machines + safety rails, but several production-critical behaviors are still placeholders or policy decisions.

### A) Close Open Decisions (Product + Protocol)

See: `docs/decisions/2026-02-07-phase2-decisions.md`

Open items include:
- Asset set (CKB + which stablecoin UDT)
- Custody boundary and required risk controls
- Invoice timeout/retry contract
- Withdrawal batching cadence/targets

These decisions should be closed before implementing withdrawal execution and settlement detection, otherwise the code will bake in the wrong contract.

### B) Settlement Detection Worker (Not Yet Implemented)

Current state:
- The worker has a settlement entrypoint (`fiber-link-service/apps/worker/src/settlement.ts`) that can credit once given `{ invoice }`.

Missing:
- A durable mechanism to discover invoice settlement events:
  - polling Fiber node invoice status
  - subscription/event stream (if available)
  - reconciliation/backfill loop for missed events

### C) Withdrawal Execution (Still Stubbed)

Current state:
- Withdrawals are persisted and the batch runner can claim and transition records with retry metadata.
- The actual execution function defaults to `ok: true` and must be replaced with real on-chain/Hub actions.

Next work:
- Implement execution via the Fiber adapter / node RPC.
- Capture permanent vs transient failures correctly and record tx hash / error details.

### D) Balance + Insufficient Funds Gate (Not Yet Implemented)

Current state:
- Ledger entries exist, and settlement credits can be applied idempotently.
- Withdrawal request does not validate balances yet (no debit path enforced).

Next work:
- Define balance invariants and implement:
  - balance read model (sum credits minus debits per user/app/asset)
  - withdrawal request validation (reject insufficient funds)
  - debit idempotency and coupling to withdrawal completion

### E) Admin Data Scoping (Needs Product Confirmation)

Current state:
- Admin routers allow `SUPER_ADMIN` and `COMMUNITY_ADMIN`.
- `SUPER_ADMIN` can list all apps and withdrawals.
- `COMMUNITY_ADMIN` is scoped by app membership via `app_admins` (requires `adminUserId` in admin tRPC context).

Open question:
- What is the intended admin model for MVP (app-scoped vs community-scoped vs global)?
  - If app-scoped: define how `app_admins` memberships are managed and mapped to BetterAuth identity.
  - If community-scoped/global: update schema and queries accordingly.

### F) CI/Runbook Alignment and Coverage

Current state:
- CI runs plugin request specs via `plugins/fiber-link/spec/requests` (directory).
- Runbook `docs/runbooks/phase2-verification.md` still calls the single-file smoke spec (`plugins/fiber-link/spec/requests/fiber_link_spec.rb`).

Next work:
- Align the runbook with CI (run full requests folder).
- Decide whether to add plugin system specs to CI (trade-off: runtime vs coverage).

## Suggested Next Milestone (Phase 3)

Deliver a production-aligned end-to-end money movement milestone:

- Close open decisions (asset set, custody/risk controls, timeouts)
- Add settlement detection + reconciliation loop
- Implement withdrawal execution + balance debits + insufficient-funds rejections
- Tighten admin scoping if required
