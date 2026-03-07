# Fiber-to-CKB Chain Liquidity Rebalance Design

Date: 2026-03-07  
Owner: Fiber Link  
Design status: Draft (Approved)

## Goal

Accept creator withdrawal requests even when the platform hot wallet is temporarily underfunded, then automatically rebalance liquidity from Fiber custody back onto the CKB chain and continue payout execution. This design must cover both supported assets:

- `CKB` payout to a creator `CKB_ADDRESS`
- `USDI` payout as an xUDT transfer to a creator `CKB_ADDRESS`

The creator should receive assets on the CKB chain, not a Fiber invoice or an internal bookkeeping acknowledgement.

## Problem Statement

The current implementation only checks the creator's internal ledger balance at request time and then tries to execute a chain payout from the platform withdrawal wallet:

- creator balance gating happens in the withdrawal repo
- actual payout is signed and broadcast by the platform withdrawal key

That means the system can accept a creator withdrawal because the creator has enough custodial balance, while the platform hot wallet still lacks enough on-chain liquidity to satisfy the request. There is currently no automatic mechanism to move assets from Fiber custody back to the chain wallet before payout execution.

## Asset Semantics

### CKB withdrawals

- Source of truth for creator entitlement: internal ledger credit/debit entries
- Final recipient asset: native `CKB`
- Final recipient destination: creator `CKB_ADDRESS`

### USDI withdrawals

- Source of truth for creator entitlement: internal ledger credit/debit entries
- Final recipient asset: `USDI` xUDT on the CKB chain
- Final recipient destination: creator `CKB_ADDRESS`

USDI withdrawals do **not** mean swapping USDI into CKB. They mean transferring the USDI token onto a cell locked by the creator's CKB address. The platform must therefore manage:

- on-chain USDI token inventory
- on-chain CKB capacity and fee inventory required to build and send xUDT transactions

## Core Decisions

- Add a new withdrawal state: `LIQUIDITY_PENDING`
- Continue accepting creator withdrawal requests even when hot wallet inventory is insufficient
- Keep creator ledger debits coupled to `COMPLETED` only
- Introduce a dedicated `liquidity worker` separate from the existing `withdrawal worker`
- Introduce a durable `liquidity_requests` table so multiple withdrawals can wait on the same rebalance operation
- Model rebalancing as `FIBER_TO_CKB_CHAIN`, not `FIBER_TO_CKB`, because both `CKB` and `USDI` land on the CKB chain

## Withdrawal State Machine

The withdrawal state enum becomes:

- `LIQUIDITY_PENDING`
- `PENDING`
- `PROCESSING`
- `RETRY_PENDING`
- `COMPLETED`
- `FAILED`

### State meanings

- `LIQUIDITY_PENDING`: the creator has enough internal balance, but the platform hot wallet does not currently have enough chain-side liquidity to execute the payout
- `PENDING`: the withdrawal is fully funded from the platform point of view and is eligible for execution
- `PROCESSING`: a worker has claimed the row and is actively building/broadcasting the payout
- `RETRY_PENDING`: the payout attempt failed with a retryable error
- `COMPLETED`: payout transaction succeeded and the ledger debit has been recorded
- `FAILED`: permanent failure or retry exhaustion

### Invariant

Creator ledger debits are written only after successful payout completion. A withdrawal in `LIQUIDITY_PENDING`, `PENDING`, `PROCESSING`, or `RETRY_PENDING` must not reduce the creator's ledger balance. This preserves the current successful-completion debit invariant.

## Data Model

### `withdrawals`

Add:

- enum value `LIQUIDITY_PENDING`
- `liquidity_request_id` nullable foreign key
- `liquidity_pending_reason` nullable text
- `liquidity_checked_at` nullable timestamp

### `liquidity_requests`

Create a new table:

- `id`
- `app_id`
- `asset`
- `network`
- `state`: `REQUESTED | REBALANCING | FUNDED | FAILED`
- `source_kind`: `FIBER_TO_CKB_CHAIN`
- `required_amount`
- `funded_amount`
- `metadata` jsonb
- `last_error`
- `created_at`
- `updated_at`
- `completed_at`

The table tracks platform-side rebalance work, not creator-facing payout work.

## Execution Flow

### 1. Creator submits `withdrawal.request`

