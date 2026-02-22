# Fiber Link MVP Design

**Date:** 2026-02-03
**Status:** Historical design snapshot (superseded)

Canonical references:
- `docs/current-architecture.md` (canonical index)
- `docs/01-scope-mvp.md` (product scope baseline)
- `docs/02-architecture.md` (current architecture and boundaries)
- `docs/06-development-progress.md` (implementation status)

## Goal
Deliver an end-to-end tipping and withdrawal flow for Discourse communities on CKB Fiber, with a custodial hub, internal ledger, and on-chain UDT withdrawals.

## Key Decisions
- Repos: **split** into `fiber-link-service` and `fiber-link-discourse-plugin`.
- Assets: **CKB + USDI** (stablecoin UDT), per-community configurable.
- Environment: **testnet/mainnet switch via env vars**.
- Discourse: **official plugin** for Discourse 3.x (Docker install).
- Integration: **JSON-RPC over HTTP** (single `/rpc`), HMAC signed requests.
- Service stack: **Fastify JSON-RPC service**, **Next.js Admin Web (tRPC)**, **Drizzle**, **BetterAuth**.
- Admin roles: **super admin + community admin** (MVP).
- Ledger: **per-community isolation**, strict idempotency, audit log.
- Settlement detection: **subscription + polling reconciliation**.
- Withdrawals: **batch every 30 minutes**, **mixed auto/manual approval**, **CCC (ckb-devrel/ccc SDK) for UDT transfers**.
- UX: **logged-in users only**, **free-amount input**, **public tip display with optional anonymity**, **5s polling**.

## Architecture
### Components
1. **Discourse Plugin**
   - Tip button + modal (amount, asset, invoice, status)
   - Public tip display under posts (with amount + optional anonymity)
   - Creator dashboard (balance, history, withdraw requests)
   - Discourse notifications to creators on tip

2. **Fiber Link Service**
   - JSON-RPC API for plugin integration
   - Admin Web (Next.js + tRPC + BetterAuth)
   - Ledger, reconciliation, and withdrawal workers

3. **Fiber Hub Node**
   - Always-online Fiber node (liquidity + invoices)
   - Abstracted via **Fiber Adapter** layer

4. **Withdrawal Signing**
   - CCC used to build/broadcast UDT transfers

## Integration Protocol (JSON-RPC)
Minimal method set:
- `tip.create` → create tip intent + invoice
- `tip.status` → query invoice/payment state
- `tip.list` → creator tip history
- `balance.get` → creator balance (per asset)
- `withdrawal.request` → create withdrawal request
- `withdrawal.list` → list withdrawals
- `admin.app.create` / `admin.app.list` → manage communities
- `admin.asset.config` → enable assets + min/max
- `admin.withdrawal.approve` / `admin.withdrawal.reject`
- `admin.ledger.adjust` → manual credit/debit with audit

Auth: HMAC headers (`x-app-id`, `x-ts`, `x-nonce`, `x-signature`). 5-minute window + nonce replay protection.

## Data Model (Service)
- `apps` (community/app_id, hmac_secret, status)
- `users` (discourse_user_id, app_id)
- `posts` (optional reference)
- `tip_intents` (invoice, state, asset, amount, created_at, settled_at)
- `ledger_entries` (credit/debit, amount, asset, ref_id, idempotency_key)
- `withdrawals` (state, amount, asset, to_address, tx_hash)
- `audit_logs` (admin actions, manual adjustments)
- `admin_users` (BetterAuth users with role)
- `app_admins` (community → admin mapping)

### Ledger Invariants
- One settled invoice → at most one credit entry.
- Balance = sum(credits) − sum(debits) per app/user/asset.
- Withdrawal requires corresponding debit entry.

## Flows
### Tip
1. Plugin calls `tip.create`.
2. Service validates limits, resolves recipient, calls Fiber Adapter to create invoice.
3. Plugin displays invoice + QR, polls `tip.status` every 5s.
4. Settlement detected by subscription + polling; service credits ledger.
5. Plugin posts public tip line + sends creator notification.

### Withdrawal
1. Creator requests withdrawal from plugin.
2. Service checks balance, min threshold, 24h address cooldown.
3. Auto-approve small/returning withdrawals; manual approval for large/first-time.
4. Batch job every 30 minutes builds and broadcasts UDT tx via CCC.
5. Ledger debit recorded; withdrawal state progresses to confirmed.

### Reconciliation
Nightly job compares settled invoices vs credits and reports mismatches in Admin Web.

## Security & Risk Controls
- HMAC auth with replay protection
- Per-app rate limits (optional IP allowlist)
- Address change cooldown (24h)
- Manual approvals for large/first withdrawals
- Audit logs for all admin actions and manual adjustments
- Strict idempotency on credits/debits

## Observability
- Structured logs + request IDs
- Metrics: invoice creation rate, settlement latency, mismatch count, withdrawal success
- Alerts: duplicate credits, failed batches, liquidity exhaustion

## Open Questions
- Final Fiber API semantics for invoice lifecycle and subscriptions
- Best Discourse plugin storage patterns for secrets
- Final USDI UDT details (type hash, decimals)
