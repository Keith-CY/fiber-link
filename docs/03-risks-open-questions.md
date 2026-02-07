# Risks & Open Questions

Reference plan: `docs/plans/2026-02-07-phase2-delivery-plan.md`

## Custody & security
- Risk: custodial hub implies loss risk if hub keys are compromised.
- Required controls: max balance per user/community, withdrawal thresholds, monitoring/alerting, incident response.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-12)
- Mitigation Task(s): Phase2 Task 1, Phase2 Task 7, Phase2 Task 10.

## Ledger correctness
- Risk: settlement detection must be exactly-once from ledger perspective.
- Failure mode: invoice settled but service crashes before credit write.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-12)
- Mitigation Task(s): Phase2 Task 4, Phase2 Task 5, Phase2 Task 10.

## Fiber integration unknowns
- Open question: exact API behavior for create invoice, settlement subscribe/poll, and invoice status query.
- Open question: reliability and restart semantics for settlement events.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-11)
- Mitigation Task(s): Phase2 Task 3, Phase2 Task 5.

## Discourse plugin constraints
- Open question: best practices for Discourse plugin auth, settings, and credential handling.
- Open question: user identity mapping and anonymous read vs logged-in tipping behavior.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-13)
- Mitigation Task(s): Phase2 Task 7, Phase2 Task 9.

## UX constraints
- Open question: payment timeout + retry UX wording and state transitions.
- Open question: invoice/status presentation for low-latency feedback.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-13)
- Mitigation Task(s): Phase2 Task 9.

## On-chain withdrawal
- Risk: UDT transfer implementation, fee management, and batching tradeoff (cost vs latency).
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-14)
- Mitigation Task(s): Phase2 Task 6, Phase2 Task 10.

## Compliance / policy
- Open question: hosted hub constraints by jurisdiction and community ToS.
- Open question: disclaimers and usage limits required for MVP.
- Status: OPEN (Owner: @Keith-CY, Target: 2026-02-14)
- Mitigation Task(s): Phase2 Task 1, Phase2 Task 10.

## Deliverable structure
- Decision: split repos remain in effect:
  - `fiber-link-service`
  - `fiber-link-discourse-plugin`
- Status: RESOLVED (Owner: @Keith-CY, Date: 2026-02-03)
- Control: shared service contract is maintained in docs and validated in Phase2 Task 1 / Phase2 Task 9.
