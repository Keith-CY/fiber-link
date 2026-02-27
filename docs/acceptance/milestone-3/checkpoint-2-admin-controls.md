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

`DONE`

Role model and runtime policy controls are implemented.

Latest verification evidence (2026-02-27):

- Admin policy router tests:
  - `cd fiber-link-service/apps/admin && bun run test -- --run --silent src/server/api/routers/withdrawal-policy.test.ts`
- DB policy repo and enforcement tests:
  - `cd fiber-link-service/packages/db && bun run test -- --run --silent src/withdrawal-policy-repo.test.ts`
  - `cd fiber-link-service/apps/rpc && bun run test -- --run --silent src/methods/withdrawal.test.ts`
- Ops SOP:
  - `docs/runbooks/admin-membership-sop.md`

## Exit criteria

- Asset configuration and withdrawal limits are enforced by policy in runtime.
- Admin control operations are documented and auditable for Year 1 operations.
