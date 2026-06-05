# Real-time Settlement via SSE

This runbook closes the real-time settlement milestone tracked in [Issue #414](https://github.com/Keith-CY/fiber-link/issues/414). The implementation replaces the normal happy-path browser polling loop with push-based settlement notifications while keeping polling as a compatibility fallback.

## Runtime flow

1. The Discourse tip modal creates an invoice through the forum RPC proxy.
2. Once an invoice exists, the modal calls `streamTipStatus(invoice, onEvent)` and opens an `EventSource` against `/fiber-link/rpc/stream?invoice=<id>`.
3. The Discourse plugin proxies that stream to the backend RPC service endpoint `/rpc/stream?invoice=<id>`.
4. The backend RPC stream route validates that the invoice exists, subscribes to the Redis channel `fiber-link:settlement:<invoice>`, and emits `LISTENING` once the SSE subscription is ready.
5. When the worker settles the tip intent and credits the recipient ledger, it publishes `{ invoice, status: "SETTLED" }` to the same Redis channel.
6. The browser receives the `SETTLED` event, closes the SSE handle, cancels pending status-poll timers, and moves the modal to the confirmation state.

## Fallback behavior

Polling is still intentionally available, but only as a fallback path:

- If the browser does not support `EventSource`, the modal starts the existing status polling loop.
- If the SSE connection times out or emits an error, the modal closes the stream and falls back to polling.
- If the invoice is already settled when `/rpc/stream` is opened, the RPC service immediately returns a one-shot `SETTLED` SSE response.
- Worker-side Redis publish failures are non-blocking: settlement and ledger crediting still succeed, and clients can recover through fallback polling.

## Success-criteria mapping

- **Tip confirmation appears within 1s of settlement:** the worker publishes the Redis settlement event immediately after `ledger.creditOnce()` succeeds; the RPC SSE route forwards that event to the open browser stream without waiting for the old polling interval.
- **No polling requests after SSE connection is established:** the modal only schedules auto-polling when `_tryOpenSse()` returns no handle, or after `TIMEOUT` / `SSE_ERROR`; receiving `SETTLED` clears any poll timer.
- **Fallback polling still works when SSE is unavailable:** `streamTipStatus()` returns `null` when `EventSource` is absent, and the modal then schedules the existing bounded polling loop.
- **Existing settlement tests pass:** worker and RPC regression tests cover the settlement publisher, stream route states, and polling-compatible status behavior.

## Code reference map

- Worker settlement publisher:
  - `fiber-link-service/apps/worker/src/settlement.ts`
  - `fiber-link-service/apps/worker/src/settlement-publisher.ts`
- RPC SSE endpoint:
  - `fiber-link-service/apps/rpc/src/rpc.ts`
  - `fiber-link-service/apps/rpc/src/stream.ts`
- Discourse plugin stream proxy and modal integration:
  - `fiber-link-discourse-plugin/app/controllers/fiber_link/rpc_controller.rb`
  - `fiber-link-discourse-plugin/plugin.rb`
  - `fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js`
  - `fiber-link-discourse-plugin/assets/javascripts/discourse/components/modal/fiber-link-tip-modal.gjs`
- Client SDK helper:
  - `fiber-link-service/packages/client/src/client.ts`

## Evidence artifacts

The visual-acceptance flow records real-time settlement proof in `playwright-flow12-result.log` under the returned `realtimeEvidence` object:

- `streamRequests`: browser requests to `/fiber-link/rpc/stream?invoice=<id>`.
- `sseStatuses`: parsed SSE statuses; expected to include `LISTENING` and `SETTLED` on the happy path.
- `tipStatusRequestsAfterStreamBeforeConfirmed`: expected to be empty for the SSE happy path.
- `settlement.confirmationLatencyMs`: time from payer `send_payment` completion to confirmed modal state; expected to be below 1000ms for Issue #414 acceptance.

The hosted visual-acceptance job also runs a second browser proof at `flow12-fallback/playwright-flow12-result.log` with `EventSource` disabled. That fallback artifact must show:

- `realtimeEvidence.mode == "eventsource-disabled"`.
- No SSE handle or `/fiber-link/rpc/stream` request was opened.
- `tipStatusRequestsBeforeConfirmed` is non-empty, proving the modal used polling.
- The payer-settled invoice still reaches the confirmed modal state and `tip.status` returns `SETTLED`.

The same run still captures the confirmed modal screenshot at `playwright-flow1-tip-modal-step3-confirmed.png`.

## Verification commands

Run the focused service tests from the repository root:

```bash
cd fiber-link-service
bunx vitest run apps/worker/src/settlement.test.ts apps/rpc/src/stream.test.ts packages/client/src/client.test.ts
```

For the Discourse plugin path, return to the repository root and run the plugin smoke test when a Discourse dev container is available:

```bash
cd ..
./scripts/plugin-smoke.sh
```

Manual browser check:

1. Open a Discourse topic as a payer.
2. Generate a Fiber Link tip invoice.
3. Confirm the browser opens `/fiber-link/rpc/stream?invoice=<id>` and receives `LISTENING`.
4. Settle the invoice.
5. Confirm the modal flips to `Payment complete` without repeated `tip.status` requests.
6. Disable `EventSource` or break the stream route and confirm the bounded polling fallback still confirms settlement.
