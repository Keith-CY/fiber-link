# Fiber Link Phase 2 Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the merged MVP scaffold into a working end-to-end tipping and withdrawal system on testnet with production-safe controls.

**Architecture:** Keep the existing split (Discourse plugin -> RPC service -> adapter/worker -> DB) and replace stubs incrementally behind tested boundaries. Prioritize correctness and security first (idempotency, replay protection, auth source-of-truth), then feature completeness (dashboard, withdrawals), then hardening (ops, observability).

**Tech Stack:** Bun workspaces, Fastify, tRPC, Drizzle ORM, Redis, Discourse plugin (Ruby + Ember), Vitest, GitHub Actions.

---

### Task 1: Lock Product/Protocol Decisions Before More Code

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

**Step 2: Mark resolved vs unresolved research checklist items**

Run: `rg -n "\[ \]" docs/04-research-plan.md`
Expected: list of unchecked items reduced and explicit owner/date added.

**Step 3: Add risk decisions and controls mapping**

Run: `rg -n "Severity|control|mitigation" docs/03-risks-open-questions.md docs/decisions/2026-02-07-phase2-decisions.md`
Expected: each open risk links to an implementation task.

**Step 4: Commit**

```bash
git add docs/04-research-plan.md docs/03-risks-open-questions.md docs/decisions/2026-02-07-phase2-decisions.md
git commit -m "docs: lock phase2 decisions and risk mapping"
```

---

### Task 2: Replace Fiber Adapter Stubs With Real Node Calls

**Files:**
- Modify: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/fiber-client.ts`

**Step 1: Write failing tests for real adapter behavior**

```ts
it("createInvoice calls node rpc and returns invoice string", async () => {
  // mock transport response and assert request payload shape
});

it("getInvoiceStatus maps settled/failed states", async () => {
  // assert domain mapping
});
```

**Step 2: Run tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/packages/fiber-adapter`)
Expected: FAIL for missing implementation.

**Step 3: Implement minimal transport and mapping**

```ts
export async function rpcCall(endpoint: string, method: string, params: unknown) {
  // fetch json-rpc and throw typed error when node returns error
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

### Task 3: Persist Tip Intents and Settlement State in DB

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/methods/tip.ts`
- Modify: `fiber-link-service/packages/db/src/schema.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.test.ts`
- Modify: `fiber-link-service/apps/rpc/src/methods/tip.test.ts`

**Step 1: Write failing repo tests for create + state update**

```ts
it("creates tip_intent with UNPAID state", async () => {});
it("marks tip_intent settled idempotently", async () => {});
```

**Step 2: Run repo tests to verify RED**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: FAIL due missing repository.

**Step 3: Implement repository + wire `tip.create` to persist intent**

```ts
await tipIntentRepo.create({ appId, postId, fromUserId, toUserId, asset, amount, invoice });
```

**Step 4: Re-run tests**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: PASS for tip path.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/tip.ts fiber-link-service/apps/rpc/src/methods/tip.test.ts fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.ts fiber-link-service/apps/rpc/src/repositories/tip-intent-repo.test.ts fiber-link-service/packages/db/src/schema.ts
git commit -m "feat(rpc): persist tip intents"
```

---

### Task 4: Implement Settlement Worker With Idempotent Ledger Credits

**Files:**
- Modify: `fiber-link-service/apps/worker/src/settlement.ts`
- Modify: `fiber-link-service/apps/worker/src/settlement.test.ts`
- Create: `fiber-link-service/apps/worker/src/repositories/ledger-repo.ts`
- Create: `fiber-link-service/apps/worker/src/repositories/ledger-repo.test.ts`

**Step 1: Write failing tests for exactly-once crediting**

```ts
it("credits recipient once per invoice", async () => {});
it("skips duplicate settlement events using idempotency key", async () => {});
```

**Step 2: Run worker tests (RED)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: FAIL.

**Step 3: Implement settlement job with idempotency key**

```ts
const idempotencyKey = `settlement:${invoice}`;
await ledgerRepo.creditOnce({ idempotencyKey, ... });
```

**Step 4: Run worker tests (GREEN)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/settlement.ts fiber-link-service/apps/worker/src/settlement.test.ts fiber-link-service/apps/worker/src/repositories/ledger-repo.ts fiber-link-service/apps/worker/src/repositories/ledger-repo.test.ts
git commit -m "feat(worker): idempotent settlement crediting"
```

---

### Task 5: Build Withdrawal Request + Batch Execution

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.ts`
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`
- Modify: `fiber-link-service/apps/worker/src/withdrawal-batch.ts`
- Modify: `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts`
- Modify: `fiber-link-service/packages/db/src/schema.ts`

