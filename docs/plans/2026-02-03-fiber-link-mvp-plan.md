# Fiber Link MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MVP that enables Discourse tipping via CKB Fiber with a custodial hub, internal ledger, and batched UDT withdrawals, plus an Admin Web console.

**Architecture:** Split into two repos. `fiber-link-service` hosts a Fastify JSON-RPC API for the Discourse plugin, a Next.js Admin Web (tRPC), a Drizzle/Postgres data layer, a Fiber Adapter wrapper, and background workers for settlement/reconciliation/withdrawals. `fiber-link-discourse-plugin` delivers the UI, polling, and HMAC-authenticated RPC calls.

**Tech Stack:** Node.js 20, Fastify, JSON-RPC, Next.js, tRPC, Drizzle, BetterAuth, Postgres, Vitest, Supertest, TypeScript, CCC, Ruby (Discourse plugin), RSpec, Ember/QUnit for UI.

---

### Task 1: Service Repo Skeleton + JSON-RPC Harness

**Files:**
- Create: `fiber-link-service/package.json`
- Create: `fiber-link-service/pnpm-workspace.yaml`
- Create: `fiber-link-service/tsconfig.base.json`
- Create: `fiber-link-service/apps/rpc/package.json`
- Create: `fiber-link-service/apps/rpc/src/server.ts`
- Create: `fiber-link-service/apps/rpc/src/rpc.ts`
- Create: `fiber-link-service/apps/rpc/src/rpc.test.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/rpc/src/rpc.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildServer } from "./server";

describe("json-rpc", () => {
  it("health.ping returns ok", async () => {
    const app = buildServer();
    const res = await request(app.server)
      .post("/rpc")
      .send({ jsonrpc: "2.0", id: 1, method: "health.ping", params: {} });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ status: "ok" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: FAIL (module or handler missing)

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/rpc/src/server.ts
import Fastify from "fastify";
import { registerRpc } from "./rpc";

export function buildServer() {
  const app = Fastify({ logger: true });
  registerRpc(app);
  return app;
}
```

```ts
// fiber-link-service/apps/rpc/src/rpc.ts
import type { FastifyInstance } from "fastify";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

export function registerRpc(app: FastifyInstance) {
  app.post("/rpc", async (req, reply) => {
    const body = req.body as RpcRequest;

    if (body.method === "health.ping") {
      return reply.send({ jsonrpc: "2.0", id: body.id, result: { status: "ok" } });
    }

    return reply.status(404).send({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  });
}
```

```jsonc
// fiber-link-service/apps/rpc/package.json
{
  "name": "@fiber-link/rpc",
  "private": true,
  "scripts": {
    "test": "vitest"
  },
  "dependencies": {
    "fastify": "^4.27.0"
  },
  "devDependencies": {
    "supertest": "^6.4.2",
    "vitest": "^1.6.0",
    "typescript": "^5.6.0"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/package.json fiber-link-service/pnpm-workspace.yaml fiber-link-service/tsconfig.base.json fiber-link-service/apps/rpc
git commit -m "feat: scaffold json-rpc service"
```

---

### Task 2: Database Layer (Drizzle + Postgres) + Core Schema

**Files:**
- Create: `fiber-link-service/packages/db/package.json`
- Create: `fiber-link-service/packages/db/src/schema.ts`
- Create: `fiber-link-service/packages/db/src/index.ts`
- Create: `fiber-link-service/packages/db/src/schema.test.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/packages/db/src/schema.test.ts
import { describe, it, expect } from "vitest";
import { tipIntents, ledgerEntries } from "./schema";

describe("schema", () => {
  it("exports core tables", () => {
    expect(tipIntents).toBeDefined();
    expect(ledgerEntries).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/packages/db test`
