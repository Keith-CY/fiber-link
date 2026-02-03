# Risks & Open Questions

## Custody & security
- Custodial hub implies loss risk if hub keys compromised.
- Need strict operational controls:
  - max balance per user / per community
  - withdrawal thresholds / frequent settlement
  - monitoring + alerting
  - incident response plan

## Ledger correctness
- Settlement detection must be **exactly-once** from the ledger’s perspective.
- Need idempotency keys and reconciliation strategies.
- Must handle partial failures (invoice settled, service crash before credit).

## Fiber integration unknowns (research needed)
- What are the exact APIs for:
  - creating invoices
  - subscribing to settlement events
  - querying invoice/payment state
- Reliability characteristics and restart behavior.
- How to manage liquidity for receiving tips; operational playbook.

## Discourse plugin constraints
- Best practices for Discourse plugins (UI patterns, auth, storing secrets).
- How to map users and handle anonymous reading vs logged-in tipping.

## UX constraints
- How to present invoice + status updates cleanly.
- Timeouts and retry behaviors for payments.

## On-chain withdrawal
- UDT transfer implementation + fee management.
- Do we batch withdrawals? (tradeoffs: cost vs latency)

## Compliance / policy
- Are there constraints for a hosted hub for communities (jurisdiction, Terms of Service)?
- What disclaimers and limits should be included for MVP?

## Deliverable structure
- Monorepo vs split repos:
  - `fiber-link-service`
  - `fiber-link-discourse-plugin`
- If split: define shared API spec and versioning.
