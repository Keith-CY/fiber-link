# Fiber-to-CKB Chain Liquidity Rebalance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Accept creator withdrawals even when the platform hot wallet is underfunded, automatically rebalance liquidity from Fiber custody back onto the CKB chain, and complete creator payouts for both `CKB` and `USDI`.

**Architecture:** Add a new `LIQUIDITY_PENDING` withdrawal state plus a durable `liquidity_requests` table, keep creator debits coupled to successful payout completion, introduce a dedicated liquidity worker for `FIBER_TO_CKB_CHAIN`, and split payout execution into native `CKB` transfer and `USDI` xUDT transfer paths.

**Tech Stack:** TypeScript, Bun, Vitest, Drizzle ORM, PostgreSQL, Lumos, existing Fiber adapter and worker apps.

---

### Task 1: Add DB schema for liquidity-pending withdrawals and liquidity requests

**Files:**
- Modify: `fiber-link-service/packages/db/src/schema.ts`
- Modify: `fiber-link-service/packages/db/src/index.ts`
- Modify: `fiber-link-service/packages/db/src/schema.test.ts`
- Create: `fiber-link-service/packages/db/src/liquidity-request-repo.ts`
- Create: `fiber-link-service/packages/db/src/liquidity-request-repo.test.ts`
- Create: `fiber-link-service/packages/db/drizzle/0004_liquidity_requests.sql`

**Step 1: Write the failing tests**

Add schema/repo tests that assert:

```ts
expect(withdrawalStateEnum.enumValues).toContain("LIQUIDITY_PENDING");
expect(liquidityRequests).toBeDefined();

it("creates a liquidity request in REQUESTED state", async () => {
  const repo = createInMemoryLiquidityRequestRepo();
  const created = await repo.create({
    appId: "app1",
    asset: "CKB",
    network: "AGGRON4",
    sourceKind: "FIBER_TO_CKB_CHAIN",
    requiredAmount: "100",
  });
  expect(created.state).toBe("REQUESTED");
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/schema.test.ts src/liquidity-request-repo.test.ts
```
Expected: FAIL because the enum value, table, and repo do not exist.

**Step 3: Write the minimal implementation**

- Add `LIQUIDITY_PENDING` to `withdrawalStateEnum`
- Add `liquidity_requests` table and associated TypeScript types
- Add `liquidityRequestRepo` with both DB and in-memory implementations
- Export the repo from `packages/db/src/index.ts`
- Add the SQL migration

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/schema.test.ts src/liquidity-request-repo.test.ts
bun run --cwd fiber-link-service/packages/db db:drift:check
```
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/db/src/schema.ts fiber-link-service/packages/db/src/index.ts fiber-link-service/packages/db/src/schema.test.ts fiber-link-service/packages/db/src/liquidity-request-repo.ts fiber-link-service/packages/db/src/liquidity-request-repo.test.ts fiber-link-service/packages/db/drizzle/0004_liquidity_requests.sql
git commit -m "feat(db): add liquidity request schema and state"
```

---

### Task 2: Extend withdrawal repo transitions for liquidity gating

**Files:**
- Modify: `fiber-link-service/packages/db/src/withdrawal-repo.ts`
- Modify: `fiber-link-service/packages/db/src/withdrawal-repo.test.ts`

**Step 1: Write the failing tests**

Add tests for:

```ts
it("creates a withdrawal in LIQUIDITY_PENDING with linked liquidity request", async () => {
  const repo = createInMemoryWithdrawalRepo();
  const created = await repo.createLiquidityPending({
    appId: "app1",
    userId: "u1",
    asset: "CKB",
    amount: "61",
    toAddress: "ckt1...",
    liquidityRequestId: "liq1",
    liquidityPendingReason: "hot wallet underfunded",
  });
  expect(created.state).toBe("LIQUIDITY_PENDING");
  expect(created.liquidityRequestId).toBe("liq1");
});

it("promotes liquidity pending withdrawal to PENDING", async () => {
  const repo = createInMemoryWithdrawalRepo();
  const created = await repo.createLiquidityPending(/* ... */);
  const promoted = await repo.markPendingFromLiquidity(created.id, new Date("2026-03-07T00:00:00.000Z"));
  expect(promoted.state).toBe("PENDING");
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/withdrawal-repo.test.ts
```
Expected: FAIL because the fields and transitions do not exist.

**Step 3: Write the minimal implementation**

