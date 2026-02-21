# Docs Index

## Roadmap tracking

- `docs/current-architecture.md` — canonical source-of-truth index for architecture, current status, and historical redirects.
- `docs/plans/2026-02-21-issue-32-epic-closeout.md` — latest closeout mapping for epic `#32`.
- `docs/plans/2026-02-17-issue-32-epic-execution-status-tracker.md` — superseded historical status snapshot retained for traceability.

## Plugin testing

- `docs/runbooks/phase2-verification.md` — end-to-end verification flow for service and plugin changes.
- `scripts/plugin-smoke.sh` — local Discourse plugin smoke test entrypoint that runs in Docker (no local Ruby required).

## W4 integration tracking

- `docs/runbooks/w4-integration-status-2026-02-17.md` — issue #36 W4 subtask matrix, completion snapshot, and verification/operations checks as of 2026-02-17.

## Admin installation

- `docs/admin-installation.md` — admin installation and verification flow for Discourse + compose deployment.

## Milestone acceptance

- `docs/acceptance/README.md` — canonical milestone acceptance tracker.
- `docs/acceptance/source-inventory.md` — full docs inventory and acceptance mapping.
- `docs/acceptance/milestone-1/index.md` — Milestone 1 checkpoints and acceptance gate.
- `docs/acceptance/milestone-2/index.md` — Milestone 2 checkpoints and acceptance gate.
- `docs/acceptance/milestone-3/index.md` — Milestone 3 checkpoints and acceptance gate.

## Testnet bootstrap

- `docs/runbooks/testnet-bootstrap.md` — deterministic precheck -> spin-up -> RPC validation -> invoice smoke -> cleanup flow.

## Testnet smoke

- `docs/runbooks/compose-reference.md` — compose reference and deterministic smoke usage.
- `scripts/testnet-smoke.sh` — one-command local testnet sanity check with machine-readable PASS/FAIL output.
- `docs/runbooks/fiber-adapter-e2e.md` — end-to-end validation for `fiber-adapter -> fnn rpc` in docker network.
- `scripts/e2e-fiber-adapter-docker.sh` — runnable entrypoint for the `fiber-adapter` docker e2e probe.

## Deployment evidence

- `docs/runbooks/deployment-evidence.md` — deployment evidence artifacts, checklist, and retention policy.
- `scripts/capture-deployment-evidence.sh` — one-command evidence and log capture bundle.

## Security assumptions

- `docs/runbooks/security-assumptions.md` — versioned trust assumptions, operational limits, fallback boundaries, and ownership contacts.
- `docs/runbooks/threat-model-evidence-checklist.md` — W1 threat-control verification checklist, acceptance matrix, and evidence retention/sign-off rules.
- `#114` (`Milestone 1 proof`): external public proof issue for non-repo evidence tracking.
- Final Milestone 1 acceptance references should use the latest public evidence update posted in `#114`.

## Kanban operations

- `docs/runbooks/kanban-project-id.md` — project ID resolution order, fallback ID ownership, and rotation procedure.

### Request-spec coverage tracked in CI

The CI `plugin-smoke` job runs:

- `plugins/fiber-link/spec/requests/fiber_link_spec.rb`
- `plugins/fiber-link/spec/requests/fiber_link/rpc_controller_spec.rb`

System specs are optional and can be opted into via `PLUGIN_SMOKE_EXTRA_SPECS` when invoking
`scripts/plugin-smoke.sh` locally or by setting the same variable in CI.