**Step 1: Add failing tests for withdrawal lifecycle**

```ts
it("creates pending withdrawal request", async () => {});
it("batch picks eligible requests and marks processing", async () => {});
it("successful send marks completed", async () => {});
```

**Step 2: Run rpc + worker tests (RED)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/worker`)
Expected: FAIL.

**Step 3: Implement minimal state machine**

```ts
PENDING -> PROCESSING -> COMPLETED
PENDING -> PROCESSING -> FAILED
```

**Step 4: Run tests (GREEN)**

Run: same commands as Step 2
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/withdrawal.ts fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts fiber-link-service/apps/worker/src/withdrawal-batch.ts fiber-link-service/apps/worker/src/withdrawal-batch.test.ts fiber-link-service/packages/db/src/schema.ts
git commit -m "feat: implement withdrawal lifecycle"
```

---

### Task 6: Move App Secret Source of Truth to DB

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/rpc.ts`
- Modify: `fiber-link-service/apps/rpc/src/secret-map.ts`
- Modify: `fiber-link-service/apps/rpc/src/secret-map.test.ts`
- Create: `fiber-link-service/apps/rpc/src/repositories/app-repo.ts`

**Step 1: Write failing tests for DB-backed secret lookup**

```ts
it("prefers app secret from apps table by x-app-id", async () => {});
it("returns unauthorized when app record missing", async () => {});
```

**Step 2: Run rpc tests (RED)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: FAIL.

**Step 3: Implement repository lookup and remove env-map runtime path**

**Step 4: Run rpc tests (GREEN)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/rpc`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/rpc.ts fiber-link-service/apps/rpc/src/secret-map.ts fiber-link-service/apps/rpc/src/secret-map.test.ts fiber-link-service/apps/rpc/src/repositories/app-repo.ts
git commit -m "feat(rpc): load hmac secret from db"
```

---

### Task 7: Wire Admin tRPC to Real Data + Role Checks

**Files:**
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/app.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/trpc.ts`
- Modify: `fiber-link-service/apps/admin/src/server/api/routers/app.test.ts`
- Create: `fiber-link-service/apps/admin/src/server/api/routers/withdrawal.test.ts`

**Step 1: Write failing tests for non-empty list responses and role gating**

```ts
it("returns apps for allowed role", async () => {});
it("returns withdrawals for allowed role", async () => {});
it("rejects forbidden role", async () => {});
```

**Step 2: Run admin tests (RED)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/admin`)
Expected: FAIL.

**Step 3: Implement db reads and role checks in procedures**

**Step 4: Run admin tests (GREEN)**

Run: `bun run test -- --run --silent` (in `fiber-link-service/apps/admin`)
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/admin/src/server/api/routers/app.ts fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts fiber-link-service/apps/admin/src/server/api/trpc.ts fiber-link-service/apps/admin/src/server/api/routers/app.test.ts fiber-link-service/apps/admin/src/server/api/routers/withdrawal.test.ts
git commit -m "feat(admin): connect tRPC routers to data"
```

---

### Task 8: Upgrade Discourse UI From Skeleton to Functional Flow

**Files:**
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs`
- Modify: `fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb`

**Step 1: Add failing UI/spec assertions for status transitions**

```rb
it "shows created invoice and pending state after submit" do
  # ...
end
```

**Step 2: Run plugin specs (RED)**

Run: `bundle exec rspec spec/system/fiber_link_tip_spec.rb`
Expected: FAIL.

**Step 3: Implement invoice + status + error rendering in modal/dashboard**

**Step 4: Re-run plugin specs (GREEN)**

Run: same as Step 2
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb
git commit -m "feat(plugin): implement tip flow ui states"
```

---

### Task 9: Hardening + Verification Gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/runbooks/phase2-verification.md`
- Modify: `README.md`

**Step 1: Add CI matrix + required test jobs**

**Step 2: Add verification runbook with exact commands**

```md
- bun run test -- --run --silent (rpc/admin/worker/db)
- bundle exec rspec (plugin)
- smoke: tip.create -> settle -> dashboard balance -> withdrawal request
```

**Step 3: Run local verification before merge**

Run:
- `bun run test -- --run --silent` in each workspace
- plugin rspec commands
Expected: all green.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/runbooks/phase2-verification.md README.md
git commit -m "chore: add phase2 verification gate"
```

---

## Final Integration Checklist
- [ ] All task-level tests are green.
- [ ] No stubs remain in adapter/worker critical paths.
- [ ] DB-backed app secret lookup replaces env-map fallback.
- [ ] Discourse tip flow is demo-ready with user-visible state transitions.
- [ ] CI enforces required tests.

