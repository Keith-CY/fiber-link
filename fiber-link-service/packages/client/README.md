# @fiber-link/client

Platform-agnostic JavaScript/TypeScript SDK for the [Fiber Link](https://fiberlink.me) tipping infrastructure.

## Installation

```bash
npm install @fiber-link/client
# or
bun add @fiber-link/client
```

## Quick start

### Presigned mode (Discourse / server-side proxy)

The Discourse plugin's Ruby proxy handles HMAC signing. Use `presigned` mode in browser code — no secret in the client.

```ts
import { FiberLinkClient } from "@fiber-link/client";

const client = new FiberLinkClient({
  endpoint: "/fiber-link/rpc",  // Discourse-proxied URL
  mode: "presigned",
});

// Create a tip invoice
const { invoice } = await client.createTip({
  postId: "42",
  fromUserId: "1",
  toUserId: "2",
  amount: "5",
  asset: "CKB",
  message: "Great post!",
});

// Check status
const { state } = await client.getTipStatus(invoice);

// Real-time status via SSE (falls back to polling if unavailable)
const handle = client.streamTipStatus(invoice, (event) => {
  if (event.status === "SETTLED") {
    console.log("Tip settled!");
    handle?.close();
  }
});
```

### Signed mode (direct integration, no proxy)

For non-Discourse platforms where the client holds credentials (e.g., server-side scripts or trusted environments).

```ts
const client = new FiberLinkClient({
  endpoint: "https://your-fiber-link.example.com/rpc",
  mode: "signed",
  appId: process.env.FIBER_LINK_APP_ID,
  hmacSecret: process.env.FIBER_LINK_HMAC_SECRET,
});
```

## API reference

### `new FiberLinkClient(options)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `endpoint` | `string` | ✓ | Base URL of the RPC endpoint |
| `mode` | `"signed" \| "presigned"` | ✓ | Auth mode |
| `appId` | `string` | signed only | Application ID |
| `hmacSecret` | `string` | signed only | HMAC secret |
| `timeoutMs` | `number` | — | Request timeout (default 15000 ms) |

### `client.createTip(params)`

Creates a Fiber payment invoice for tipping a post.

**Params:** `{ postId, fromUserId, toUserId, amount, asset?, message? }`  
**Returns:** `Promise<{ invoice: string; invoiceQrDataUrl?: string }>`

### `client.getTipStatus(invoice)`

Polls the settlement state of an invoice.

**Returns:** `Promise<{ state: "UNPAID" | "SETTLED" | "FAILED" }>`

### `client.streamTipStatus(invoice, onEvent)`

Opens a Server-Sent Events stream for real-time settlement. Falls back gracefully when `EventSource` is unavailable.

The server only streams invoices that belong to the requesting app. In `signed` mode the configured `appId` is appended as a query param (`EventSource` cannot set headers); in `presigned` mode the server-side proxy supplies the `x-app-id` header.

**Returns:** `StreamHandle | null`  
**`onEvent` receives:** `{ invoice, status: "LISTENING" | "SETTLED" | "TIMEOUT" | "SSE_ERROR", settledAt? }` — `settledAt` is an ISO timestamp present on `SETTLED` events published by the settlement worker.

## Error types

| Class | When thrown |
|-------|-------------|
| `FiberLinkValidationError` | Invalid input (missing field, bad amount) |
| `FiberLinkResponseError` | RPC error from the server (`{ error: { code, message } }`) |
| `FiberLinkNetworkError` | Network failure or timeout |

## Platform integration

See `examples/vanilla-js/` in the repository for a self-contained HTML + JS example that runs against a local `docker-compose up` stack.

For the Discourse integration pattern, see `fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js` — it implements the same interface in presigned mode using Ember's `ajax` helper.
