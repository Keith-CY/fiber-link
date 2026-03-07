# Channel Rotation Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `channel_rotation` liquidity fallback that keeps creator withdrawals in `LIQUIDITY_PENDING`, opens a replacement Fiber channel, closes an older channel to the platform hot wallet, and resumes payout execution once chain-side liquidity is recovered.

**Architecture:** Keep direct `FIBER_TO_CKB_CHAIN` rebalance as the primary path, then add a worker-side fallback strategy that uses existing Fiber channel lifecycle RPCs (`list_channels`, `open_channel`, `shutdown_channel`) when direct rebalance is unavailable. Persist fallback progress in `liquidity_requests.metadata`, keep creator-facing withdrawal semantics unchanged, and gate the whole path behind explicit worker config so it can be disabled in production until validated.

**Tech Stack:** TypeScript, Bun, Vitest, Drizzle ORM, PostgreSQL, existing Fiber adapter and worker apps, existing split e2e shell harness.

---

### Task 1: Extend liquidity request repo for fallback lifecycle tracking

**Files:**
- Modify: `fiber-link-service/packages/db/src/liquidity-request-repo.ts`
- Modify: `fiber-link-service/packages/db/src/liquidity-request-repo.test.ts`
- Modify: `fiber-link-service/packages/db/src/index.ts`

**Step 1: Write the failing tests**

Add tests for:

```ts
it("marks a liquidity request REBALANCING and merges metadata", async () => {
  const repo = createInMemoryLiquidityRequestRepo();
  const created = await repo.create({
    appId: "app1",
    asset: "CKB",
    network: "AGGRON4",
    sourceKind: "FIBER_TO_CKB_CHAIN",
    requiredAmount: "123",
    metadata: { recoveryStrategy: "CHANNEL_ROTATION" },
  });

  const updated = await repo.markRebalancing(created.id, {
    metadata: {
      replacementChannelId: "0xreplacement",
      legacyChannelId: "0xlegacy",
    },
  });

  expect(updated.state).toBe("REBALANCING");
  expect(updated.metadata).toMatchObject({
    recoveryStrategy: "CHANNEL_ROTATION",
    replacementChannelId: "0xreplacement",
    legacyChannelId: "0xlegacy",
  });
});

it("marks a liquidity request FAILED without losing existing metadata", async () => {
  const repo = createInMemoryLiquidityRequestRepo();
  const created = await repo.create({
    appId: "app1",
    asset: "CKB",
    network: "AGGRON4",
    sourceKind: "FIBER_TO_CKB_CHAIN",
    requiredAmount: "123",
    metadata: { recoveryStrategy: "CHANNEL_ROTATION" },
  });

  const failed = await repo.markFailed(created.id, {
    error: "replacement channel never became ready",
    metadata: { lastRotationError: "replacement channel never became ready" },
  });

  expect(failed.state).toBe("FAILED");
  expect(failed.lastError).toBe("replacement channel never became ready");
  expect(failed.metadata).toMatchObject({
    recoveryStrategy: "CHANNEL_ROTATION",
    lastRotationError: "replacement channel never became ready",
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/liquidity-request-repo.test.ts
```

Expected: FAIL because `markRebalancing`, `markFailed`, and metadata merge behavior do not exist.

**Step 3: Write minimal implementation**

- Add repo methods:
  - `markRebalancing(liquidityRequestId, input)`
  - `markFailed(liquidityRequestId, input)`
  - `mergeMetadata(liquidityRequestId, input)`
- Keep state transitions explicit:
  - `REQUESTED -> REBALANCING`
  - `REQUESTED|REBALANCING -> FAILED`
  - `REQUESTED|REBALANCING -> FUNDED`
- Preserve existing metadata when merging new fallback progress keys.

Representative implementation shape:

```ts
function mergeMetadata(
  existing: LiquidityRequestMetadata | null,
  next: LiquidityRequestMetadata | null | undefined,
) {
  return {
    ...(existing ?? {}),
    ...(next ?? {}),
  };
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/packages/db test -- --run src/liquidity-request-repo.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/db/src/liquidity-request-repo.ts fiber-link-service/packages/db/src/liquidity-request-repo.test.ts fiber-link-service/packages/db/src/index.ts
git commit -m "feat(db): add liquidity fallback repo transitions"
```

---

### Task 2: Add worker config and fallback strategy selection

**Files:**
- Modify: `fiber-link-service/apps/worker/src/config.ts`
- Modify: `fiber-link-service/apps/worker/src/config.test.ts`
- Modify: `fiber-link-service/apps/worker/src/entry.ts`
- Modify: `deploy/compose/docker-compose.yml`
- Modify: `deploy/compose/.env.example`

**Step 1: Write the failing tests**

Add config tests for:

