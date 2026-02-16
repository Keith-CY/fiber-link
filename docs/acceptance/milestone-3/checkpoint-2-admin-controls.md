# M3 Checkpoint 2: Admin Controls (Asset Config, Thresholds, Limits)

## Goal

Establish operator/admin guardrails for supported assets, withdrawal thresholds, and policy limits.

## Collected evidence

- Current admin role-scoping and data boundary:
  - `docs/06-development-progress.md`
- Risk and policy requirements for custody controls:
  - `docs/03-risks-open-questions.md`
- Admin membership model decision:
  - `docs/decisions/2026-02-10-admin-membership-model.md`

## Current status

`PARTIAL`

Role model baseline exists (`SUPER_ADMIN`, `COMMUNITY_ADMIN`), but explicit per-app/per-user policy limits are still listed as remaining hardening.

## Exit criteria

- Asset configuration and withdrawal limits are enforced by policy in runtime.
- Admin control operations are documented and auditable for Year 1 operations.
