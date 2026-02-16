# Docs Index

## Plugin testing

- `docs/runbooks/phase2-verification.md` — end-to-end verification flow for service and plugin changes.
- `scripts/plugin-smoke.sh` — local Discourse plugin smoke test entrypoint that runs in Docker (no local Ruby required).

## Milestone 1 demo

- Public Discourse instance: https://talk.nervos.org
- Milestone 1 discoverable thread: https://talk.nervos.org/t/dis-fiber-link-a-ckb-fiber-based-pay-layer-tipping-micropayments-for-communities/9845
- Last verified: 2026-02-16

## Testnet bootstrap

- `docs/runbooks/testnet-bootstrap.md` — deterministic precheck -> spin-up -> RPC validation -> invoice smoke -> cleanup flow.

## Testnet smoke

- `docs/runbooks/compose-reference.md` — compose reference and deterministic smoke usage.
- `scripts/testnet-smoke.sh` — one-command local testnet sanity check with machine-readable PASS/FAIL output.

## Deployment evidence

- `docs/runbooks/deployment-evidence.md` — deployment evidence artifacts, checklist, and retention policy.
- `scripts/capture-deployment-evidence.sh` — one-command evidence and log capture bundle.

## W5 demo evidence

- `docs/runbooks/w5-demo-evidence.md` — reproducible W5 demo evidence flow, naming convention, and stakeholder checklist.
- `scripts/capture-w5-demo-evidence.sh` — one-command W5 demo evidence bundle with key IDs and pass/fail checks.

## Security assumptions

- `docs/runbooks/security-assumptions.md` — versioned trust assumptions, operational limits, fallback boundaries, and ownership contacts.
- `docs/runbooks/threat-model-evidence-checklist.md` — W1 threat-control verification checklist, acceptance matrix, and evidence retention/sign-off rules.

## Kanban operations

- `docs/runbooks/kanban-project-id.md` — project ID resolution order, fallback ID ownership, and rotation procedure.

### Request-spec coverage tracked in CI

The CI `plugin-smoke` job runs:

- `plugins/fiber-link/spec/requests/fiber_link_spec.rb`
- `plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb`

System specs are optional and can be opted into via `PLUGIN_SMOKE_EXTRA_SPECS` when invoking
`scripts/plugin-smoke.sh` locally or by setting the same variable in CI.
