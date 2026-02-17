# M1 Checkpoint 1: Architecture and Threat Model

## Goal

Lock architecture boundaries and threat controls for invoice -> payment -> settlement lifecycle.

## Collected evidence

- Architecture map and lifecycle traces:
  - `docs/02-architecture.md`
- Threat model with trust boundaries and control matrix:
  - `docs/05-threat-model.md`
- Threat-control acceptance checklist and evidence matrix:
  - `docs/runbooks/threat-model-evidence-checklist.md`
- Security assumptions ownership and operational limits:
  - `docs/runbooks/security-assumptions.md`

## Current status

`DONE`

Architecture boundaries, threat model, and evidence mapping docs are all present and linked.

## Exit criteria

- Architecture doc reflects runtime boundaries and state transitions.
- Threat model covers auth, replay, settlement correctness, withdrawal path.
- Checklist/runbook points to executable verification commands and owners.
