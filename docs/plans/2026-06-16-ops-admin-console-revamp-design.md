# Ops/Admin Console Revamp Design

Date: 2026-06-16
Owner: Fiber Link
Design status: Draft

## Goal

Redesign the standalone Fiber Link **service operations console** (`fiber-link-service/apps/admin/`) so operators can see and act on the full operational surface of the service from one place.

This is the operator-facing admin that runs as its own Next.js app. It is **not** the Discourse plugin admin, and it is **not** the creator dashboard rendered inside Discourse via the `dashboard.summary` RPC `includeAdmin` branch. Those surfaces are out of scope here.

The revamp must:

- replace the single-page console with a navigable, multi-page information architecture
- surface operational domains that already exist in the service but have no admin UI today (settlement pipeline, liquidity, webhook delivery, app/secret management, audit trail)
- move monitoring off host-coupled shell scripts and onto direct database reads
- preserve the current trust-proxy authentication model and role scoping without regression

## Problem

The console today is a single server-rendered page (`src/pages/index.tsx`, ~644 lines) that stacks every feature into one scroll: a role hero, withdrawal status summaries, the app list, the withdrawals table, monitoring (SUPER_ADMIN only), per-app withdrawal-policy forms, the global rate-limit change-set generator, and backup capture/restore-plan.

Concrete limits of the current design:

- **No information architecture.** Everything loads on one route. There is no place to add new operational domains without making the page longer.
- **Form-POST plus redirect plus flash.** Every mutation posts to a Next API route (`/api/withdrawal-policies`, `/api/runtime-policies/rate-limit`, `/api/backups/capture`, `/api/backups/restore-plan`), which returns a `303` and carries success/error state back through query-string flash params. There is no inline feedback and no shareable filtered state.
- **Hand-written CSS only.** There is no component library, so every table, form, and status surface is bespoke.
- **Monitoring is host-coupled.** The monitoring and backup panels shell out to `deploy/compose/compose-ops-summary.sh`, `scripts/capture-compose-backup.sh`, and `scripts/restore-compose-backup.sh` via `execFile`. The console must therefore be deployed on the compose host with the repository mounted, even though most monitoring numbers are really just database queries.
- **Large parts of the operational surface are invisible.** The service already models settlement intents and their event log, liquidity requests with channel-rotation metadata, notification channels and rules, and a double-entry ledger — but none of these are exposed in the console. Manual settlement and withdrawal intervention is only possible today by SSH-ing in and running a recovery runbook.

### Operational surface that exists but is not exposed

| Domain | Where it lives | Today's operator access |
|---|---|---|
| Settlement pipeline (UNPAID backlog, retries, failure reasons, lifecycle events) | `tip_intents`, `tip_intent_events` (`packages/db/src/tip-intent-repo.ts`, `tip-intent-event-repo.ts`) | None in console; runbook + SQL only |
| Liquidity requests and channel rotation | `liquidity_requests` (`packages/db/src/liquidity-request-repo.ts`) | None in console |
| Webhook channels and rules | `notification_channels`, `notification_rules` (`packages/notifications`) | RPC API only |
| App registration and HMAC secret rotation | `apps` (`packages/db/src/schema.ts`) | None; manual DB work |
| Per-app funds (ledger aggregates) | `ledger_entries` (`packages/db/src/ledger-repo.ts`) | None in console |
| Admin action audit trail | does not exist yet | None |

## Authentication and roles (unchanged)

The revamp keeps the existing trust model. The console trusts the `x-admin-role` and `x-admin-user-id` request headers, which a deployment-side reverse proxy is responsible for injecting. Environment fallbacks (`ADMIN_DASHBOARD_DEFAULT_ROLE`, `ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID`) remain for development and fixture runs. The `admin_users` table continues to hold only email plus role; there is no credential store in the console.

Two roles continue to apply, consistent with the [Admin Membership Model](../decisions/2026-02-10-admin-membership-model.md):

