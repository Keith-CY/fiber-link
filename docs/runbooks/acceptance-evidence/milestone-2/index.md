# Milestone 2 Acceptance Evidence

Last updated: 2026-02-27

This file tracks evidence for Milestone 2 (Discourse plugin + end-to-end tipping).

## Evidence Summary

| Evidence | Command | Result |
| --- | --- | --- |
| Service integration baseline (RPC/Admin/DB/Worker tests) | `cd fiber-link-service && (cd apps/rpc && bun run test -- --run --silent) && (cd apps/admin && bun run test -- --run --silent) && (cd packages/db && bun run test -- --run --silent) && (cd apps/worker && bun run test -- --run --silent)` | PASS (`rpc: 56`, `admin: 58`, `db: 55`, `worker: 84` tests all passed) |
| Discourse plugin request + system smoke | `PLUGIN_SMOKE_SKIP_FETCH=1 PLUGIN_SMOKE_EXTRA_SPECS='plugins/fiber-link/spec/system/fiber_link_dashboard_spec.rb plugins/fiber-link/spec/system/fiber_link_tip_spec.rb' scripts/plugin-smoke.sh` | PASS (`14 examples, 0 failures`, seed `44119`) |

## Acceptance Notes

- Payment state polling/replay integration is covered by worker settlement test suites and `dashboard.summary` plugin/system flow.
- Recipient dashboard visibility (balance + tip history + lifecycle board) is validated in `fiber_link_dashboard_spec.rb` through the plugin smoke run above.