1. Validate creator entitlement using the existing ledger balance check path.
2. Determine the required hot wallet inventory for the requested asset.
3. If inventory is already sufficient:
   - create withdrawal as `PENDING`
4. If inventory is insufficient:
   - create withdrawal as `LIQUIDITY_PENDING`
   - attach or create a `liquidity_request`
5. Return the new withdrawal id and current state to the caller.

### 2. Liquidity worker

1. Scan open `liquidity_requests` and `LIQUIDITY_PENDING` withdrawals.
2. Aggregate required funding per `(app, asset, network)`.
3. Check current chain-side hot wallet inventory.
4. If still underfunded:
   - initiate or continue `FIBER_TO_CKB_CHAIN` rebalance
5. Once funding is observed on chain:
   - mark liquidity request `FUNDED`
   - move covered withdrawals from `LIQUIDITY_PENDING` to `PENDING`

### 3. Withdrawal worker

This worker remains responsible only for actual creator payout:

- consumes `PENDING` and `RETRY_PENDING`
- performs `CKB` native transfer or `USDI` xUDT transfer
- on success:
  - marks withdrawal `COMPLETED`
  - writes creator ledger debit

## Hot Wallet Inventory Model

### CKB

Availability is not just the address balance. It must account for:

- spendable UTXOs
- fee reserve
- any locally reserved amount for in-flight payouts

### USDI

Availability is two-dimensional:

- token amount available in xUDT cells
- enough native `CKB` to carry cell capacity and pay fees

A USDI payout can only move forward when both constraints are satisfied.

## Adapter / Provider Boundaries

Two provider-level capabilities are required:

### `HotWalletInventoryProvider`

- `getAvailableLiquidity({ asset, network })`
- returns:
  - for `CKB`: spendable CKB
  - for `USDI`: spendable USDI plus required CKB support capacity

### `LiquidityProvider`

- `ensureLiquidity({ asset, network, requiredAmount })`
- semantics:
  - if already funded, return `satisfied`
  - if rebalance started, return `pending`
  - if rebalance impossible, return `failed`

The first concrete provider is `FIBER_TO_CKB_CHAIN`.

## Payout Executors

### CKB executor

Reuse the existing native CKB transfer path.

### USDI executor

Add a new xUDT transfer executor that:

- resolves the USDI type script configuration
- collects token cells from the platform hot wallet
- ensures enough native CKB capacity and fees
- builds and signs a token transfer transaction to the creator `CKB_ADDRESS`

## UI / Admin Expectations

The creator dashboard and admin dashboard must both surface `LIQUIDITY_PENDING` distinctly from transient retry failures.

Recommended creator copy:

- `Withdrawal accepted. Waiting for platform liquidity rebalance before payout.`

Recommended admin signals:

- count of `LIQUIDITY_PENDING`
- open `liquidity_requests`
- asset-level hot wallet coverage
- last rebalance error / evidence

## Failure Handling

- Rebalance failure does not reject already-accepted creator requests.
- Failed rebalance should keep withdrawals in `LIQUIDITY_PENDING` until either:
  - a later rebalance succeeds
  - an operator explicitly fails the withdrawal
- Withdrawal execution failures after liquidity becomes available continue using the existing `RETRY_PENDING` / `FAILED` semantics.

## Testing Strategy

- unit tests for inventory calculation and liquidity state transitions
- repo tests for `LIQUIDITY_PENDING` creation and liquidity request linkage
- RPC tests for `withdrawal.request` returning `LIQUIDITY_PENDING`
- worker tests for:
  - rebalance completion promoting withdrawals to `PENDING`
  - `CKB` payout completion writing debit
  - `USDI` payout completion writing debit
- admin/dashboard tests for the new state
- end-to-end flows for:
  - `CKB` withdrawal with immediate funding
  - `CKB` withdrawal with delayed rebalance
  - `USDI` withdrawal with delayed rebalance

## Risks

- The exact Fiber RPC primitives needed for `FIBER_TO_CKB_CHAIN` must exist or be implemented in the adapter layer.
- USDI payout correctness depends on finalized xUDT script configuration and capacity calculation.
- Inventory must avoid double-spending the same hot wallet liquidity when multiple workers race. Local reservation or serialized claiming is required.
