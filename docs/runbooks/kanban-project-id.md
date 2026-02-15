# Kanban Project ID Resolution

This runbook documents how the Kanban workflows resolve `projectId`, including the fallback ID used for recovery.

## Workflows

- `.github/workflows/carrier-kanban-automation.yml`
- `.github/workflows/carrier-kanban-operations.yml`

Both workflows use the shared helper:

- `.github/scripts/kanban-project-id.js`

## Resolution order

`carrier-kanban-automation.yml` checks candidates in this order:

1. `secrets.FIBER_LINK_PROJECT_ID`
2. `vars.FIBER_LINK_CANONICAL_PROJECT_ID`
3. hardcoded fallback `DEFAULT_PROJECT_ID` (`PVT_kwHOAG7zoc4BPPlp`)

`carrier-kanban-operations.yml` checks candidates in this order:

1. `secrets.FIBER_LINK_PROJECT_ID`
2. `vars.FIBER_LINK_CANONICAL_PROJECT_ID`
3. `.github/kanban-config.json` -> `projectId`
4. hardcoded fallback `DEFAULT_PROJECT_ID` (`PVT_kwHOAG7zoc4BPPlp`)

## When to rotate/update

Rotate/update project ID sources when one of these happens:

- Kanban board moved to a new GitHub ProjectV2.
- Existing ProjectV2 ID is archived, deleted, or inaccessible.
- Ownership moved to another user/org/repo scope.

## Rotation procedure

1. Update `vars.FIBER_LINK_CANONICAL_PROJECT_ID` in repository variables.
2. Update `.github/kanban-config.json` `projectId`.
3. Update `DEFAULT_PROJECT_ID` in `.github/scripts/kanban-project-id.js`.
4. Run `carrier-kanban-operations.yml` with `dry_run=true` and verify project lookup succeeds.
5. Trigger or wait for `carrier-kanban-automation.yml` and verify item sync succeeds.

## Notes

- URL candidates like `https://github.com/orgs/<org>/projects/<number>` are supported and resolved to node IDs via GraphQL.
- If no candidate resolves, automation skips sync and operations marks the run failed with explicit guidance.
