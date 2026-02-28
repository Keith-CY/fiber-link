# Fiber Link Phase 2 Delivery Implementation Plan

Status: Diverged historical delivery-plan snapshot.
Canonical replacements: `docs/02-architecture.md`, `docs/06-development-progress.md`, `docs/plans/2026-02-21-issue-32-epic-closeout.md`.
Canonical index: `docs/current-architecture.md`.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the merged MVP scaffold into a working end-to-end tipping and withdrawal system on testnet with production-safe controls.

**Architecture:** Keep the existing split (Discourse plugin -> RPC service -> adapter/worker -> DB) and replace stubs incrementally behind tested boundaries. Build prerequisites first (DB runtime, repositories, migration path), then core flows (tip, settlement, withdrawal), then control-plane and UX (admin + plugin), then hardening.

**Tech Stack:** Bun workspaces, Fastify, tRPC, Drizzle ORM, Redis, Discourse plugin (Ruby + Ember), Vitest, GitHub Actions.

## Status

Plan execution status at authoring time: COMPLETED (merged to `main`).

Merged PRs:
- PR #3: Phase2 Task 1 to Task 2
- PR #4: Phase2 Task 3 to Task 5
- PR #5: Phase2 Task 6
- PR #6: Phase2 Task 7
- PR #7: Phase2 Task 8
- PR #8: Phase2 Task 10
- PR #9: Phase2 Task 9

Progress summary and post-Phase 2 roadmap: `docs/06-development-progress.md`

---

### Task 1: Lock Product and Protocol Decisions Before More Code

**Files:**
- Modify: `docs/04-research-plan.md`
- Modify: `docs/03-risks-open-questions.md`
- Create: `docs/decisions/2026-02-07-phase2-decisions.md`

**Step 1: Add decision template with unresolved fields**

```md
# Phase 2 Decisions
- Asset set: CKB + ____
- Custody boundary: ____
- Invoice timeout/retry policy: ____
- Withdrawal batching target: ____
```

**Step 2: Mark resolved vs unresolved research checklist items with owner/date**

Run: `rg -n "\[ \]" docs/04-research-plan.md`
Expected: all remaining open items have explicit owner and target date.

**Step 3: Link each open risk to one implementation task in this plan**

Run: `rg -n "mitigation|control|task" docs/03-risks-open-questions.md docs/decisions/2026-02-07-phase2-decisions.md`
Expected: every high-risk item references a concrete task number.

**Step 4: Commit**

```bash
git add docs/04-research-plan.md docs/03-risks-open-questions.md docs/decisions/2026-02-07-phase2-decisions.md
git commit -m "docs: lock phase2 decisions and risk mapping"
```

---

### Task 2: Build DB Runtime Foundation Before DB-Heavy Features

**Files:**
- Create: `fiber-link-service/packages/db/src/client.ts`
- Modify: `fiber-link-service/packages/db/src/index.ts`
- Create: `fiber-link-service/packages/db/src/client.test.ts`
- Create: `fiber-link-service/packages/db/drizzle.config.ts`
- Modify: `fiber-link-service/.env.example`

**Step 1: Write failing tests for DB client bootstrap**

```ts
it("creates a db client when DATABASE_URL is present", async () => {});
it("throws a clear error when DATABASE_URL is missing", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/packages/db`)
Expected: FAIL for missing client implementation.

**Step 3: Implement minimal DB runtime and export it**

```ts
export function createDbClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  // return drizzle(client)
}
```

**Step 4: Add migration config and env docs**

Run: `rg -n "DATABASE_URL" fiber-link-service/packages/db fiber-link-service/.env.example`
Expected: env variable and migration entry point are documented.

**Step 5: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/packages/db`)
Expected: PASS.

**Step 6: Commit**

```bash
git add fiber-link-service/packages/db/src/client.ts fiber-link-service/packages/db/src/index.ts fiber-link-service/packages/db/src/client.test.ts fiber-link-service/packages/db/drizzle.config.ts fiber-link-service/.env.example
git commit -m "feat(db): add runtime client foundation"
```

---

### Task 3: Replace Fiber Adapter Stubs With Real Node Calls

**Files:**
- Modify: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/fiber-client.ts`

**Step 1: Write failing tests for adapter request/response mapping**

```ts
it("createInvoice calls node rpc and returns invoice string", async () => {});
it("getInvoiceStatus maps settled and failed states", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/packages/fiber-adapter`)
Expected: FAIL.

**Step 3: Implement transport and typed error handling**

```ts
export async function rpcCall(endpoint: string, method: string, params: unknown) {
  // fetch JSON-RPC and normalize error surface
}
```

**Step 4: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/packages/fiber-adapter`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/fiber-adapter/src/index.ts fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts fiber-link-service/packages/fiber-adapter/src/fiber-client.ts
git commit -m "feat(adapter): implement fiber rpc client"
```

