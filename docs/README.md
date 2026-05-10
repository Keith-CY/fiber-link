# Fiber Link Documentation

Welcome to the Fiber Link documentation. This index is organized for people first: start with the product story, then move into install, operation, architecture, and historical planning only when needed.

---

## Start Here

If you are new to Fiber Link, read these in order:

1. **[Getting Started](getting-started.md)** — Product loop, audience paths, first verification commands, and key screens.
2. **[Current Status](current-status.md)** — What works today, operator surfaces, evidence, and honest boundaries.
3. **[Milestone Acceptance](acceptance/README.md)** — Checkpoint-level delivery evidence.

---

## Product and User Guides

Practical, user-facing guides for understanding and operating the product:

| Guide | What It Covers |
|---|---|
| [Getting Started](getting-started.md) | First-time orientation for evaluators, operators, Discourse admins, and developers. |
| [Current Status](current-status.md) | Shipped capabilities, operator surfaces, verified evidence, and limitations. |
| [Overview](00-overview.md) | Short project overview, motivation, hosted-hub model, and proposal reference. |
| [MVP Scope](01-scope-mvp.md) | MVP scope, non-goals, and product boundary. |
| [Development Progress](06-development-progress.md) | Delivery history and completed milestone checkpoints. |
| [Admin Installation](admin-installation.md) | Install and verify the Discourse plugin and compose deployment. |
| [Discourse Plugin Installation with Screenshots](discourse-plugin-installation.md) | Screenshot-backed self-hosted Discourse plugin install, rebuild, settings, and Tip-button verification. |

---

## Operator Runbooks

Use these when you need executable procedures rather than narrative explanation.

| Runbook | What It Covers |
|---|---|
| [Discourse Plugin Admin](runbooks/discourse-plugin-admin.md) | Install, configure, and verify the plugin, Tip action, and creator dashboard. |
| [Fiber Link Stack Deployment](runbooks/fiber-link-stack-deployment.md) | Deploy service, worker, database, Redis, and Fiber nodes with health checks. |
| [Compose Reference](runbooks/compose-reference.md) | Docker Compose service reference and deterministic smoke usage. |
| [Mainnet Deployment Checklist](runbooks/mainnet-deployment-checklist.md) | Preflight, rollback, and post-deploy verification for mainnet readiness. |
| [Deployment Evidence](runbooks/deployment-evidence.md) | Capture deployment artifacts, logs, and retention metadata. |
| [Compose Backup Recovery](runbooks/compose-backup-recovery.md) | Capture and restore compose backup bundles. |
| [Compose Ops Monitoring](runbooks/compose-ops-monitoring.md) | Monitoring summary and operations posture checks. |
| [Withdrawal Policy Operations](runbooks/withdrawal-policy-operations.md) | Review and change withdrawal limits and app policy. |
| [Withdrawal Reconciliation](runbooks/withdrawal-reconciliation.md) | Reconcile ledger, withdrawal state, and execution evidence. |
| [Settlement Recovery](runbooks/settlement-recovery.md) | Replay or backfill settlement discovery safely. |
| [Tip Settlement Reconciliation](runbooks/tip-settlement-reconciliation.md) | Reconcile tips, invoices, settlement state, and ledger crediting. |

---

## Demo and Acceptance Evidence

| Evidence Area | What It Contains |
|---|---|
| [Acceptance Tracker](acceptance/README.md) | Canonical milestone tracker and checkpoint links. |
| [Acceptance Source Inventory](acceptance/source-inventory.md) | Inventory mapping docs to acceptance coverage. |
| [Milestone 1](acceptance/milestone-1/index.md) | Milestone 1 checkpoint index. |
| [Milestone 2](acceptance/milestone-2/index.md) | Milestone 2 checkpoint index. |
| [Milestone 3](acceptance/milestone-3/index.md) | Withdrawals, admin controls, production hardening, and mainnet-readiness checkpoints. |
| [Milestone 1 Evidence](runbooks/acceptance-evidence/milestone-1/index.md) | Milestone 1 proof index. |
| [Milestone 2 Evidence](runbooks/acceptance-evidence/milestone-2/index.md) | Milestone 2 proof index. |
| [Milestone 3 Evidence](runbooks/acceptance-evidence/milestone-3/index.md) | Milestone 3 proof index. |
| [W5 Demo Evidence](runbooks/w5-demo-evidence.md) | Earlier demo evidence runbook. |
| [Discourse Four Flows Demo Repro](runbooks/discourse-four-flows-demo-repro.md) | Full demo reproduction playbook. |
| [Local Playwright Workflow Demo](runbooks/local-playwright-workflow-demo.md) | Local browser demo automation. |

---

## Architecture and Security

These documents explain how the system works and what operators must protect.

