# MVP Scope

## MVP goal
Ship a working end-to-end tipping flow on a demo Discourse instance (testnet), proving:
1) Discourse UI can request an invoice
2) User can pay via any Fiber-compatible wallet/node
3) Service detects settlement and credits the recipient
4) Recipient can withdraw to an on-chain address

## In-scope
### Discourse plugin
- Tip button on posts/replies
- Tip modal showing:
  - amount + asset
  - invoice string
  - QR code
  - payment status updates
- Creator dashboard:
  - internal balance
  - tip history
  - withdrawal request UI

### Fiber Link Service (backend)
- `POST /tips` to create a tip intent and return an invoice
- Settlement detection (subscription/polling) and ledger crediting
- Internal ledger per user
- Withdrawal workflow:
  - threshold-based withdrawal
  - on-chain UDT transfer to provided CKB address
- Admin endpoints/config (assets, limits)

### Hub Fiber Node (FNN)
- Always-online Fiber node
- Supports:
  - CKB
  - at least one stablecoin UDT (e.g., USDI)
- Liquidity management sufficient for receiving tips

## Explicit non-goals (for MVP)
- Non-custodial receiver experience (creator running own node)
- Multi-community federation / multi-hub routing
- Complex fiat off-ramp
- Multi-chain assets
- Sophisticated AML/KYC flows
- Advanced privacy / receiver anonymity

## Deliverables
- Open-source code
- Docker Compose reference deployment
- Admin installation guide
- Security + ops runbook (keys, backups, monitoring)
- Public demonstration proof is tracked in issue [#114](https://github.com/Keith-CY/fiber-link/issues/114)
