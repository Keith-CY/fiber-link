# Channel Rotation Fallback Design

Date: 2026-03-07  
Owner: Fiber Link  
Design status: Draft

## Goal

Define a fallback liquidity recovery path for creator withdrawals when direct `FIBER_TO_CKB_CHAIN` rebalance is unavailable or unsupported by the running FNN version.

This fallback must:

- keep accepted creator withdrawals in `LIQUIDITY_PENDING`
- preserve platform routing/payment continuity when possible
- recover chain-side liquidity by rotating channel inventory back onto the CKB chain

This is a fallback strategy, not the primary withdrawal execution rail.

## Problem

The current local FNN runtime supports:

- `connect_peer`
- `open_channel`
- `accept_channel`
- `list_channels`
- `shutdown_channel`

But the running FNN version does not expose a usable `rebalance_to_ckb_chain` / `get_rebalance_status` flow for automatic liquidity recovery. That means the system can correctly place withdrawals into `LIQUIDITY_PENDING`, but it cannot yet automatically move custody-side liquidity back onto the chain hot wallet through the planned rebalance RPC.

## Key Decision

Introduce a **channel rotation fallback**:

1. open a replacement channel
2. wait until the replacement channel is `CHANNEL_READY`
3. cooperatively close an older channel
4. receive the closing output back to the platform hot wallet address
5. resume payouts once the chain-side hot wallet has enough confirmed liquidity

This fallback is only used when direct rebalance is unavailable or explicitly disabled.

## Important Semantics

### What funds come back

Closing a channel does **not** recover the entire channel capacity.

It only recovers the platform side's:

- `local_balance`
- minus closing fee and any final settlement adjustments

It does **not** recover:

- the counterparty `remote_balance`
- the full nominal channel capacity

### Why open a replacement channel first

Closing an existing channel to recover funds can reduce routing and payment capacity. If the platform still needs the peer relationship for invoice/payment traffic, the replacement channel should be established first so the old channel can be retired without a hard service drop.

## Scope

This fallback applies to:

- `CKB` creator withdrawals to `CKB_ADDRESS`
- `USDI` creator withdrawals to `CKB_ADDRESS`

But the recovered on-chain liquidity semantics differ:

- closing a `CKB`-funded channel returns native `CKB`
- closing a `USDI`-funded channel returns xUDT plus required CKB capacity

The fallback therefore needs asset-aware inventory checks.

## Preconditions

Channel rotation is only feasible when all of the following are true:

1. There is at least one candidate channel whose `local_balance` is large enough to materially help.
2. The platform has enough chain-side bootstrap reserve to open a replacement channel first.
3. The peer can accept and bring the replacement channel to `CHANNEL_READY`.
4. The old channel can be closed to a script/address controlled by the platform hot wallet.

If these preconditions are not met, channel rotation must not run.

## New Inventory Concept

Add a dedicated reserve:

- `channel_rotation_bootstrap_reserve`

This reserve is distinct from payout liquidity. It exists solely so the platform can open replacement channels before closing old ones.

Without this reserve, the proposed flow fails at step 1 whenever the hot wallet is already at or near zero.

## Triggering Rules

The liquidity worker chooses its strategy in this order:

1. If direct `FIBER_TO_CKB_CHAIN` rebalance is supported and healthy:
   - use direct rebalance
2. Else if channel rotation fallback is enabled:
   - evaluate channel rotation candidates
3. Else:
   - keep withdrawals in `LIQUIDITY_PENDING`
   - surface explicit operator action required

Suggested config:

- `FIBER_LIQUIDITY_FALLBACK_MODE=none|channel_rotation`
- `FIBER_CHANNEL_ROTATION_BOOTSTRAP_RESERVE`
- `FIBER_CHANNEL_ROTATION_MIN_RECOVERABLE_AMOUNT`
- `FIBER_CHANNEL_ROTATION_MAX_CONCURRENT`

## Candidate Selection

The worker should scan platform-owned channels and rank candidates by:

1. matching asset and network
2. `local_balance` descending
3. age descending
4. low recent traffic preference

A candidate is eligible only if:

