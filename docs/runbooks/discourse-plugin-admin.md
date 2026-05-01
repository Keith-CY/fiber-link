# Discourse Admin Runbook for Fiber Link Plugin

Last updated: 2026-04-16
Owner: Fiber Link ops (`@Keith-CY`)

This runbook is for Discourse administrators.

It explains how to:

- install the Fiber Link plugin
- enable it in Discourse admin settings
- connect it to a live Fiber Link backend
- verify that the plugin can actually create invoices

## 1. Scope

This document assumes the Fiber Link backend is already deployed and working.

That backend work is covered in:

- `docs/runbooks/fiber-link-stack-deployment.md`

This document only covers the forum/plugin side.

## 2. What the administrator needs before starting

The Discourse admin should obtain these values from the Fiber Link operator:

- `fiber_link_service_url`
- `fiber_link_app_id`
- `fiber_link_app_secret`

They should also know whether the backend is:

- local/dev
- testnet
- production-like

Operational rule:

- do not invent these values in the Discourse admin panel
- use the exact values provided by the backend operator

## 3. Plugin source and installation path

Plugin source of truth in the monorepo:

- `fiber-link-discourse-plugin/`

Standalone install repository for Discourse admins:

- `https://github.com/Keith-CY/fiber-link-discourse-plugin`

If you are installing from a local checkout of this repository, the plugin directory is:

- `fiber-link-discourse-plugin/`

## 4. Install the plugin into Discourse

From the Discourse app directory:

```bash
cd /path/to/discourse
ln -sfn /path/to/fiber-link/fiber-link-discourse-plugin plugins/fiber-link
```

If using the standalone plugin repository, install it using your normal Discourse plugin workflow.

After the plugin is present, restart/rebuild Discourse according to your hosting method so the plugin is loaded.

## 5. Enable the plugin in Discourse admin settings

In Discourse admin:

- go to `Admin -> Settings -> Plugins`
- find the Fiber Link settings

Set:

- `fiber_link_enabled = true`
- `fiber_link_service_url = <reachable RPC URL>`
- `fiber_link_app_id = <app id provided by backend operator>`
- `fiber_link_app_secret = <shared secret provided by backend operator>`

Typical examples:

- local/dev: `http://127.0.0.1:3000`
- public/testnet/prod: `https://<your-rpc-domain>`

Important:

- `fiber_link_service_url` must be reachable from where Discourse is running
- if Discourse is in Docker/Coolify, `127.0.0.1` usually means the Discourse container itself, not the Fiber Link backend

## 6. How plugin auth pairing works

The plugin uses:

- `fiber_link_app_id`
- `fiber_link_app_secret`

These must match what RPC expects.

RPC validation order is:

1. app secret from persisted app row in the backend database
2. matching entry in `FIBER_LINK_HMAC_SECRET_MAP`
3. fallback `FIBER_LINK_HMAC_SECRET`

Why this matters:

- the plugin can be installed correctly but still fail every request if the app id / secret pair does not match the backend auth source

## 7. Minimum connectivity verification

After enabling the plugin, verify more than just “settings saved”.

Minimum checks:

- plugin loads in Discourse without obvious frontend errors
- a tip button or plugin UI entry point is visible where expected
- invoice creation works from the UI
- backend accepts the signed request

If possible, test with a real post/reply flow:

1. open a topic/post with the Fiber Link UI visible
2. click the tip action
3. attempt invoice generation
4. confirm the invoice is returned successfully

This is the minimum meaningful plugin verification.

## 8. What “working” actually means

The plugin is not considered correctly connected just because:

- Discourse boots
- the plugin appears in admin
- the setting panel saves

The plugin is only operationally ready when:

- it can send a signed request to the backend
- the backend accepts it
- invoice generation succeeds

## 9. Common failure modes

### Failure mode 1 — wrong `fiber_link_service_url`

Symptoms:

- plugin enabled but requests fail
- timeouts / connection refused / unreachable behavior

Typical causes:

- using `127.0.0.1` from inside a containerized Discourse setup
- using the wrong public hostname
- TLS/ingress not ready yet

Action:

- verify the exact reachable URL from the Discourse runtime context

### Failure mode 2 — wrong app id / secret pair

Symptoms:

- request reaches backend but is rejected as unauthorized

Action:

- confirm with backend operator which auth source is active
- re-enter exact `fiber_link_app_id` and `fiber_link_app_secret`

### Failure mode 3 — forum is up but payment path is still broken

Symptoms:

- UI renders
- invoice flow fails

Action:

- treat this as an integration problem, not a UI-only problem
- verify backend signed RPC behavior directly
- verify the plugin values in admin settings

### Failure mode 4 — Discourse hosting platform adds its own networking confusion

Symptoms:

- plugin settings look right but runtime connectivity differs between host/container/public URL

Action:

- verify from the actual Discourse runtime context
- do not assume host-local addresses work inside the app runtime

## 10. Admin checklist

### Installation

- [ ] plugin files are installed into Discourse
- [ ] Discourse restarted/rebuilt successfully
- [ ] plugin appears in admin plugin settings

### Configuration

- [ ] `fiber_link_enabled` is set to `true`
- [ ] `fiber_link_service_url` matches the live backend endpoint
- [ ] `fiber_link_app_id` matches the backend-provided app id
- [ ] `fiber_link_app_secret` matches the backend-provided app secret

### Verification

- [ ] plugin UI is visible where expected
- [ ] invoice generation succeeds from the forum UI
- [ ] no auth mismatch or connectivity error is observed in logs

## 11. Escalation path

If the plugin still does not work after following this document, escalate in this order:

1. verify backend status with the Fiber Link operator
2. verify exact service URL reachability from the Discourse runtime
3. verify app id / secret pairing against the backend auth source
4. only after that investigate plugin-specific frontend behavior

## 12. Relationship to backend deployment

This runbook depends on the backend being healthy first.

If the plugin cannot create an invoice, always check the backend deployment runbook next:

- `docs/runbooks/fiber-link-stack-deployment.md`
