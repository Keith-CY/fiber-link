# Fiber Link Current Status

_Last updated: 2026-05-08_

---

## Summary

Fiber Link is a working community tipping and withdrawal layer built on the CKB Fiber Network. The current product surface covers the full demo loop: a reader tips Discourse content, the payment settles through the Fiber Link service, the recipient sees incoming activity in `/fiber-link`, and the recipient can request a CKB withdrawal with transaction evidence.

The repository has completed the current Milestone 1–3 acceptance checkpoints. It is no longer only a research plan; it has a Discourse plugin, service runtime, worker processes, admin controls, deployment runbooks, and evidence bundles.

---

## What Works Today

### Community Tipping

- Discourse post and reply tipping through the Fiber Link plugin.
- Server-side RPC proxying so the forum derives sender and recipient identities instead of trusting the browser.
- Fiber invoice creation and payment-status handling.
- Settlement discovery, replay, and idempotent ledger crediting.

### Creator Dashboard

- `/fiber-link` creator dashboard inside Discourse.
- Incoming activity feed for received tips.
- Balance and withdrawal panels.
- Withdrawal status display, including the `BROADCASTED` state for CKB-address withdrawals that have a transaction hash but are still waiting for chain confirmation.

### Withdrawals

- Withdrawal request persistence and policy checks.
- Insufficient-funds protection based on ledger balance and pending withdrawals.
- CKB-address payout execution with transaction evidence.
- `BROADCASTED -> COMPLETED` semantics for CKB-address withdrawals: app completion means the transaction has reached committed chain status, not merely that a hash was returned.

### Admin and Operator Controls

- Standalone admin dashboard for app, withdrawal, policy, monitoring, rate-limit, and backup surfaces.
- App-scoped `COMMUNITY_ADMIN` and global `SUPER_ADMIN` role model.
- Withdrawal policy controls for allowed assets, per-request maximums, per-user daily maximums, per-app daily maximums, and cooldowns.
- RPC rate-limiting configuration.

### Deployment and Operations

- Docker Compose reference stack for service, worker, Postgres, Redis, and Fiber nodes.
- Discourse plugin installation and smoke-test guides.
- Monitoring summary, backup capture, restore-plan, and deployment-evidence runbooks.
- Mainnet deployment checklist and security-control evidence map.

### Acceptance Evidence

- Milestone checkpoint indexes under `docs/acceptance/`.
- Operator evidence under `docs/runbooks/acceptance-evidence/`.
- Demo proof links and verification notes for live Discourse, Fiber Link RPC, withdrawal status, and explorer transactions.

---

## Operator Surfaces

| Surface | What It Provides |
|---|---|
| Discourse Plugin | Tip action, payment modal, creator dashboard, withdrawal request UI. |
| Fiber Link RPC Service | Signed backend methods for tips, dashboard data, withdrawal requests, and health checks. |
| Worker Runtime | Settlement discovery, withdrawal execution, liquidity handling, reconciliation, and scheduled processing. |
| Admin Dashboard | App list, withdrawal list, state summaries, policy forms, monitoring, rate-limit controls, and backup controls. |
| Runbooks and Scripts | Deployment, smoke tests, evidence capture, backup/restore, reconciliation, and mainnet readiness. |

---

## Verified Acceptance Evidence

The current acceptance model is organized by milestone:

- [Milestone 1](acceptance/milestone-1/index.md) — foundational payment-service checkpoint set.
- [Milestone 2](acceptance/milestone-2/index.md) — Discourse integration and settlement checkpoint set.
- [Milestone 3](acceptance/milestone-3/index.md) — withdrawals, admin controls, production hardening, and mainnet-readiness checkpoint set.

The main proof entry points are:

- [Milestone Acceptance Tracker](acceptance/README.md)
- [Milestone 3 Evidence Index](runbooks/acceptance-evidence/milestone-3/index.md)
- [Deployment Evidence Runbook](runbooks/deployment-evidence.md)
- [Mainnet Deployment Checklist](runbooks/mainnet-deployment-checklist.md)

---

## Honest Boundaries

| Boundary | Detail |
|---|---|
| **Hosted custody model** | The current MVP uses a hosted hub and internal ledger. This is intentional, but it requires clear limits, monitoring, key management, and recovery procedures. |
| **Discourse-first integration** | The product is currently implemented and documented around Discourse. Other community surfaces are future integrations. |
| **Operator setup required** | Community members should not need to run nodes, but the community operator still needs a correctly configured service, Fiber nodes, database, secrets, monitoring, and backups. |
| **Liquidity is operationally meaningful** | Withdrawals depend on hot-wallet and Fiber liquidity readiness. The docs include recovery and liquidity runbooks because this is part of the product boundary. |
| **Mainnet readiness is a gate, not a casual switch** | The repository includes mainnet checklists and evidence, but operators must complete the documented preflight, rollback, monitoring, and secret-management gates before production use. |
| **Historical plans are archival** | `docs/plans/` contains useful engineering history. Treat `README.md`, this status page, active runbooks, and acceptance indexes as the user-facing truth. |

---

## Best Entry Points

| Goal | Where to Go |
|---|---|
| Understand Fiber Link quickly | [Repository README](../README.md) |
| Set up orientation for the first time | [Getting Started](getting-started.md) |
| Browse all docs by audience and task | [Docs Map](README.md) |
| Install or configure the Discourse plugin | [Discourse Plugin Admin](runbooks/discourse-plugin-admin.md) |
| Deploy the service stack | [Fiber Link Stack Deployment](runbooks/fiber-link-stack-deployment.md) |
| Verify milestone delivery | [Milestone Acceptance](acceptance/README.md) |
| Prepare for mainnet | [Mainnet Deployment Checklist](runbooks/mainnet-deployment-checklist.md) |