```ts
it("parses channel rotation fallback mode and reserves", () => {
  const config = parseWorkerConfig({
    FIBER_RPC_URL: "http://127.0.0.1:8227",
    FIBER_LIQUIDITY_FALLBACK_MODE: "channel_rotation",
    FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE: "61",
    FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT: "30",
    FIBER_CHANNEL_ROTATION_MAX_CONCURRENT: "2",
  });

  expect(config.liquidityFallbackMode).toBe("channel_rotation");
  expect(config.channelRotationBootstrapReserve).toBe("61");
  expect(config.channelRotationMinRecoverableAmount).toBe("30");
  expect(config.channelRotationMaxConcurrent).toBe(2);
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/config.test.ts
```

Expected: FAIL because these config keys do not exist.

**Step 3: Write minimal implementation**

- Extend `WorkerConfig` with:
  - `liquidityFallbackMode: "none" | "channel_rotation"`
  - `channelRotationBootstrapReserve: string`
  - `channelRotationMinRecoverableAmount: string`
  - `channelRotationMaxConcurrent: number`
- Parse decimal string envs without coercing them to JS floats.
- Pass the new config through `entry.ts`.
- Wire the env vars into `rpc/worker` services in `docker-compose.yml` and `.env.example`.

Representative parser shape:

```ts
function parseDecimalString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = (env[name] ?? fallback).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid ${name}: expected positive decimal string`);
  }
  return raw;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/config.ts fiber-link-service/apps/worker/src/config.test.ts fiber-link-service/apps/worker/src/entry.ts deploy/compose/docker-compose.yml deploy/compose/.env.example
git commit -m "feat(worker): add channel rotation fallback config"
```

---

### Task 3: Add Fiber adapter support for channel lifecycle and rebalance capability probing

**Files:**
- Modify: `fiber-link-service/packages/fiber-adapter/src/types.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/provider.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/simulation-adapter.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Modify: `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/channel-lifecycle.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

```ts
it("lists ready channels with local balances", async () => {
  const adapter = createAdapter({ endpoint: "http://localhost:8119" });
  const result = await adapter.listChannels({ includeClosed: false });
  expect(result.channels[0]).toMatchObject({
    channelId: "0xlegacy",
    state: "CHANNEL_READY",
    localBalance: "123",
    remotePubkey: "0xpeer",
  });
});

