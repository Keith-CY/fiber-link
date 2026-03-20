# Withdrawal Policy Operations

This runbook defines the production operator workflow for reviewing and updating per-app withdrawal controls.

## Scope

The command manages `withdrawal_policies` rows for:

- allowed assets
- max per request
- per-user daily max
- per-app daily max
- cooldown seconds

The admin web dashboard now supports browser-based policy review and edits for day-to-day operator work. Keep the script below for automation, ticket attachments, rollback records, and any change that needs structured JSON output plus a trusted actor trail.

## Prerequisites

- `DATABASE_URL` points to the target environment
- `ADMIN_ROLE` is `SUPER_ADMIN` or `COMMUNITY_ADMIN`
- `ADMIN_USER_ID` is the trusted operator identity recorded in `updated_by`

## Review Current Policy State

Use the dashboard first when an operator needs a quick visual diff of current app policies:

```bash
cd fiber-link-service/apps/admin
bun run dev -- --hostname 127.0.0.1 --port 4318
```

By default the dashboard expects `x-admin-role` and `x-admin-user-id` to be injected by the caller or upstream proxy. For local proof/demo mode you can point it at the bundled fixture:

```bash
cd fiber-link-service/apps/admin
ADMIN_DASHBOARD_DEFAULT_ROLE=SUPER_ADMIN \
ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID=proof-admin \
ADMIN_DASHBOARD_FIXTURE_PATH=./fixtures/dashboard-proof.json \
bun run dev -- --hostname 127.0.0.1 --port 4318
```

Use the CLI path below when you need structured JSON attached to a ticket or release record.

```bash
ADMIN_ROLE=SUPER_ADMIN \
ADMIN_USER_ID=ops-admin-1 \
DATABASE_URL=postgresql://... \
bun run fiber-link-service/apps/admin/src/scripts/manage-withdrawal-policy.ts list
```

This returns JSON with:

- `actor`
- `generatedAt`
- `policies[]`

Attach the JSON output to the change request or release ticket.

## Upsert a Policy

Use the browser UI for scoped edits when an operator wants immediate confirmation of asset allowlists, thresholds, and cooldowns. Use the CLI path below when the change must be captured as structured output.

```bash
ADMIN_ROLE=SUPER_ADMIN \
ADMIN_USER_ID=ops-admin-1 \
DATABASE_URL=postgresql://... \
bun run fiber-link-service/apps/admin/src/scripts/manage-withdrawal-policy.ts upsert \
  --app-id=community-a \
  --allowed-assets=CKB,USDI \
  --max-per-request=5000 \
  --per-user-daily-max=20000 \
  --per-app-daily-max=200000 \
  --cooldown-seconds=120
```

For `COMMUNITY_ADMIN`, the command is scoped by `app_admins` membership and will fail if the actor does not manage the target app.

## Change-Control Expectations

- prefer the browser UI for quick review/diff of current settings before editing
- review current values with `list` before any edit
- record the prior JSON payload in the ticket so rollback values are explicit
- require non-empty `ADMIN_USER_ID` for every production upsert
- use small, reviewable policy changes; do not mix unrelated app changes in one command

## Rollback

Rollback is another `upsert` using the last known-good values from the captured JSON output.

If the wrong values were written:

1. rerun `list` to confirm current persisted state
2. rerun `upsert` with the last approved values
3. attach both before/after JSON payloads to the incident or release record
