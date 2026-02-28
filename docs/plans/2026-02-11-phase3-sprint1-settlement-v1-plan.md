# Phase 3 Sprint 1 Plan: Settlement Detection v1

Status: Diverged historical sprint-plan snapshot.
Canonical replacements: `docs/decisions/2026-02-10-settlement-discovery-strategy.md`, `docs/02-architecture.md`, `docs/06-development-progress.md`.
Canonical index: `docs/current-architecture.md`.

Date: 2026-02-11  
Owner: Fiber Link  
Plan status at authoring time: Planned

## Goal

Ship a durable settlement discovery path that can recover missed events without double-crediting:
- discover settled invoices via polling
- reconcile/backfill safely after outages
- make settlement backlog visible operationally

This sprint is intentionally narrow. It does not include real withdrawal execution or balance debit gating.

## Scope

In scope:
- polling worker loop for unpaid/pending tip intents
- settlement status fetch and transition handling
- idempotent crediting using existing settlement/ledger invariants
- reconciliation/backfill command by app/time window
- observability metrics + runbook updates

Out of scope:
- subscription/event-stream settlement path
- withdrawal executor implementation
- pricing snapshot implementation

## Implementation Work Items

1. Discovery loop
- Add worker entry flow that periodically scans pending invoices and fetches invoice status.
- Define polling interval + batch size via env.

2. State transitions
- For settled invoices: call settlement credit path (already idempotent).
- For expired/failed invoices: move to terminal non-credited state.
- For still-pending invoices: keep pending and recheck later.

3. Reconciliation/backfill
- Add CLI/job: replay settlement detection for `appId` + `[from,to]` window.
- Guarantee safe re-run behavior (no double credit, deterministic end state).

4. Observability
- Emit metrics/logs:
  - pending invoice backlog
  - settlement detection latency
  - replay/backfill processed count
  - settlement credit dedupe count

5. Runbook
- Add operational playbook:
  - detect backlog growth
  - trigger backfill command
  - verify repaired state

## Verification Gate

Required before merge:
- Unit/integration tests:
  - duplicate settlement observations do not double-credit
  - worker restart/crash does not lose eventual crediting
  - backfill command is idempotent
- Existing worker test suite passes.
- Runbook contains exact recovery steps for missed settlement events.

## Exit Criteria

Sprint 1 is complete when:
- settlement events are discoverable without manual SQL edits in normal failures
- missed events can be repaired with a documented backfill command
- operators can observe backlog/latency and know when recovery is needed
