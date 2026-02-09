# Decision: Admin Membership Model (BetterAuth -> app_admins)

Date: 2026-02-10 (scheduled)
Owner: Fiber Link
Status: OPEN
Related: `docs/plans/2026-02-09-3-year-strategy-design.md`

## Decision

Confirm the admin permission model and membership management approach for Fiber Link's hosted multi-tenant admin surface:
- how `COMMUNITY_ADMIN` access is scoped (which tenants/apps they can see)
- how memberships are created/revoked/audited

This decision is about data scope and operations, not UI polish.

## Context

Year 1 targets hosted multi-tenant operations for 10 active communities. Admin access must be:
- safe by default (no accidental cross-tenant data exposure)
- operable by a small team (membership changes are not a product project in Year 1)
- evolvable to self-serve (Year 2)

Current implementation direction (already in code paths):
- Admin requests derive identity from BetterAuth (for example `ctx.adminUserId`).
- `COMMUNITY_ADMIN` queries are scoped via an `app_admins` membership mapping.

The open question is whether this scoping is the desired model and how memberships are managed.

## Options

### Option A: Mixed model (recommended)

- Roles:
  - `SUPER_ADMIN`: global access (all apps, all withdrawals, risk controls, membership admin)
  - `COMMUNITY_ADMIN`: scoped access based on `app_admins` mapping (only the apps they belong to)
- Membership management:
  - Year 1: manual + auditable (seed script / DB migration / admin-only endpoint)
  - Year 2: self-serve UI (invite/revoke flows, audit logs, and ownership transfer)

### Option B: Global `COMMUNITY_ADMIN`

- `COMMUNITY_ADMIN` can see all apps/withdrawals.
- Only `SUPER_ADMIN` is more privileged.

This is simplest but is high risk (easy data exposure) and does not match a multi-tenant posture.

### Option C: Per-community admin as a separate identity system (avoid)

- Community admins are managed by Discourse (or other host platform identities), then mapped to BetterAuth.

This adds integration and lifecycle complexity early and is not required for Year 1 reliability goals.

## Recommendation

Adopt Option A (mixed model):
- `COMMUNITY_ADMIN` remains scoped by `app_admins` memberships keyed on BetterAuth identity.
- `SUPER_ADMIN` is the only global role.
- Membership management in Year 1 is operational (manual but auditable), not a full product feature.

## Decision Criteria

Approve a model that:
- cannot leak cross-tenant data by default
- supports a low-touch Year 1 workflow for adding/removing admins
- has a clear upgrade path to self-serve without breaking auditability

## Decision Meeting (30-45 min)

Agenda:
1. Confirm role list and privileges (SUPER_ADMIN vs COMMUNITY_ADMIN).
2. Confirm scoping rule:
   - COMMUNITY_ADMIN can see only apps present in `app_admins` for `adminUserId`.
3. Confirm Year 1 membership management path (choose one):
   - seed script / migration
   - admin-only endpoint restricted to SUPER_ADMIN
4. Confirm audit expectations:
   - who changed membership, when, and why (free-form note)

Outputs:
- a written role/permission table
- a Year 1 membership change SOP (steps + rollback)

## Follow-Ups (After Decision)

- Add explicit tests for:
  - COMMUNITY_ADMIN cannot list apps/withdrawals outside membership
  - SUPER_ADMIN can list all
- Add an audit table for membership changes (or an audit log sink) and include it in the runbook.
- Define membership lifecycle states (active/revoked) and the minimal UI surface for Year 2.