- **SUPER_ADMIN** — global visibility and all controls.
- **COMMUNITY_ADMIN** — scoped to assigned apps via the `app_admins` table; cannot see other communities or global controls.

Hardening the authentication model itself (real login, sessions) is explicitly out of scope for this revamp and is tracked as a separate open question below.

## Key decision: domain-oriented multi-page console

Replace the single page with five top-level pages, each owning one operational domain. An app detail page acts as the aggregation hub for everything scoped to a single app.

```
/                      Overview      health summary, alerts, dual-pipeline count cards
/settlements           Settlements   UNPAID backlog, retries, failure reasons (SUPER_ADMIN)
/settlements/[id]      detail         tip-intent timeline from tip_intent_events + recovery hint
/withdrawals           Withdrawals   payout queue with state-machine filters + liquidity panel
/apps                  Apps          app inventory
/apps/[appId]          detail         policy, HMAC secret, webhook channels, admins, funds overview
/ops                   Ops           rate-limit change set, backups, raw ops summary, audit log
```

### Role visibility

| Surface | SUPER_ADMIN | COMMUNITY_ADMIN |
|---|---|---|
| Overview | global | slim, scoped to assigned apps |
| Settlements | full | hidden |
| Withdrawals | global; `userId` shown | scoped; `userId` omitted server-side |
| Apps list/detail (policy, channels, funds) | all apps | assigned apps only |
| Withdrawal policy editing | yes | yes, assigned apps only |
| App create / secret rotate / admin assignment | yes | hidden |
| Webhook channel/rule writes, settlement/withdrawal intervention | yes | hidden |
| Ops (rate limit, backups, audit log) | yes | hidden |

`userId` omission and HMAC-secret confidentiality are enforced on the server (output is trimmed before it leaves the procedure), not hidden in the client. HMAC secrets are returned exactly once, at create or rotate time, and never read back.

## Technology direction

