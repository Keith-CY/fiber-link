# Milestone Acceptance Tracker

Last updated: 2026-02-16

This directory is the canonical acceptance workspace for milestone checkpoints and acceptance criteria.
Each milestone has its own directory, an `index.md`, and one markdown file per checkpoint.
This PR primarily restructures tracking artifacts; `PARTIAL` and `PENDING` checkpoints remain in-progress and are not treated as accepted.

## Milestone index

| Milestone | Scope summary | Acceptance criteria | Index |
| --- | --- | --- | --- |
| Milestone 1 | Technical design + Fiber integration prototype | Public repo, documented setup, demo video or live testnet demo | [`milestone-1/index.md`](./milestone-1/index.md) |
| Milestone 2 | Discourse plugin + end-to-end tipping | Tipping flow works on a testnet Discourse demo | [`milestone-2/index.md`](./milestone-2/index.md) |
| Milestone 3 | Withdrawals + mainnet readiness | Mainnet-ready release, full docs, and demo instance | [`milestone-3/index.md`](./milestone-3/index.md) |

## Status legend

- `DONE`: implemented and documented with current evidence.
- `PARTIAL`: baseline exists but acceptance proof or hardening is still missing.
- `PENDING`: checkpoint has not reached implementation/evidence baseline.
- `BLOCKED`: checkpoint cannot progress due to an active blocker.

## Source collection coverage

- Full docs inventory and acceptance mapping: [`source-inventory.md`](./source-inventory.md)
- Legacy Milestone 1 public evidence bundle directory (still used for artifact publishing):
  - [`docs/runbooks/acceptance-evidence/`](../runbooks/acceptance-evidence/README.md)

## Public proof ticket

- Milestone 1 public proof tracking issue: [#114](https://github.com/Keith-CY/fiber-link/issues/114)