it("detects unsupported direct rebalance and falls back cleanly", async () => {
  const adapter = createAdapter({ endpoint: "http://localhost:8119" });
  const result = await adapter.getLiquidityCapabilities();
  expect(result.directRebalance).toBe(false);
  expect(result.channelLifecycle).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/fiber-adapter.test.ts src/channel-lifecycle.test.ts
```

Expected: FAIL because channel lifecycle methods and capability probing do not exist.

**Step 3: Write minimal implementation**

- Extend `FiberAdapter` with:
  - `getLiquidityCapabilities()`
  - `listChannels()`
  - `openChannel()`
  - `shutdownChannel()`
- Keep `accept_channel` out of production adapter surface for now; production fallback controls one node only.
- Implement capability probing by:
  - trying the direct rebalance path once
  - mapping method-not-supported / unauthorized-on-unknown-method to `directRebalance: false`
  - leaving `channelLifecycle: true` when standard channel RPCs are present
- Update `simulation-adapter.ts` so unit tests can model:
  - direct rebalance supported
  - direct rebalance unsupported
  - ready legacy channels

Representative type shape:

```ts
export type LiquidityCapabilities = {
  directRebalance: boolean;
  channelLifecycle: boolean;
};
```

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/packages/fiber-adapter test -- --run src/fiber-adapter.test.ts src/channel-lifecycle.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/packages/fiber-adapter/src/types.ts fiber-link-service/packages/fiber-adapter/src/rpc-adapter.ts fiber-link-service/packages/fiber-adapter/src/provider.ts fiber-link-service/packages/fiber-adapter/src/simulation-adapter.ts fiber-link-service/packages/fiber-adapter/src/index.ts fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts fiber-link-service/packages/fiber-adapter/src/channel-lifecycle.test.ts
git commit -m "feat(adapter): add channel lifecycle fallback surface"
```

---

### Task 4: Add worker-side channel rotation selector and executor

**Files:**
- Create: `fiber-link-service/apps/worker/src/channel-rotation.ts`
- Create: `fiber-link-service/apps/worker/src/channel-rotation.test.ts`
- Modify: `fiber-link-service/apps/worker/src/contracts.ts`
- Modify: `fiber-link-service/apps/worker/src/contracts.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

```ts
it("selects the largest eligible ready channel by local balance", async () => {
  const result = await runChannelRotation({
    shortfallAmount: "123",
    bootstrapReserve: "61",
    minRecoverableAmount: "30",
    channels: [
      { channelId: "0xsmall", state: "CHANNEL_READY", localBalance: "40", pendingTlcCount: 0 },
      { channelId: "0xlegacy", state: "CHANNEL_READY", localBalance: "150", pendingTlcCount: 0 },
    ],
  });

  expect(result.legacyChannelId).toBe("0xlegacy");
});

it("rejects rotation when bootstrap reserve is below replacement open requirement", async () => {
  await expect(
    runChannelRotation({
      shortfallAmount: "123",
      bootstrapReserve: "0",
      minRecoverableAmount: "30",
      channels: [{ channelId: "0xlegacy", state: "CHANNEL_READY", localBalance: "150", pendingTlcCount: 0 }],
    }),
  ).rejects.toThrow("bootstrap reserve");
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/channel-rotation.test.ts src/contracts.test.ts
```

Expected: FAIL because the selector/executor does not exist.

**Step 3: Write minimal implementation**

- Create `channel-rotation.ts` with two clear parts:
  - `selectLegacyChannel(...)`
  - `executeChannelRotation(...)`
- Enforce:
  - ready channels only
  - `pending_tlcs === 0`
  - `local_balance >= minRecoverableAmount`
  - bootstrap reserve must exist before replacement open
- Emit a dedicated worker event:
  - `liquidity.channel_rotation`

Representative event shape:

```ts
{
  type: "liquidity.channel_rotation",
  requestId,
  legacyChannelId,
  replacementChannelId,
  expectedRecoveredAmount,
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/channel-rotation.test.ts src/contracts.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/channel-rotation.ts fiber-link-service/apps/worker/src/channel-rotation.test.ts fiber-link-service/apps/worker/src/contracts.ts fiber-link-service/apps/worker/src/contracts.test.ts
git commit -m "feat(worker): add channel rotation selector and executor"
```

---

### Task 5: Integrate channel rotation fallback into liquidity batch

**Files:**
- Modify: `fiber-link-service/apps/worker/src/liquidity-batch.ts`
- Modify: `fiber-link-service/apps/worker/src/liquidity-batch.test.ts`
- Modify: `fiber-link-service/apps/worker/src/entry.ts`
- Modify: `fiber-link-service/apps/worker/src/worker-runtime.ts`

**Step 1: Write the failing tests**

Add tests that prove:

```ts
it("uses channel rotation when direct rebalance is unsupported and fallback mode is enabled", async () => {
  const result = await runLiquidityBatch({
    liquidityProvider: {
      getLiquidityCapabilities: async () => ({ directRebalance: false, channelLifecycle: true }),
      listChannels: async () => ({ channels: [{ channelId: "0xlegacy", state: "CHANNEL_READY", localBalance: "150" }] }),
      openChannel: async () => ({ temporaryChannelId: "0xreplacement" }),
      shutdownChannel: async () => undefined,
      ensureChainLiquidity: async () => ({ state: "FAILED", started: false, error: "unsupported" }),
      getRebalanceStatus: async () => ({ state: "FAILED", error: "unsupported" }),
    },
    fallbackMode: "channel_rotation",
    inventoryProvider: async () => ({ asset: "CKB", network: "AGGRON4", availableAmount: "0" }),
  });

  expect(result.rebalanceStarted).toBe(0);
  expect(result.channelRotationStarted).toBe(1);
});
```

Add a second test proving fallback is skipped when:

- fallback mode is `none`
- no eligible channels
- bootstrap reserve is insufficient

**Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/liquidity-batch.test.ts src/worker-runtime.test.ts
```

Expected: FAIL because `runLiquidityBatch` does not know about channel rotation.

**Step 3: Write minimal implementation**

- Extend `runLiquidityBatch` to:
  1. check direct rebalance capability
  2. if available, keep current path
  3. else if fallback mode is `channel_rotation`, run `executeChannelRotation`
  4. persist progress to `liquidity_requests.metadata`
- Add counters to batch result:
  - `channelRotationStarted`
  - `channelRotationCompleted`
  - `channelRotationFailed`
- Keep withdrawals in `LIQUIDITY_PENDING` until hot wallet inventory actually reflects recovered funds.

**Step 4: Run tests to verify they pass**

Run:
```bash
bun run --cwd fiber-link-service/apps/worker test -- --run src/liquidity-batch.test.ts src/worker-runtime.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker/src/liquidity-batch.ts fiber-link-service/apps/worker/src/liquidity-batch.test.ts fiber-link-service/apps/worker/src/entry.ts fiber-link-service/apps/worker/src/worker-runtime.ts
git commit -m "feat(worker): integrate channel rotation fallback"
```

---

### Task 6: Add local regression coverage and evidence capture for channel rotation fallback

**Files:**
- Modify: `scripts/e2e-discourse-four-flows.sh`
- Modify: `scripts/e2e-discourse-four-flows.liquidity-double-withdrawal.sh`
- Modify: `scripts/lib/e2e-discourse-four-flows-common.sh`
- Modify: `scripts/test-e2e-discourse-four-flows-split.sh`
- Create: `scripts/e2e-channel-rotation-fallback-smoke.sh`

**Step 1: Write the failing tests**

Add shell regression checks that prove:

```bash
scripts/e2e-discourse-four-flows.sh --help | grep -q -- "--liquidity-fallback-mode"
scripts/e2e-channel-rotation-fallback-smoke.sh --help | grep -q "channel rotation"
```

Add smoke assertions that the artifact directory contains:

- `artifacts/withdrawal-primary.snapshot.json`
- `artifacts/liquidity-channel-rotation.json`
- `artifacts/withdrawal-primary.hot-wallet.before.json`
- `artifacts/withdrawal-primary.hot-wallet.after.json`

**Step 2: Run tests to verify they fail**

Run:
```bash
scripts/test-e2e-discourse-four-flows-split.sh
```

Expected: FAIL because the fallback CLI wiring and smoke script do not exist.

**Step 3: Write minimal implementation**

- Add `--liquidity-fallback-mode <none|channel_rotation>` to the split orchestrator.
- Create a dedicated smoke harness for channel rotation fallback.
- In local dual-node runs, let the smoke harness use the existing second FNN node to issue `accept_channel` so replacement-channel readiness is testable.
- Capture extra evidence:
  - replacement channel id
  - legacy channel id
  - close tx hash
  - hot wallet balance before/after

Representative smoke output:

```json
{
  "withdrawalId": "w1",
  "requestedState": "LIQUIDITY_PENDING",
  "recoveryStrategy": "CHANNEL_ROTATION",
  "legacyChannelId": "0xlegacy",
  "replacementChannelId": "0xreplacement",
  "finalState": "COMPLETED"
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
scripts/test-e2e-discourse-four-flows-split.sh
bash -n scripts/e2e-channel-rotation-fallback-smoke.sh scripts/e2e-discourse-four-flows.sh scripts/e2e-discourse-four-flows.liquidity-double-withdrawal.sh scripts/lib/e2e-discourse-four-flows-common.sh
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/e2e-discourse-four-flows.sh scripts/e2e-discourse-four-flows.liquidity-double-withdrawal.sh scripts/lib/e2e-discourse-four-flows-common.sh scripts/test-e2e-discourse-four-flows-split.sh scripts/e2e-channel-rotation-fallback-smoke.sh
git commit -m "test(e2e): add channel rotation fallback regression"
```

---

### Task 7: Validate end-to-end behavior and add operator-facing notes

**Files:**
- Modify: `docs/runbooks/e2e-discourse-four-flows.md`
- Modify: `docs/runbooks/testnet-bootstrap.md`
- Modify: `docs/plans/2026-03-07-channel-rotation-fallback-design.md`

**Step 1: Write the failing check**

Prepare a manual validation checklist that requires evidence for:

- withdrawal enters `LIQUIDITY_PENDING`
- fallback strategy chosen is `CHANNEL_ROTATION`
- replacement channel becomes `CHANNEL_READY`
- legacy channel close returns liquidity to hot wallet
- withdrawal later becomes `COMPLETED`

**Step 2: Run validation and collect evidence**

Run:
```bash
DISCOURSE_DEV_ROOT=/private/tmp/discourse-dev-fiber-link \
scripts/e2e-discourse-four-flows.sh \
  --artifact-dir /tmp/e2e-channel-rotation-$(date -u +%Y%m%dT%H%M%SZ) \
  --settlement-modes subscription \
  --double-withdrawal-regression \
  --liquidity-fallback-mode channel_rotation \
  --explorer-tx-url-template 'https://pudge.explorer.nervos.org/transaction/{txHash}' \
  --headless --verbose
```

Expected:

- primary withdrawal request state: `LIQUIDITY_PENDING`
- fallback metadata: `recoveryStrategy=CHANNEL_ROTATION`
- final withdrawal state: `COMPLETED`

**Step 3: Update runbooks**

- document the new fallback mode
- document the bootstrap reserve requirement
- document that channel rotation is fallback-only, not the primary payout path

**Step 4: Re-run lightweight verification**

Run:
```bash
git diff --check
```

Expected: clean.

**Step 5: Commit**

```bash
git add docs/runbooks/e2e-discourse-four-flows.md docs/runbooks/testnet-bootstrap.md docs/plans/2026-03-07-channel-rotation-fallback-design.md
git commit -m "docs: add channel rotation fallback operator guidance"
```
