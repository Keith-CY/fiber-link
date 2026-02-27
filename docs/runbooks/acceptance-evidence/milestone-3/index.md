# Milestone 3 Acceptance Evidence

Last updated: 2026-02-27

This file tracks evidence for Milestone 3 (withdrawals + mainnet readiness).

## Evidence Summary

| Evidence | Command | Result |
| --- | --- | --- |
| Withdrawal policy + runtime enforcement tests | `cd fiber-link-service/apps/rpc && bun run test -- --run --silent src/methods/withdrawal.test.ts src/rpc.test.ts src/rate-limit.test.ts` | PASS (policy reasons, min-capacity checks, RPC rate-limit behavior, and withdrawal request API handling covered) |
| Admin controls for policy management | `cd fiber-link-service/apps/admin && bun run test -- --run --silent src/server/api/routers/withdrawal-policy.test.ts src/server/api/routers/withdrawal.test.ts` | PASS (`10` tests passed) |
| Compose-level production control defaults | `deploy/compose/.env.example` + `deploy/compose/docker-compose.yml` | Updated with RPC rate-limit and withdrawal policy env keys |
| Mainnet readiness gate | `docs/runbooks/mainnet-deployment-checklist.md` | Published checklist with preflight, rollback, and post-deploy verification steps |

## Acceptance Notes

- Creator withdrawal workflow is validated via service/worker withdrawal test coverage and plugin dashboard operational views.
- Admin controls for asset/threshold/limit management are implemented through `withdrawalPolicy` router + DB policy table/repo.
- Production hardening now includes explicit runtime rate limiting and policy defaults in compose env templates.