Expected: FAIL (schema missing)

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/packages/db/src/schema.ts
import { pgTable, text, timestamp, uuid, numeric } from "drizzle-orm/pg-core";

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull().unique(),
  hmacSecret: text("hmac_secret").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tipIntents = pgTable("tip_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  postId: text("post_id").notNull(),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount").notNull(),
  invoice: text("invoice").notNull(),
  invoiceState: text("invoice_state").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount").notNull(),
  type: text("type").notNull(),
  refId: text("ref_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

```ts
// fiber-link-service/packages/db/src/index.ts
export * from "./schema";
```

```jsonc
// fiber-link-service/packages/db/package.json
{
  "name": "@fiber-link/db",
  "private": true,
  "scripts": { "test": "vitest" },
  "dependencies": {
    "drizzle-orm": "^0.32.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.6.0"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/packages/db test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/packages/db
git commit -m "feat: add drizzle schema"
```

---

### Task 3: HMAC Auth Middleware for JSON-RPC

**Files:**
- Create: `fiber-link-service/apps/rpc/src/auth/hmac.ts`
- Create: `fiber-link-service/apps/rpc/src/auth/hmac.test.ts`
- Modify: `fiber-link-service/apps/rpc/src/rpc.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/rpc/src/auth/hmac.test.ts
import { describe, it, expect } from "vitest";
import { verifyHmac } from "./hmac";

const secret = "test-secret";

it("verifies valid signature", () => {
  const payload = "{}";
  const ts = "1700000000";
  const nonce = "n1";
  const sig = verifyHmac.sign({ secret, payload, ts, nonce });
  expect(verifyHmac.check({ secret, payload, ts, nonce, signature: sig })).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/rpc/src/auth/hmac.ts
import crypto from "crypto";

type SignArgs = { secret: string; payload: string; ts: string; nonce: string };

type CheckArgs = SignArgs & { signature: string };

export const verifyHmac = {
  sign({ secret, payload, ts, nonce }: SignArgs) {
    const input = `${ts}.${nonce}.${payload}`;
    return crypto.createHmac("sha256", secret).update(input).digest("hex");
  },
  check({ secret, payload, ts, nonce, signature }: CheckArgs) {
    const expected = verifyHmac.sign({ secret, payload, ts, nonce });
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  },
};
```

```ts
// fiber-link-service/apps/rpc/src/rpc.ts (excerpt)
import { verifyHmac } from "./auth/hmac";

export function registerRpc(app: FastifyInstance) {
  app.post("/rpc", async (req, reply) => {
    const body = req.body as RpcRequest;
    const payload = JSON.stringify(body);
    const ts = String(req.headers["x-ts"] ?? "");
    const nonce = String(req.headers["x-nonce"] ?? "");
    const signature = String(req.headers["x-signature"] ?? "");

    // TODO: lookup secret by app_id
    const secret = "replace-with-lookup";

    if (!verifyHmac.check({ secret, payload, ts, nonce, signature })) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: 401, message: "Unauthorized" },
      });
    }

    // ... existing method handling
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/auth fiber-link-service/apps/rpc/src/rpc.ts
git commit -m "feat: add hmac auth"
```

---

### Task 4: Fiber Adapter Interface + Stub Implementation

**Files:**
- Create: `fiber-link-service/packages/fiber-adapter/package.json`
- Create: `fiber-link-service/packages/fiber-adapter/src/index.ts`
- Create: `fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/packages/fiber-adapter/src/fiber-adapter.test.ts
import { describe, it, expect } from "vitest";
import { createAdapter } from "./index";

describe("fiber adapter", () => {
  it("creates invoice", async () => {
    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const invoice = await adapter.createInvoice({ amount: "10", asset: "USDI" });
    expect(invoice.invoice).toContain("fiber");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/packages/fiber-adapter test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/packages/fiber-adapter/src/index.ts
export type CreateInvoiceArgs = { amount: string; asset: "CKB" | "USDI" };

export function createAdapter(_: { endpoint: string }) {
  return {
    async createInvoice({ amount, asset }: CreateInvoiceArgs) {
      return { invoice: `fiber:${asset}:${amount}:stub` };
    },
    async getInvoiceStatus(_: { invoice: string }) {
      return { state: "UNPAID" as const };
    },
    async subscribeSettlements(_: { onSettled: (invoice: string) => void }) {
      return { close: () => undefined };
    },
  };
}
```

```jsonc
// fiber-link-service/packages/fiber-adapter/package.json
{
  "name": "@fiber-link/fiber-adapter",
  "private": true,
  "scripts": { "test": "vitest" },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.6.0"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/packages/fiber-adapter test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/packages/fiber-adapter
git commit -m "feat: add fiber adapter stub"
```

---

### Task 5: Tip Create/Status JSON-RPC Methods

**Files:**
- Create: `fiber-link-service/apps/rpc/src/methods/tip.ts`
- Create: `fiber-link-service/apps/rpc/src/methods/tip.test.ts`
- Modify: `fiber-link-service/apps/rpc/src/rpc.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/rpc/src/methods/tip.test.ts
import { describe, it, expect } from "vitest";
import { handleTipCreate } from "./tip";

it("creates a tip intent with invoice", async () => {
  const res = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  });

  expect(res.invoice).toContain("fiber");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/rpc/src/methods/tip.ts
import { createAdapter } from "@fiber-link/fiber-adapter";

export async function handleTipCreate(input: {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
}) {
  const adapter = createAdapter({ endpoint: process.env.FIBER_RPC_URL ?? "" });
  const invoice = await adapter.createInvoice({ amount: input.amount, asset: input.asset });
  return { invoice: invoice.invoice };
}
```

```ts
// fiber-link-service/apps/rpc/src/rpc.ts (excerpt)
import { handleTipCreate } from "./methods/tip";

if (body.method === "tip.create") {
  const result = await handleTipCreate(body.params as any);
  return reply.send({ jsonrpc: "2.0", id: body.id, result });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods
git commit -m "feat: add tip.create"
```

---

### Task 6: Settlement Poller + Ledger Credit

**Files:**
- Create: `fiber-link-service/apps/worker/package.json`
- Create: `fiber-link-service/apps/worker/src/settlement.ts`
- Create: `fiber-link-service/apps/worker/src/settlement.test.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/worker/src/settlement.test.ts
import { describe, it, expect } from "vitest";
import { markSettled } from "./settlement";

it("marks invoice settled and credits ledger", async () => {
  const res = await markSettled({ invoice: "fiber:USDI:10:stub" });
  expect(res.credited).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/worker test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/worker/src/settlement.ts
export async function markSettled(_: { invoice: string }) {
  return { credited: true };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/worker test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/apps/worker
git commit -m "feat: add settlement worker stub"
```

---

### Task 7: Withdrawal Request + Batch Worker (CCC Stub)

**Files:**
- Create: `fiber-link-service/apps/rpc/src/methods/withdrawal.ts`
- Create: `fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts`
- Create: `fiber-link-service/apps/worker/src/withdrawal-batch.ts`
- Create: `fiber-link-service/apps/worker/src/withdrawal-batch.test.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/rpc/src/methods/withdrawal.test.ts
import { describe, it, expect } from "vitest";
import { requestWithdrawal } from "./withdrawal";

it("creates withdrawal request", async () => {
  const res = await requestWithdrawal({
    appId: "app1",
    userId: "u1",
    asset: "USDI",
    amount: "10",
    toAddress: "ckt1q...",
  });
  expect(res.state).toBe("PENDING");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/rpc/src/methods/withdrawal.ts
export async function requestWithdrawal(input: {
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  toAddress: string;
}) {
  return { id: "w1", state: "PENDING" as const };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/rpc test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/apps/rpc/src/methods/withdrawal.ts
git commit -m "feat: add withdrawal request stub"
```

---

### Task 8: Admin Web Skeleton (BetterAuth + tRPC)

**Files:**
- Create: `fiber-link-service/apps/admin/package.json`
- Create: `fiber-link-service/apps/admin/src/pages/index.tsx`
- Create: `fiber-link-service/apps/admin/src/server/api/trpc.ts`
- Create: `fiber-link-service/apps/admin/src/server/auth.ts`
- Create: `fiber-link-service/apps/admin/src/server/api/routers/app.ts`
- Create: `fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts`

**Step 1: Write the failing test**

```ts
// fiber-link-service/apps/admin/src/server/api/routers/app.test.ts
import { describe, it, expect } from "vitest";
import { appRouter } from "./app";

describe("app router", () => {
  it("exports router", () => {
    expect(appRouter).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C fiber-link-service/apps/admin test`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// fiber-link-service/apps/admin/src/server/api/routers/app.ts
import { initTRPC } from "@trpc/server";
const t = initTRPC.create();

export const appRouter = t.router({
  list: t.procedure.query(() => []),
});
```

```ts
// fiber-link-service/apps/admin/src/server/api/routers/withdrawal.ts
import { initTRPC } from "@trpc/server";
const t = initTRPC.create();

export const withdrawalRouter = t.router({
  list: t.procedure.query(() => []),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C fiber-link-service/apps/admin test`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-service/apps/admin/src/server/api/routers
git commit -m "feat: add admin tRPC routers"
```

---

### Task 9: Discourse Plugin Skeleton

**Files:**
- Create: `fiber-link-discourse-plugin/plugin.rb`
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/initializers/fiber-link.js`
- Create: `fiber-link-discourse-plugin/spec/requests/fiber_link_spec.rb`

**Step 1: Write the failing test**

```ruby
# fiber-link-discourse-plugin/spec/requests/fiber_link_spec.rb
require "rails_helper"

RSpec.describe "FiberLink", type: :request do
  it "adds settings" do
    expect(SiteSetting.respond_to?(:fiber_link_enabled)).to be(true)
  end
end
```

**Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/requests/fiber_link_spec.rb`
Expected: FAIL

**Step 3: Write minimal implementation**

```ruby
# fiber-link-discourse-plugin/plugin.rb
# name: fiber-link
# version: 0.1
# authors: Fiber Link

enabled_site_setting :fiber_link_enabled

register_asset "javascripts/discourse/initializers/fiber-link.js"
```

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/initializers/fiber-link.js
export default {
  name: "fiber-link",
  initialize() {}
};
```

**Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/requests/fiber_link_spec.rb`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin
git commit -m "feat: scaffold discourse plugin"
```

---

### Task 10: Tip UI + JSON-RPC Integration (Plugin)

**Files:**
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-button.js`
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js`
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js`
- Create: `fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb`

**Step 1: Write the failing test**

```ruby
# fiber-link-discourse-plugin/spec/system/fiber_link_tip_spec.rb
require "system_helper"

RSpec.describe "Fiber Link Tip", type: :system do
  it "shows tip modal" do
    visit "/t/1"
    click_button "Tip"
    expect(page).to have_content("Pay with Fiber")
  end
end
```

**Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/system/fiber_link_tip_spec.rb`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-button.js
import Component from "@glimmer/component";
import { action } from "@ember/object";

export default class FiberLinkTipButton extends Component {
  @action openTip() {
    this.args.openTipModal();
  }
}
```

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-modal.js
import Component from "@glimmer/component";

export default class FiberLinkTipModal extends Component {
  get title() {
    return "Pay with Fiber";
  }
}
```

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/services/fiber-link-api.js
export async function createTip({ amount, asset }) {
  return fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tip.create", params: { amount, asset } })
  }).then((r) => r.json());
}
```

**Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/system/fiber_link_tip_spec.rb`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin/assets/javascripts/discourse
git commit -m "feat: add tip modal"
```

---

### Task 11: Creator Dashboard + Withdrawals (Plugin)

**Files:**
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js`
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs`
- Create: `fiber-link-discourse-plugin/spec/system/fiber_link_dashboard_spec.rb`

**Step 1: Write the failing test**

```ruby
# fiber-link-discourse-plugin/spec/system/fiber_link_dashboard_spec.rb
require "system_helper"

RSpec.describe "Fiber Link Dashboard", type: :system do
  it "shows balance" do
    visit "/fiber-link"
    expect(page).to have_content("Balance")
  end
end
```

**Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/system/fiber_link_dashboard_spec.rb`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js
import Route from "@ember/routing/route";

export default class FiberLinkDashboardRoute extends Route {
  model() {
    return { balance: "0" };
  }
}
```

```hbs
{{!-- fiber-link-discourse-plugin/assets/javascripts/discourse/templates/fiber-link-dashboard.hbs --}}
<h2>Balance</h2>
<p>{{this.model.balance}}</p>
```

**Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/system/fiber_link_dashboard_spec.rb`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin/assets/javascripts/discourse/routes fiber-link-discourse-plugin/assets/javascripts/discourse/templates
git commit -m "feat: add creator dashboard"
```

---

### Task 12: Public Tip Display + Notification

**Files:**
- Create: `fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-feed.js`
- Create: `fiber-link-discourse-plugin/spec/system/fiber_link_feed_spec.rb`

**Step 1: Write the failing test**

```ruby
# fiber-link-discourse-plugin/spec/system/fiber_link_feed_spec.rb
require "system_helper"

RSpec.describe "Fiber Link Tip Feed", type: :system do
  it "shows tip list" do
    visit "/t/1"
    expect(page).to have_content("Tips")
  end
end
```

**Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/system/fiber_link_feed_spec.rb`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// fiber-link-discourse-plugin/assets/javascripts/discourse/components/fiber-link-tip-feed.js
import Component from "@glimmer/component";

export default class FiberLinkTipFeed extends Component {
  get tips() {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/system/fiber_link_feed_spec.rb`
Expected: PASS

**Step 5: Commit**

```bash
git add fiber-link-discourse-plugin/assets/javascripts/discourse/components
git commit -m "feat: add tip feed"
```

---

## Execution Handoff
Plan complete and saved to `docs/plans/2026-02-03-fiber-link-mvp-plan.md`.

Two execution options:
1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task and review between tasks.
2. **Parallel Session (separate)** — open a new session and use `superpowers:executing-plans` to implement in a clean worktree.

Which approach?
