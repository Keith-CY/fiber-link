# Proposed Architecture

## Scope and assumptions

- MVP is **hosted custodial**: Fiber Link service and worker are trusted within the same security domain.
- The Discourse plugin owns the user interaction surface and server-side mediation to the Fiber Link service.
- Durable state lives in Postgres with transactional updates for ledger and withdrawal progression.
- Settlement detection and withdrawal execution are asynchronous background jobs.

## Components
### 1) Discourse Plugin
Responsibilities:
- UI: Tip button + modal + creator dashboard
- Calls Fiber Link Service to create tip intents and fetch status
- Displays invoice (string + QR)

Key integration points:
- Map Discourse user IDs to Fiber Link user accounts
- Secure server-to-server auth between Discourse and Fiber Link Service (API key or signed requests)

### 2) Fiber Link Service (Backend + Ledger)
Responsibilities:
- Create tip intents (`POST /tips`) and request invoices from the hub node
- Track invoice state and credit recipients when settled
- Maintain internal ledger with strong invariants
- Enforce request integrity and authorization at API boundaries
- Handle withdrawals to on-chain addresses

Recommended properties:
- Idempotent operations
- Durable state machine for tip intents
- Audit log for all balance-affecting events

### 3) Fiber Link Hub Node (FNN)
Responsibilities:
- Provide invoice creation
- Receive payments over Fiber
- Provide settlement events / query capabilities

### 4) Fiber Link Worker (Settlement + Withdrawal runtime)
Responsibilities:
- Poll pending invoices and reconcile against FNN settlement state
- Reconcile past windows for missed settlement events
- Execute withdrawals with bounded retries and persistence of execution evidence
- Emit settlement/queue health metrics

### 5) Storage & infra
- Postgres stores intents, ledger entries, withdrawals, and app-level settings.
- Drizzle migrations own schema evolution for all stateful components.


## Flow model

## High-level flow (Tip)
1. User clicks **Tip** on a post.
2. Plugin calls service: `POST /tips (app_id, post_id, recipient_id, asset, amount)`.
3. Service asks hub node to create an invoice.
4. Plugin displays invoice (string + QR).
5. User pays invoice.
6. Service detects invoice settlement and credits the recipient’s internal balance.

### Tip state lifecycle (MVP)
- `UNPAID` / `PENDING` / `SETTLED` / `FAILED` / `EXPIRED`
- Ledger credit is written only on the `UNPAID -> SETTLED` transition with a single write path.

## Withdrawal (MVP)
- Recipient initiates withdrawal after passing a threshold.
- Service persists a withdrawal request and worker process submits the transfer.
- Withdrawal state transitions to `COMPLETED` only after a durable tx evidence write.
- Service tracks tx hash and structured error details for each completed or failed attempt.

## Data model (initial sketch)
- users (mapped from Discourse)
- posts (optional reference)
- tip_intents
  - id, community/app_id, post_id, from_user, to_user, asset, amount
  - invoice, invoice_state, created_at, settled_at
- ledger_entries
  - id, user_id, type (credit/debit), amount, asset, reference (tip_intent_id / withdrawal_id)
  - idempotency_key
- withdrawals
  - id, user_id, amount, asset, to_address, tx_hash, state

## Threat-control checkpoints in architecture
- Discourse Plugin auth: API boundary is HMAC-protected and timestamp/nonce replay-protected (`apps/rpc`), which should be treated as the primary trust gate for all `tip.create` requests.
- Settlement correctness: `worker` and `rpc` share `tip_intents`/`ledger_entries` state transitions so settlement and crediting cannot diverge.
- Withdrawal safety: worker executes withdrawal from `PENDING` queue state and records `tx_hash` only after durable execution evidence is available.
- Reconciliation: periodic backfill command and mismatch report must be run after incidents before restarting high-volume tip acceptance.

## Runtime trust boundaries
- Browser ↔ Discourse plugin: client-side risks (`XSS`, CSRF, session theft)
- Discourse plugin server ↔ Fiber Link Service API: signed/secret request boundary with replay protection
- Fiber Link Service ↔ FNN: authenticated RPC + settlement verification
- Fiber Link Service ↔ Worker ↔ Database: single transaction boundary for idempotent updates

## Trust boundaries & keys
- Hub node keys (funds) MUST be protected (HSM if possible; at minimum strong operational controls).
- Service credentials to hub node.
- Plugin <-> Service auth and rate limiting.