| Document | What It Defines |
|---|---|
| [Current Architecture](current-architecture.md) | Canonical architecture index and current component map. |
| [Architecture](02-architecture.md) | Original component architecture and data flow. |
| [Threat Model](05-threat-model.md) | MVP threat model and risk controls. |
| [Security Assumptions](runbooks/security-assumptions.md) | Trust assumptions, operational limits, fallback boundaries, and contacts. |
| [Security Controls Evidence Map](runbooks/security-controls-evidence-map.md) | Security controls mapped to evidence. |
| [Threat Model Evidence Checklist](runbooks/threat-model-evidence-checklist.md) | Threat-control verification checklist and evidence retention rules. |
| [Risks and Open Questions](03-risks-open-questions.md) | Known risks, assumptions, and open questions. |
| [Research Plan](04-research-plan.md) | Research checklist and milestone framing. |

---

## Admin and Governance Decisions

| Decision / SOP | What It Covers |
|---|---|
| [Admin Membership SOP](runbooks/admin-membership-sop.md) | Grant, revoke, and audit app admin access. |
| [Admin Membership Model](decisions/2026-02-10-admin-membership-model.md) | Role model decision for `SUPER_ADMIN` and `COMMUNITY_ADMIN`. |
| [Custody Ops Controls](decisions/2026-02-10-custody-ops-controls.md) | Hosted custody baseline controls. |
| [Settlement Discovery Strategy](decisions/2026-02-10-settlement-discovery-strategy.md) | Settlement discovery design decision. |
| [USD Price Feed Policy](decisions/2026-02-10-usd-price-feed-policy.md) | Price feed policy decision. |
| [Phase 2 Decisions](decisions/2026-02-07-phase2-decisions.md) | Earlier phase decision summary. |

---

## Developer and Test Workflows

| Workflow | What It Covers |
|---|---|
| [Phase 2 Verification](runbooks/phase2-verification.md) | Service and plugin verification flow. |
| [E2E Discourse Four Flows](runbooks/e2e-discourse-four-flows.md) | UI, backend, settlement, withdrawal, and explorer proof. |
| [E2E Invoice Payment Accounting](runbooks/e2e-invoice-payment-accounting.md) | Invoice payment and accounting verification. |
| [Fiber Adapter E2E](runbooks/fiber-adapter-e2e.md) | Fiber adapter to FNN RPC validation in Docker. |
| [Sandbox Simulation](runbooks/sandbox-simulation.md) | Local/sandbox simulation workflow. |
| [Testnet Bootstrap](runbooks/testnet-bootstrap.md) | Deterministic precheck, spin-up, RPC validation, invoice smoke, and cleanup. |

Useful script entry points:

- `scripts/plugin-smoke.sh` — local Discourse plugin smoke test.
- `scripts/testnet-smoke.sh` — local testnet sanity check with machine-readable PASS/FAIL output.
- `scripts/e2e-discourse-four-flows.sh` — orchestrates the four required local e2e flows.
- `scripts/capture-e2e-discourse-four-flows-evidence.sh` — captures and archives four-flow evidence bundles.
- `scripts/capture-deployment-evidence.sh` — captures deployment evidence and logs.
- `scripts/capture-compose-backup.sh` — captures a compose backup bundle.
- `scripts/restore-compose-backup.sh` — restore flow for a compose backup bundle or archive.

---

## Historical Planning Archive

The planning archive is intentionally broad. It is useful engineering history, but it is not the best starting point for a new reader.

Start with these entry points before opening individual plan files:

| Entry Point | What It Contains |
|---|---|
| [Production Readiness Audit](plans/2026-03-18-production-readiness-audit.md) | Audit against production hardening, monitoring, limits, backups, and docs. |
| [Production Hardening Closeout](plans/2026-03-18-production-hardening-closeout.md) | Closeout snapshot for production-hardening gaps. |
| [Issue #32 Epic Closeout](plans/2026-02-21-issue-32-epic-closeout.md) | Final closeout mapping for the major epic. |
| [Phase 2 Delivery Plan](plans/2026-02-07-phase2-delivery-plan.md) | Historical Phase 2 delivery plan. |
| [Fiber Link MVP Design](plans/2026-02-03-fiber-link-mvp-design.md) | Historical early design snapshot. |
| [Fiber Link MVP Plan](plans/2026-02-03-fiber-link-mvp-plan.md) | Historical implementation draft. |

> **Note:** Prefer `README.md`, `getting-started.md`, `current-status.md`, active runbooks, and acceptance indexes for user-facing truth. Use `docs/plans/` for historical context and implementation archaeology.

---

## Document Precedence

When documents appear to conflict, resolve ambiguity in this order:

1. Repository `README.md` for product positioning and entry points.
2. `docs/current-status.md` for shipped capability and honest boundaries.
3. Active runbooks under `docs/runbooks/`.
4. Acceptance indexes under `docs/acceptance/` and `docs/runbooks/acceptance-evidence/`.
5. Architecture/security documents under `docs/`.
6. Historical plans under `docs/plans/`.

---

## Documentation Rules

- Keep user-facing docs plain and task-oriented.
- Explain what a community member, creator, admin, or operator can do before exposing internal component names.
- Do not include secrets, raw invoices, private keys, API tokens, or passwords in docs or evidence bundles.
- Track unresolved documentation work as GitHub issues and link the issue from the relevant doc.
- Avoid unresolved placeholder markers in user-facing docs.