- Extend `WithdrawalRecord` and repo interface with:
  - `liquidityRequestId`
  - `liquidityPendingReason`
  - `liquidityCheckedAt`
  - `createLiquidityPending`
  - `markPendingFromLiquidity`
  - `listLiquidityPending`
- Implement both DB and in-memory variants
- Keep `markCompletedWithDebit` semantics unchanged

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/withdrawal-repo.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/db/src/withdrawal-repo.ts fiber-link-service/packages/db/src/withdrawal-repo.test.ts
git commit -m "feat(db): add liquidity pending withdrawal transitions"
```

---

### Task 3: Wire `LIQUIDITY_PENDING` through contracts, RPC payloads, and dashboards

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/contracts.ts`
- Modify: `fiber-link-service/apps/rpc/src/contracts.test.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-data.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-data.test.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-model.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-model.type.test.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-view.ts`
- Modify: `fiber-link-service/apps/admin/src/pages/dashboard-view.test.ts`
- Modify: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-withdrawal-panel.gjs`
- Modify: `fiber-link-discourse-plugin/assets/stylesheets/common/fiber-link.scss`
- Modify: `fiber-link-discourse-plugin/spec/system/fiber_link_dashboard_spec.rb`

**Step 1: Write the failing tests**

Add tests asserting that:

```ts
expect(WithdrawalRequestResultSchema.parse({ id: "w1", state: "LIQUIDITY_PENDING" }).state).toBe("LIQUIDITY_PENDING");
expect(DashboardWithdrawalStateFilterSchema.options).toContain("LIQUIDITY_PENDING");
expect(WITHDRAWAL_STATE_ORDER).toContain("LIQUIDITY_PENDING");
```

Add UI expectations that the dashboard renders a distinct liquidity-pending badge/copy.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/rpc test -- --run src/contracts.test.ts
bun run --cwd fiber-link-service/apps/admin test -- --run src/pages/dashboard-data.test.ts src/pages/dashboard-model.type.test.ts src/pages/dashboard-view.test.ts
```
Expected: FAIL because the new state is not yet allowed everywhere.

**Step 3: Write the minimal implementation**

- Add `LIQUIDITY_PENDING` to RPC schemas and dashboard filters
- Add admin dashboard ordering and summary handling
- Add creator dashboard copy/badge for liquidity-pending withdrawals

**Step 4: Run tests to verify they pass**

Run the same commands from Step 2.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/contracts.ts fiber-link-service/apps/rpc/src/contracts.test.ts fiber-link-service/apps/admin/src/pages/dashboard-data.ts fiber-link-service/apps/admin/src/pages/dashboard-data.test.ts fiber-link-service/apps/admin/src/pages/dashboard-model.ts fiber-link-service/apps/admin/src/pages/dashboard-model.type.test.ts fiber-link-service/apps/admin/src/pages/dashboard-view.ts fiber-link-service/apps/admin/src/pages/dashboard-view.test.ts fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-withdrawal-panel.gjs fiber-link-discourse-plugin/assets/stylesheets/common/fiber-link.scss fiber-link-discourse-plugin/spec/system/fiber_link_dashboard_spec.rb
git commit -m "feat(ui): surface liquidity pending withdrawal state"
```

---

### Task 4: Add hot wallet inventory provider for CKB and USDI

**Files:**
- Create: `fiber-link-service/packages/fiber-adapter/src/hot-wallet-inventory.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/hot-wallet-inventory.test.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/types.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/package.json`

**Step 1: Write the failing tests**

Add tests for:

```ts
it("returns spendable native CKB for the platform hot wallet", async () => {
  const inventory = await getHotWalletInventory({ asset: "CKB", network: "AGGRON4" }, deps);
  expect(inventory.availableAmount).toBe("200");
});

