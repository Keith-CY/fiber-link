# Sandbox Simulation Mode

This runbook describes the deterministic simulation adapter introduced for issue #219.

## Goal

Use a local, deterministic adapter for invoice lifecycle and withdrawal execution without depending on a live Fiber RPC node.

## Adapter mode switch

The adapter provider supports two modes:

- `rpc` (default): live JSON-RPC calls to `FIBER_RPC_URL`
- `simulation`: deterministic in-memory behavior for invoice status and withdrawals

Set mode with:

```bash
export FIBER_ADAPTER_MODE=simulation
```

If `FIBER_ADAPTER_MODE` is unset, provider mode is `rpc`.

## Simulation configuration

Supported environment variables:

- `FIBER_ADAPTER_MODE`: `rpc` or `simulation`
- `FIBER_SIMULATION_SCENARIO`: one of:
  - `settle-after-1-poll` (default)
  - `settled-immediately`
  - `always-unpaid`
  - `always-failed`
  - `withdrawal-failed`
- `FIBER_SIMULATION_SEED`: deterministic seed for generated invoice IDs and tx hashes

Example:

```bash
export FIBER_ADAPTER_MODE=simulation
export FIBER_SIMULATION_SCENARIO=settle-after-1-poll
export FIBER_SIMULATION_SEED=local-sandbox
```

## Production guardrails

Simulation mode is blocked when the process appears production-like:

- `NODE_ENV=production` or `prod`
- `APP_ENV=production` or `prod`
- `ENVIRONMENT=production` or `prod`

To intentionally override (for controlled testing only):

```bash
export FIBER_SIMULATION_ALLOW_IN_PRODUCTION=true
```

Without that override, provider initialization fails fast in production-like environments.

## RPC service usage

`apps/rpc/src/methods/tip.ts` now resolves its default adapter through the provider.

Simulation-only local example:

```bash
export FIBER_ADAPTER_MODE=simulation
export FIBER_SIMULATION_SCENARIO=settle-after-1-poll
export FIBER_SIMULATION_SEED=rpc-local
```

In this mode, `tip.create` and `tip.status` no longer depend on live Fiber JSON-RPC.

## Worker usage

`apps/worker/src/entry.ts` now resolves one provider adapter and shares it across:

- settlement polling/subscription paths
- withdrawal execution path

Current worker config still requires `FIBER_RPC_URL` at parse time. In simulation mode, set a placeholder value:

```bash
export FIBER_RPC_URL=http://simulation.invalid
export FIBER_ADAPTER_MODE=simulation
export FIBER_SIMULATION_SCENARIO=settle-after-1-poll
export FIBER_SIMULATION_SEED=worker-local
```

The placeholder URL is not used when provider mode is `simulation`.
