# Compose Backup and Recovery

Owner: Fiber Link ops (`@Keith-CY`)
Last updated: 2026-03-18

This runbook adds a repeatable backup and restore flow for the compose deployment path. It is the minimum release-gate backup flow for self-hosted environments.

## Scope

The backup bundle captures:

- a logical PostgreSQL dump with `--clean --if-exists --create`
- the worker settlement cursor file
- compose config and service status snapshots
- container metadata for the main stateful services
- retention metadata and a replayable command log

This is not point-in-time recovery and it does not replace database replication, offsite storage, or full node-data backup.

## Backup Command

From repository root:

```bash
scripts/capture-compose-backup.sh
```

Optional flags:

- `--output-root <path>`: override output root (default `deploy/compose/backups`)
- `--retention-days <n>`: override retention policy days (default `BACKUP_RETENTION_DAYS` from `deploy/compose/.env`, otherwise `30`)
- `--dry-run`: create a placeholder bundle and command plan without docker side effects
- `--verbose`: print progress logs

Success output:

```text
RESULT=PASS CODE=0 BACKUP_DIR=... BACKUP_ARCHIVE=...
```

Generated bundle layout:

```text
deploy/compose/backups/<UTC_TIMESTAMP>/
  commands/
  db/
  metadata/
  runtime/
  snapshots/
  status/
```

## Restore Command

Restore is destructive for the target compose database. Run it only after validating the chosen backup source.

From repository root:

```bash
scripts/restore-compose-backup.sh \
  --backup deploy/compose/backups/<UTC_TIMESTAMP>.tar.gz \
  --yes
```

Optional flags:

- `--dry-run`: write restore logs and command plan without docker side effects
- `--verbose`: print progress logs

Success output:

```text
RESULT=PASS CODE=0 BACKUP_SOURCE=... RESTORE_MODE=...
```

## Restore Rehearsal

For each release window:

1. Create a fresh backup bundle with `scripts/capture-compose-backup.sh`.
2. Restore the bundle in a staging or rehearsal environment with `scripts/restore-compose-backup.sh --backup <dir-or-archive> --yes`.
3. Re-run compose health checks:

```bash
docker compose -f deploy/compose/docker-compose.yml ps
curl -fsS http://127.0.0.1:${RPC_PORT:-3000}/healthz/ready
```

4. Verify the backup contained the expected policy and withdrawal state:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select count(*) from withdrawals;"
```

5. Attach the `BACKUP_DIR` or `BACKUP_ARCHIVE` path to the release ticket along with the restore rehearsal timestamp.

## Operational Notes

- The restore flow stops `rpc` and `worker` before replaying the PostgreSQL dump, then starts them again after restore.
- If the worker cursor backup contains `UNSET`, cursor restore is skipped.
- Keep generated backup bundles outside git history; `deploy/compose/backups/` is ignored by this repository.
- Promote the generated `.tar.gz` archive to long-term storage before local cleanup.

## Current Limits

- No offsite copy, PITR, or WAL shipping is configured here.
- FNN node volumes are not included in this backup bundle.
- Monitoring and alerting for backup success/failure are still separate follow-up work.
