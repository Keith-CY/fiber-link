# Proposed Architecture

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


## High-level flow (Tip)
1. User clicks **Tip** on a post.
2. Plugin calls service: `POST /tips (app_id, post_id, recipient_id, asset, amount)`.
3. Service asks hub node to create an invoice.
4. Plugin displays invoice (string + QR).
5. User pays invoice.
6. Service detects invoice settlement and credits the recipient’s internal balance.

## Withdrawal (MVP)
- Recipient initiates withdrawal after passing a threshold.
- Service performs on-chain UDT transfer to recipient-provided CKB address.

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

## Trust boundaries & keys
- Hub node keys (funds) MUST be protected (HSM if possible; at minimum strong operational controls).
- Service credentials to hub node.
- Plugin <-> Service auth and rate limiting.