- **Tailwind CSS v4 plus shadcn/ui**, with components vendored into the repository. Tables, forms, dialogs, and status surfaces stop being bespoke CSS. Tailwind v4 is CSS-first (`@tailwindcss/postcss`, no `tailwind.config`), which fits the Next pages router cleanly.
- **tRPC v11 plus TanStack Query v5** on the client. The console becomes a normal client-data app: queries and mutations run over `/api/trpc`, with inline toasts replacing the `303`/flash pattern. Table filters live in the URL query string so filtered views are shareable. The tRPC context reads the same `x-admin-role`/`x-admin-user-id` headers the page already trusts.
- **A services seam.** Routers depend on an `AdminServices` interface, not directly on the database. The real implementation queries Postgres through the existing `packages/db` repositories; the fixture implementation (evolved from today's `ADMIN_DASHBOARD_FIXTURE_PATH` store) backs unit tests and the Playwright acceptance proof. This keeps router tests trivial and keeps the acceptance harness fixture-driven end to end.
- **Database-direct monitoring.** The settlement-backlog, retry, and parity metrics currently computed by the worker (`apps/worker/src/ops-summary.ts`) move into a shared package so the console can compute them from a direct database read instead of shelling out to `compose-ops-summary.sh`. Backup capture and restore-plan stay as compose scripts, because they legitimately need host Docker access.

Existing, already-tested logic is reused rather than rewritten: the rate-limit change-set builder (`src/server/dashboard-rate-limit.ts`), the backup capture/list/restore-plan helpers (`src/server/dashboard-backups.ts`), and the withdrawal-policy validator (`src/withdrawal-policy-input.ts`) are wrapped as tRPC procedures. The form-POST API routes and their flash plumbing are retired.

## Write operations and audit

The revamp introduces operator write actions that today require a runbook and shell access. Each is SUPER_ADMIN-only, guarded by a confirmation dialog, and recorded to a new audit log.

- **Settlement and withdrawal intervention.** Retry or terminalize stuck items using the existing guarded state-transition helpers, never raw SQL. Settlement retry reuses `clearSettlementFailure` (UNPAID only); terminalize reuses `markSettlementTerminalFailure`. Withdrawal intervention adds guarded transitions to `packages/db/src/withdrawal-repo.ts`. The withdrawal "revive from FAILED" path must guard on `tx_hash IS NULL`, because broadcasted withdrawals already carry a ledger debit and reviving them would double-pay. This mirrors the safety rules in the [Settlement Recovery](../runbooks/settlement-recovery.md) and [Withdrawal Reconciliation](../runbooks/withdrawal-reconciliation.md) runbooks.
- **App management.** Create an app with a generated HMAC secret, rotate a secret, and assign or remove a COMMUNITY_ADMIN on the `app_admins` table — closing the manual follow-up noted in the [Admin Membership SOP](../runbooks/admin-membership-sop.md).
- **Webhook management.** Channel and rule create/update/delete plus a test delivery, reusing the signing path in `packages/notifications`.
- **Admin audit log.** A new `admin_audit_log` table records actor, role, action, target, and a before/after payload for every write, with HMAC secrets redacted from the payload. The Ops page renders a viewer; the app detail page shows per-app history. This is the operator-action counterpart to the existing custody controls described in [Custody Ops Controls](../decisions/2026-02-10-custody-ops-controls.md).

## Delivery roadmap

The work ships as three reviewable milestones rather than one large change. A separate implementation-plan document will carry the file-by-file steps.

**Milestone 1 — skeleton and parity.** Stand up the Tailwind/shadcn/tRPC-11 stack and the five-page navigation, then migrate every existing feature (withdrawals table, policy editing, rate-limit change set, backups, monitoring) onto the new stack at feature parity. Update the `admin-dashboard-proof` acceptance harness to the new UI in the same milestone so visual-acceptance CI stays green.

**Milestone 2 — read-only operational surfaces.** Add the Settlements pages (intent list, counts, and a `tip_intent_events` timeline), the liquidity view, the webhook read view, and the app detail aggregation including per-app funds. Switch Overview monitoring to the database-direct path by extracting the worker's ops-summary computation into a shared package, leaving the worker behaviour unchanged via a thin re-export.

**Milestone 3 — write operations and audit.** Add the `admin_audit_log` migration and repository, the guarded intervention transitions, app create/secret-rotate/admin-assignment, webhook CRUD plus test delivery, and the audit wrapper around every mutation with its Ops-page viewer.

## Risks and open questions

- **Proxy header injection on client requests.** The design assumes the auth proxy injects `x-admin-role`/`x-admin-user-id` on XHR calls to `/api/trpc`, not only on document navigations. If it decorates page loads only, mutations fail closed and a fallback (for example mirroring identity into a same-site signed cookie) is needed. This must be verified against the real deployment before Milestone 1 merges.
- **Authentication hardening is deferred.** Replacing the trust-proxy header model with real login/sessions is intentionally out of scope and should be tracked separately.
- **Worker refactor blast radius.** Extracting ops-summary into a shared package touches the worker build. The move must be mechanical and behaviour-preserving, verified by the worker's existing tests and ops-summary output.
- **Withdrawal revival invariant.** The "revive from FAILED" guard depends on the "debit happens at broadcast" model. Repository tests must pin this invariant so a future change cannot silently enable double-payment.
- **Acceptance harness coupling.** The `admin-dashboard-proof` Playwright script asserts the current form actions and flash params. Its rewrite is part of Milestone 1, not a follow-up.

## Related documents

- [Admin Membership Model](../decisions/2026-02-10-admin-membership-model.md) — role definitions reused here.
- [Custody Ops Controls](../decisions/2026-02-10-custody-ops-controls.md) — custody baseline the audit log complements.
- [Withdrawal Policy Operations](../runbooks/withdrawal-policy-operations.md) — current policy-editing procedure.
- [Settlement Recovery](../runbooks/settlement-recovery.md) — manual intervention semantics reused by the console.
- [Compose Ops Monitoring](../runbooks/compose-ops-monitoring.md) — the monitoring path being replaced by database-direct reads.