it("returns USDI liquidity plus required CKB support capacity", async () => {
  const inventory = await getHotWalletInventory({ asset: "USDI", network: "AGGRON4" }, deps);
  expect(inventory.availableAmount).toBe("500");
  expect(inventory.supportingCkbAmount).toBe("120");
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/hot-wallet-inventory.test.ts
```
Expected: FAIL because the provider does not exist.

**Step 3: Write the minimal implementation**

- Define shared inventory return types
- Implement:
  - native CKB inventory calculation
  - xUDT token inventory calculation
  - supporting CKB capacity + fee estimation for USDI
- Export the provider

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/hot-wallet-inventory.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/fiber-adapter/src/hot-wallet-inventory.ts fiber-link-service/packages/fiber-adapter/src/hot-wallet-inventory.test.ts fiber-link-service/packages/fiber-adapter/src/index.ts fiber-link-service/packages/fiber-adapter/src/types.ts fiber-link-service/packages/fiber-adapter/package.json
git commit -m "feat(adapter): add hot wallet inventory provider"
```

---

### Task 5: Route `withdrawal.request` to `PENDING` or `LIQUIDITY_PENDING`

**Files:**
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.ts`
- Modify: `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`
- Create: `fiber-link-service/apps/rpc/src/methods/liquidity.ts`
- Create: `fiber-link-service/apps/rpc/src/methods/liquidity.test.ts`

**Step 1: Write the failing tests**

Add tests asserting:

```ts
it("returns PENDING when hot wallet liquidity is sufficient", async () => {
  const result = await requestWithdrawal(input, { repo, ledgerRepo, hotWalletInventoryProvider });
  expect(result.state).toBe("PENDING");
});

it("returns LIQUIDITY_PENDING and creates liquidity request when hot wallet is underfunded", async () => {
  const result = await requestWithdrawal(input, { repo, ledgerRepo, liquidityRequestRepo, hotWalletInventoryProvider });
  expect(result.state).toBe("LIQUIDITY_PENDING");
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/rpc test -- --run src/methods/withdrawal.test.ts src/methods/liquidity.test.ts
```
Expected: FAIL because request-time liquidity gating does not exist.

**Step 3: Write the minimal implementation**

- Add a request-time liquidity decision helper
- Use existing creator balance check first
- If hot wallet inventory is enough:
  - create standard `PENDING`
- If hot wallet inventory is not enough:
  - create `LIQUIDITY_PENDING`
  - create or attach a `liquidity_request`

**Step 4: Run tests to verify they pass**

Run the same commands from Step 2.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/withdrawal.ts fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts fiber-link-service/apps/rpc/src/methods/liquidity.ts fiber-link-service/apps/rpc/src/methods/liquidity.test.ts
git commit -m "feat(rpc): gate withdrawals on hot wallet liquidity"
```

---

### Task 6: Implement the liquidity worker and `FIBER_TO_CKB_CHAIN` rebalance adapter

**Files:**
- Create: `fiber-link-service/apps/worker/src/liquidity-batch.ts`
- Create: `fiber-link-service/apps/worker/src/liquidity-batch.test.ts`
- Modify: `fiber-link-service/apps/worker/src/entry.ts`
- Modify: `fiber-link-service/apps/worker/src/worker-runtime.ts`
- Modify: `fiber-link-service/apps/worker/src/contracts.ts`
- Modify: `fiber-link-service/apps/worker/src/contracts.test.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/types.ts`

**Step 1: Write the failing tests**

Add worker tests that assert:

```ts
it("creates or advances a FIBER_TO_CKB_CHAIN rebalance and keeps withdrawals in LIQUIDITY_PENDING until funded", async () => {
  const result = await runLiquidityBatch({ repo, liquidityRequestRepo, liquidityProvider, inventoryProvider });
  expect(result.rebalanceStarted).toBe(1);
});

it("promotes covered withdrawals to PENDING after funding is observed", async () => {
  const result = await runLiquidityBatch({ repo, liquidityRequestRepo, liquidityProvider, inventoryProvider });
  expect(result.promoted).toBe(2);
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/liquidity-batch.test.ts src/contracts.test.ts
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/fiber-adapter.test.ts
```
Expected: FAIL because no liquidity worker or rebalance adapter exists.

**Step 3: Write the minimal implementation**

- Add worker runtime support for liquidity processing
- Extend the adapter interface with:
  - `ensureChainLiquidity`
  - `getRebalanceStatus`
- Implement the first concrete provider as `FIBER_TO_CKB_CHAIN`
- Promote `LIQUIDITY_PENDING` withdrawals to `PENDING` once inventory covers them

**Step 4: Run tests to verify they pass**

Run the same commands from Step 2.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/liquidity-batch.ts fiber-link-service/apps/worker/src/liquidity-batch.test.ts fiber-link-service/apps/worker/src/entry.ts fiber-link-service/apps/worker/src/worker-runtime.ts fiber-link-service/apps/worker/src/contracts.ts fiber-link-service/apps/worker/src/contracts.test.ts fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts fiber-link-service/packages/fiber-adapter/src/types.ts
git commit -m "feat(worker): add fiber-to-ckb-chain liquidity rebalance"
```

---

### Task 7: Add USDI xUDT on-chain payout executor

**Files:**
- Create: `fiber-link-service/packages/fiber-adapter/src/udt-onchain-withdrawal.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/udt-onchain-withdrawal.test.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/types.ts`
- Modify: `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts`

**Step 1: Write the failing tests**

Add tests asserting:

```ts
it("sends USDI xUDT to a creator CKB address", async () => {
  const result = await executeUdtOnchainWithdrawal({
    amount: "25",
    asset: "USDI",
    destination: { kind: "CKB_ADDRESS", address: "ckt1..." },
    requestId: "w1",
  });
  expect(result.txHash).toBe("0xtxhash");
});
```

Add worker tests verifying that a `USDI` withdrawal completes through the new executor path.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/udt-onchain-withdrawal.test.ts
bun run --cwd fiber-link-service/apps/worker test -- --run src/withdrawal-batch.test.ts
```
Expected: FAIL because only native CKB payout exists today.

**Step 3: Write the minimal implementation**

- Add a dedicated xUDT transfer builder
- Route `executeWithdrawal` by asset:
  - `CKB` -> native CKB transfer
  - `USDI` -> xUDT transfer
- Preserve the existing destination-type checks

**Step 4: Run tests to verify they pass**

Run the same commands from Step 2.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/fiber-adapter/src/udt-onchain-withdrawal.ts fiber-link-service/packages/fiber-adapter/src/udt-onchain-withdrawal.test.ts fiber-link-service/packages/fiber-adapter/src/index.ts fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts fiber-link-service/packages/fiber-adapter/src/types.ts fiber-link-service/apps/worker/src/withdrawal-batch.test.ts
git commit -m "feat(adapter): add usdi xudt on-chain withdrawal"
```

---

### Task 8: Close the loop with end-to-end coverage and operational visibility

**Files:**
- Modify: `scripts/e2e-discourse-four-flows.phase3-author-withdrawal.sh`
- Modify: `scripts/e2e-discourse-four-flows.phase4-postcheck.sh`
- Modify: `scripts/e2e-discourse-four-flows.phase5-explorer-and-finalize.sh`
- Modify: `scripts/playwright/workflow-author-withdrawal.run-code.js`
- Modify: `fiber-link-discourse-plugin/spec/requests/fiber_link/rpc_controller_spec.rb`
- Modify: `fiber-link-service/apps/admin/src/features/runtime-dashboard/runtime-dashboard.ts`
- Modify: `fiber-link-service/apps/admin/src/features/runtime-dashboard/runtime-dashboard.test.ts`

**Step 1: Write the failing tests**

Add expectations that:

- creator withdrawal response can return `LIQUIDITY_PENDING`
- admin dashboard shows `LIQUIDITY_PENDING`
- e2e scripts do not treat `LIQUIDITY_PENDING` as a failure before funding arrives

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/admin test -- --run src/features/runtime-dashboard/runtime-dashboard.test.ts
/tmp/discourse-dev-fiber-link/bin/docker/rspec plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb
scripts/test-e2e-discourse-four-flows-split.sh
```
Expected: FAIL because the new liquidity-pending lifecycle is not yet reflected in visibility and test harnesses.

**Step 3: Write the minimal implementation**

- Update runtime/admin dashboards to surface open liquidity work
- Update plugin request specs for `LIQUIDITY_PENDING`
- Update e2e scripts so they can wait through funding and then continue to completion

**Step 4: Run tests to verify they pass**

Run the same commands from Step 2, plus the relevant real e2e smoke once environments are ready.

**Step 5: Commit**

```bash
git add scripts/e2e-discourse-four-flows.phase3-author-withdrawal.sh scripts/e2e-discourse-four-flows.phase4-postcheck.sh scripts/e2e-discourse-four-flows.phase5-explorer-and-finalize.sh scripts/playwright/workflow-author-withdrawal.run-code.js fiber-link-discourse-plugin/spec/requests/fiber_link/rpc_controller_spec.rb fiber-link-service/apps/admin/src/features/runtime-dashboard/runtime-dashboard.ts fiber-link-service/apps/admin/src/features/runtime-dashboard/runtime-dashboard.test.ts
git commit -m "test: cover liquidity pending withdrawal flows"
```
