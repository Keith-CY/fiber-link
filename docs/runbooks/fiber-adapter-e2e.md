# Fiber Adapter Docker E2E

This runbook verifies the docker-network integration path:

`@fiber-link/fiber-adapter` -> `fnn` JSON-RPC (`http://fnn:8227`) from inside compose services.

## Command

```bash
scripts/e2e-fiber-adapter-docker.sh
```

## What it checks

1. Starts compose services needed for adapter integration: `postgres`, `redis`, `fnn`, `rpc`.
2. Waits for healthy status.
3. Executes `/app/apps/rpc/src/scripts/fiber-adapter-e2e.ts` in the `rpc` container.
4. Confirms:
   - invoice creation succeeds
   - invoice status can be read back as `UNPAID`
   - withdrawal call reaches FNN RPC (single-node route failure is acceptable and reported as `withdrawalProbe`)

## Expected result

The script exits `0` and prints:

- `ok: true`
- `endpoint: "http://fnn:8227"`
- non-empty `invoice`
- `status: "UNPAID"`
- non-empty `withdrawalProbe`
