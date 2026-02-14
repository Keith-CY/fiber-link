# Docs Index

## Plugin testing

- `docs/runbooks/phase2-verification.md` — end-to-end verification flow for service and plugin changes.
- `scripts/plugin-smoke.sh` — local Discourse plugin smoke test entrypoint that runs in Docker (no local Ruby required).

### Request-spec coverage tracked in CI

The CI `plugin-smoke` job runs:

- `plugins/fiber-link/spec/requests/fiber_link_spec.rb`
- `plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb`

System specs are optional and can be opted into via `PLUGIN_SMOKE_EXTRA_SPECS` when invoking
`scripts/plugin-smoke.sh` locally or by setting the same variable in CI.
