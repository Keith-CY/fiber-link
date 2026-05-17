# Compose Backup and Recovery

Owner: Fiber Link ops (`@Keith-CY`)
Last updated: 2026-03-18

This runbook adds a repeatable backup and restore flow for the compose deployment path. It is the minimum release-gate backup flow for self-hosted environments.

## Scope

The backup bundle captures:

- a logical PostgreSQL dump with `--clean --if-exists --create`
- the worker settlement cursor file
- compose config and service status snapshots
- container metadata for the main stateful services, including FNN/FNN2
- optional FNN/FNN2 `/data` volume tarballs when `--include-fnn-state` is used
- retention metadata, a replayable command log, a manifest, and SHA-256 checksums

This is not point-in-time recovery and it does not replace database replication, offsite storage, or full node-data backup.

## Backup Command

From repository root:

```bash
scripts/capture-compose-backup.sh
```

Optional flags:

- `--output-root <path>`: override output root (default `deploy/compose/backups`)
- `--retention-days <n>`: override retention policy days (default `BACKUP_RETENTION_DAYS` from `deploy/compose/.env`, otherwise `30`)
- `--include-fnn-state`: include `fiber-link-fnn` and `fiber-link-fnn2` `/data` volume tarballs (`fnn/data.tar.gz`, `fnn2/data.tar.gz`) in addition to metadata
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
  fnn/
  fnn2/
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

Restore validates `metadata/manifest.json`, `status/step-results.tsv`, and `metadata/checksums.sha256` before any restore command is planned. Live restore refuses bundles produced with `--dry-run`. If the manifest says FNN state was included, restore also requires `fnn/data.tar.gz` and `fnn2/data.tar.gz` and replays those tarballs before the application services are started.

## Restore Rehearsal

For each release window:

1. Create a fresh backup bundle with `scripts/capture-compose-backup.sh`.
2. Restore the bundle in a staging or rehearsal environment with `scripts/restore-compose-backup.sh --backup <dir-or-archive> --yes`.
3. Re-run compose health checks:

```bash
docker compose -f deploy/compose/docker-compose.yml ps
curl -fsS http://127.0.0.1:${RPC_PORT:-3000}/healthz/ready
```

4. Verify the backup integrity and expected policy/state before promoting it:

```bash
cd deploy/compose/backups/<UTC_TIMESTAMP>
sha256sum -c metadata/checksums.sha256
jq '.schemaVersion, .overallStatus, .includeFnnState' metadata/manifest.json
```

5. Verify the restored database contains the expected withdrawal state:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select count(*) from withdrawals;"
```

6. Attach the `BACKUP_DIR` or `BACKUP_ARCHIVE` path to the release ticket along with the restore rehearsal timestamp.

## Operational Notes

- The restore flow stops `rpc` and `worker` before replaying the PostgreSQL dump, then starts them again after restore.
- If `--include-fnn-state` was used during capture, restore stops `fnn` and `fnn2`, extracts the saved `/data` tarballs into their volumes, then starts those services before `rpc`/`worker`.
- If the worker cursor backup contains `UNSET`, cursor restore is skipped.
- Keep generated backup bundles outside git history; `deploy/compose/backups/` is ignored by this repository.
- Promote the generated `.tar.gz` archive to long-term storage before local cleanup.

## Current Limits

- No offsite copy, PITR, or WAL shipping is configured here.
- FNN node volume capture is opt-in with `--include-fnn-state`; use it for release-gate backups that must preserve node state, and ensure the archive is stored securely because it may contain sensitive node data.
- Monitoring and alerting for backup success/failure are still separate follow-up work.