---

### Task 4: Persist Tip Intents and Invoice State in DB

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/methods/tip.ts`
- Modify: `fiber-link-service/apps/rpc/src/methods/tip.test.ts`
- Modify: `fiber-link-service/packages/db/src/schema.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.test.ts`

**Step 1: Write failing repository tests**

```ts
it("creates tip_intent with UNPAID state and returns stable id", async () => {});
it("updates invoice state idempotently", async () => {});
it("rejects duplicate invoice inserts to preserve 1:1 invoice mapping", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: FAIL.

**Step 3: Implement repository and wire `tip.create` persistence with unique invoice contract**

```ts
const intent = await tipIntentRepo.create({ appId, postId, fromUserId, toUserId, asset, amount, invoice });
// schema: tip_intents.invoice must be UNIQUE for settlement lookup safety
```

Run: `rg -n "invoice.*unique|unique.*invoice" fiber-link-service/packages/db/src/schema.ts`
Expected: `tip_intents.invoice` has explicit uniqueness (or equivalent unique index) and repository lookup relies on that 1:1 mapping.

```ts
const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(invoice);
```

**Step 4: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/tip.ts fiber-link-service/apps/rpc/src/methods/tip.test.ts fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.ts fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.test.ts fiber-link-service/packages/db/src/schema.ts
git commit -m "feat(rpc): persist tip intents"
```

---

### Task 5: Implement Settlement Worker With Collision-Safe Idempotency

**Files:**
- Modify: `fiber-link-service/apps/worker/src/settlement.ts`
- Modify: `fiber-link-service/apps/worker/src/settlement.test.ts`
- Create: `fiber-link-service/apps/worker/src/repositories/ledger-repo.ts`
- Create: `fiber-link-service/apps/worker/src/repositories/ledger-repo.test.ts`

**Step 1: Write failing tests for exactly-once settlement crediting**

```ts
it("credits recipient once using tip_intent idempotency source", async () => {});
it("ignores duplicate settlement events for same tip_intent", async () => {});
it("fails settlement when invoice does not resolve to exactly one tip_intent", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: FAIL.

**Step 3: Resolve settlement event by unique invoice, then derive idempotency key from durable DB identity**

```ts
const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(invoice);
const idempotencyKey = `settlement:tip_intent:${tipIntent.id}`;
await ledgerRepo.creditOnce({ idempotencyKey, ... });
```

**Step 4: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/settlement.ts fiber-link-service/apps/worker/src/settlement.test.ts fiber-link-service/apps/worker/src/repositories/ledger-repo.ts fiber-link-service/apps/worker/src/repositories/ledger-repo.test.ts
git commit -m "feat(worker): collision-safe settlement idempotency"
```

---

### Task 6: Build Withdrawal Lifecycle With Retryable Failures

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.ts`
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`
- Modify: `fiber-link-service/apps/worker/src/withdrawal-batch.ts`
- Modify: `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts`
- Modify: `fiber-link-service/packages/db/src/schema.ts`

**Step 1: Write failing tests for retry-capable state machine**

```ts
it("creates PENDING withdrawal request", async () => {});
it("moves transient failure to RETRY_PENDING with nextRetryAt", async () => {});
it("moves permanent failure to FAILED after retry budget exhausted", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: FAIL.

**Step 3: Implement state machine with retry metadata**

```ts
PENDING -> PROCESSING -> COMPLETED
PENDING -> PROCESSING -> RETRY_PENDING -> PROCESSING
PENDING -> PROCESSING -> FAILED (after max retries)
```

**Step 4: Run tests to verify GREEN**

Run: same commands as Step 2
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/withdrawal.ts fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts fiber-link-service/apps/worker/src/withdrawal-batch.ts fiber-link-service/apps/worker/src/withdrawal-batch.test.ts fiber-link-service/packages/db/src/schema.ts
git commit -m "feat: add retryable withdrawal state machine"
```

---

### Task 7: Move App Secret Source of Truth to DB With Safe Cutover

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/rpc.ts`
- Modify: `fiber-link-service/apps/rpc/src/secret-map.ts`
- Modify: `fiber-link-service/apps/rpc/src/secret-map.test.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/app-repo.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/app-repo.test.ts`
- Create: `fiber-link-service/apps/rpc/src/scripts/backfill-app-secrets.ts`
- Create: `docs/runbooks/secret-cutover.md`

**Step 1: Write failing tests for dual-read behavior during rollout**

```ts
it("uses DB secret when app record exists", async () => {});
it("falls back to env map only when DB record is missing", async () => {});
it("returns unauthorized when neither DB nor env fallback has secret", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: FAIL.

**Step 3: Implement dual-read plus observability and backfill script**

```ts
// Phase A rollout
secret = dbSecret ?? envFallbackSecret;
```

Run: `bun src/scripts/backfill-app-secrets.ts --dry-run`
Expected: outputs missing apps and proposed updates.

**Step 4: Add rollout phases in runbook**

```md
Phase A: dual-read + metrics
Phase B: backfill complete and verify 100%
Phase C: disable env fallback and remove code
```

**Step 5: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: PASS.

**Step 6: Commit**

```bash
git add fiber-link-service/apps/rpc/src/rpc.ts fiber-link-service/apps/rpc/src/secret-map.ts fiber-link-service/apps/rpc/src/secret-map.test.ts fiber-link-service/apps/rpc/src/repositories/app-repo.ts fiber-link-service/apps/rpc/src/repositories/app-repo.test.ts fiber-link-service/apps/rpc/src/scripts/backfill-app-secrets.ts docs/runbooks/secret-cutover.md
git commit -m "feat(rpc): safe db secret cutover with dual-read"
```

---

### Task 8: Wire Admin tRPC to Real Data and Role Checks

**Files:**
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/app.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/trpc.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/app.test.ts`
- Create: `fiber-link-service/apps/admin/src/server/api/routers/withdrawal.test.ts`

**Step 1: Write failing tests for data responses and role gating**

```ts
it("returns apps for allowed role", async () => {});
it("returns withdrawals for allowed role", async () => {});
it("rejects forbidden role", async () => {});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/admin`)
Expected: FAIL.

**Step 3: Implement DB-backed procedures with role checks**

**Step 4: Run tests to verify GREEN**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/admin`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/admin/src/server/api/routers/app.ts fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts fiber-link-service/apps/admin/src/server/api/trpc.ts fiber-link-service/apps/admin/src/server/api/routers/app.test.ts fiber-link-service/apps/admin/src/server/api/routers/withdrawal.test.ts
git commit -m "feat(admin): connect tRPC routers to data"
```

---

### Task 9: Upgrade Discourse UI From Skeleton to Functional Flow

Assumption: plugin specs run inside an external Discourse checkout that mounts this plugin under `plugins/fiber-link-discourse-plugin`.

**Files:**
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs`
- Modify: `fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb`

**Step 1: Add failing UI/spec assertions for tip lifecycle states**

```rb
it "shows invoice, pending, and settled states" do
  # ...
end
```

**Step 2: Bootstrap Discourse test harness and run plugin spec to verify RED**

Run:
`export FIBER_LINK_ROOT="${FIBER_LINK_ROOT:-$(git rev-parse --show-toplevel)}"`
`export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}"`
`[ -d "$DISCOURSE_DEV_ROOT/.git" ] || git clone https://github.com/discourse/discourse.git "$DISCOURSE_DEV_ROOT"`
`cd "$DISCOURSE_DEV_ROOT"`
`ln -sfn "$FIBER_LINK_ROOT/fiber-link-discourse-plugin" plugins/fiber-link-discourse-plugin`
`bundle install`
`RAILS_ENV=test bundle exec rake db:create db:migrate`
`bundle exec rspec plugins/fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb`
Expected: FAIL.

**Step 3: Implement status transitions, error rendering, and retry UX**

**Step 4: Run plugin specs to verify GREEN**

Run: `export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}" && cd "$DISCOURSE_DEV_ROOT" && bundle exec rspec plugins/fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb`
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb
git commit -m "feat(plugin): implement tip flow ui states"
```

---

### Task 10: Hardening and Verification Gate (Happy Path + Failure Path)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/runbooks/phase2-verification.md`
- Modify: `README.md`

**Step 1: Add CI jobs for rpc/admin/worker/db and plugin smoke checks**

**Step 2: Add verification runbook with mandatory negative tests**

```md
Core:
- bun run test -- --run --silent (rpc/admin/worker/db)
- export DISCOURSE_DEV_ROOT="${DISCOURSE_DEV_ROOT:-/tmp/discourse-dev}" && cd "$DISCOURSE_DEV_ROOT" && bundle exec rspec plugins/fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb

Security/failure gates:
- replay nonce rejected
- unauthorized appId rejected
- invalid signature rejected
- insufficient funds withdrawal rejected
- worker restart does not duplicate ledger credit
- transient withdrawal failure retries then recovers
```

**Step 3: Run local verification before merge**

Run:
- `bun run test -- --run --silent` in each Bun workspace
- plugin rspec commands
- targeted scenario tests from runbook
Expected: all pass.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/runbooks/phase2-verification.md README.md
git commit -m "chore: add phase2 failure-mode verification gate"
```

---

## Final Integration Checklist
- [ ] DB runtime foundation exists before repository tasks.
- [ ] No stubs remain in adapter and worker critical paths.
- [ ] Settlement idempotency key is based on durable DB identity.
- [ ] Withdrawal lifecycle supports retry and bounded failure.
- [ ] Secret cutover uses dual-read + backfill before fallback removal.
- [ ] Verification includes security and recovery failure paths.
- [ ] CI enforces required tests.
