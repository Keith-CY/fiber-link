# Getting Started with Fiber Link

This guide gives first-time readers the shortest path through Fiber Link without requiring them to understand every internal component first.

---

## Choose Your Path

| If you are... | Start here |
|---|---|
| **Evaluating the product** | Read the product overview below, then review the live/demo evidence in the acceptance docs. |
| **A Discourse administrator** | Install and configure the plugin, then connect it to a Fiber Link service. |
| **A service operator** | Deploy the backend stack, configure limits and monitoring, then run smoke tests. |
| **A developer** | Bootstrap the service workspace, run tests, and use the runbook for the behavior you are changing. |

---

## Product Loop in Plain English

Fiber Link has four user-visible steps:

1. **Tip** — a reader clicks Tip on a Discourse post or reply.
2. **Pay** — the forum shows a Fiber payment request for the tip amount.
3. **Receive** — the post author sees the settled tip in the creator dashboard.
4. **Withdraw** — the creator requests a payout and tracks the withdrawal status.

Behind the scenes, the service handles invoices, settlement discovery, ledger crediting, withdrawal policy checks, and transaction evidence.

---

## What You Need

### For a Product Review

- A browser.
- Access to the demo instance or recorded demo evidence.
- The milestone acceptance docs:
  - [Milestone Acceptance Tracker](acceptance/README.md)
  - [Milestone 3 Acceptance Index](acceptance/milestone-3/index.md)
  - [Milestone 3 Evidence Index](runbooks/acceptance-evidence/milestone-3/index.md)

### For a Discourse Install

- A Discourse instance where you can install a plugin.
- A running Fiber Link backend service.
- An app ID and app secret configured for the plugin.
- Operator access to verify logs, settings, and smoke tests.

Start with:

- [Discourse Plugin Admin](runbooks/discourse-plugin-admin.md)
- [Admin Installation Guide](admin-installation.md)

### For a Backend Deployment

- Docker and Docker Compose compatible runtime.
- Postgres and Redis through the compose stack.
- CKB Fiber node configuration.
- Secrets for app HMAC signing, database access, and withdrawal/liquidity signing where applicable.
- Monitoring, backup, and rollback expectations.

Start with:

- [Fiber Link Stack Deployment](runbooks/fiber-link-stack-deployment.md)
- [Compose Reference](runbooks/compose-reference.md)
- [Mainnet Deployment Checklist](runbooks/mainnet-deployment-checklist.md)

---

## Step 1 — Read the Current Product Boundary

Before running commands, read:

- [Current Status](current-status.md)
- [Security Assumptions](runbooks/security-assumptions.md)
- [Risks and Open Questions](03-risks-open-questions.md)

This matters because Fiber Link deliberately uses a hosted hub and internal ledger in the MVP. The user experience is simple, but the operator responsibility is real.

---

## Step 2 — Verify the Demo or Local Stack

For a demo review, use the acceptance evidence and recorded walkthroughs.

For a local/operator verification flow, the common checks are:

```bash
# From the repository root: Discourse plugin smoke
scripts/plugin-smoke.sh

# From the service workspace: package-level tests
cd fiber-link-service
bun run --filter @fiber-link/db test --run
bun run --filter @fiber-link/admin test --run
bun run --filter @fiber-link/rpc test --run
bun run --filter @fiber-link/worker test --run
```

For a complete browser-based flow, use the runbook that matches the scenario:

- [Local Playwright Workflow Demo](runbooks/local-playwright-workflow-demo.md)
- [Discourse Four Flows Demo Repro](runbooks/discourse-four-flows-demo-repro.md)
- [End-to-End Invoice Payment Accounting](runbooks/e2e-invoice-payment-accounting.md)

---

## Step 3 — Understand the Main Screens

### Discourse Tip Flow

The forum plugin adds a Tip action to supported posts and replies. The modal creates a Fiber invoice and shows the payer what to pay.

### Creator Dashboard

The creator dashboard is available at `/fiber-link` inside the Discourse site. It is the primary user-facing surface for:

- received tips;
- available balance;
- withdrawal request form;
- withdrawal status;
- recent activity.

### Admin Dashboard

The admin dashboard is for operators, not creators. It shows:

- app and withdrawal summaries;
- policy configuration;
- monitoring and rate-limit posture;
- backup controls and restore-plan helpers.

---

## Step 4 — Know the Withdrawal States

The user-facing withdrawal states are intentionally simple:

| State | Meaning |
|---|---|
| `PENDING` | The request exists and is waiting for processing. |
| `PROCESSING` | The worker has claimed the request and is trying to execute it. |
| `BROADCASTED` | A CKB transaction hash exists; the system is waiting for chain confirmation. |
| `COMPLETED` | The withdrawal has reached the product's completion condition. For CKB-address withdrawals, this means the chain reports the transaction as committed. |
| `LIQUIDITY_PENDING` | The user has enough balance, but the operator-side liquidity path needs recovery or replenishment. |
| `RETRY_PENDING` | The worker will retry after a retryable failure. |
| `FAILED` | The request failed and requires operator/user follow-up. |

---

## What to Read Next

| Goal | Next doc |
|---|---|
| Product status and limitations | [Current Status](current-status.md) |
| Full docs map | [Docs README](README.md) |
| Milestone proof | [Acceptance Tracker](acceptance/README.md) |
| Discourse install | [Discourse Plugin Admin](runbooks/discourse-plugin-admin.md) |
| Backend deployment | [Fiber Link Stack Deployment](runbooks/fiber-link-stack-deployment.md) |
| Mainnet readiness | [Mainnet Deployment Checklist](runbooks/mainnet-deployment-checklist.md) |