- channel state is `CHANNEL_READY`
- no pending TLCs remain
- `local_balance` is above:
  - requested payout shortfall
  - closing fee buffer
  - minimum recoverable threshold

## Execution Flow

### Stage 1: Evaluate need

For a liquidity request:

1. compute target hot wallet inventory
2. check current chain-side hot wallet inventory
3. if underfunded and direct rebalance is unavailable:
   - enter channel rotation evaluation

### Stage 2: Open replacement channel

1. select peer and target asset
2. use platform bootstrap reserve to open replacement channel
3. wait for `CHANNEL_READY`
4. record replacement channel id in liquidity request metadata

If replacement channel never becomes ready, stop and keep the linked withdrawals in `LIQUIDITY_PENDING`.

### Stage 3: Close legacy channel

1. select the legacy channel chosen for recovery
2. call `shutdown_channel`
3. set `close_script` to the platform hot wallet script
4. monitor close progression until the resulting chain output is spendable by the hot wallet

The close must be cooperative by default. Force-close should be a last resort because it is slower and has more operational risk.

### Stage 4: Promote withdrawals

Once the hot wallet sees enough confirmed liquidity:

1. mark the liquidity request funded
2. move covered withdrawals from `LIQUIDITY_PENDING` to `PENDING`
3. let the existing withdrawal worker execute payouts

## Metadata Model

Extend `liquidity_requests.metadata` with:

- `recoveryStrategy`: `DIRECT_REBALANCE` or `CHANNEL_ROTATION`
- `replacementChannelId`
- `legacyChannelId`
- `legacyChannelLocalBalance`
- `channelCloseTxHash`
- `expectedRecoveredAmount`
- `recoveredAmount`
- `closeScriptAddress`
- `lastRotationError`

This keeps fallback behavior auditable without changing the creator-facing withdrawal schema again.

## Failure Handling

### Replacement open fails

- keep liquidity request open
- do not attempt legacy close
- keep linked withdrawals in `LIQUIDITY_PENDING`

### Replacement ready but legacy close fails

- keep replacement channel alive
- record error in liquidity request metadata
- require later retry or operator action

### Close succeeds but recovered amount is insufficient

- keep liquidity request open
- optionally rotate another channel
- only promote withdrawals when confirmed hot wallet liquidity actually covers the target

### Force close path

Force close should be behind an operator or policy gate because:

- settlement time is longer
- capital is locked longer
- user-facing payout latency becomes less predictable

## Why This Is Fallback Only

Channel rotation is operationally heavier than direct rebalance:

- it depends on channel state and peer readiness
- it consumes bootstrap reserve
- it changes network topology
- it introduces close latency before funds are reusable

So the correct priority is:

1. direct `FIBER_TO_CKB_CHAIN` rebalance
2. channel rotation fallback
3. manual operator intervention

## Implementation Notes

The repository already has script-level examples for:

- `connect_peer`
- `open_channel`
- `accept_channel`
- `list_channels`
- waiting for `CHANNEL_READY`

Reference:

- [e2e-invoice-payment-accounting.sh](/Users/ChenYu/Documents/Github/fiber-link/scripts/e2e-invoice-payment-accounting.sh)

The repository does **not** yet have an automated `shutdown_channel` orchestration path. That would need to be added as part of this fallback.

## Testing Strategy

### Unit

- selects a legacy channel only when `local_balance` is sufficient
- rejects rotation when bootstrap reserve is below threshold
- does not promote withdrawals until recovered liquidity is visible in the hot wallet

### Integration

- replacement channel reaches `CHANNEL_READY`
- legacy channel closes to platform hot wallet script
- recovered amount lands back in chain-side inventory

### E2E

1. empty payout hot wallet
2. create withdrawal -> `LIQUIDITY_PENDING`
3. open replacement channel
4. close legacy channel
5. observe recovered liquidity on chain
6. observe withdrawal transition to `COMPLETED`

## Open Constraints

This design still depends on one unresolved external reality:

- the running FNN version must support the exact RPC set needed for safe channel lifecycle automation in the chosen deployment mode

If the deployed FNN cannot stably support that automation, the fallback should remain disabled and operator-driven.
