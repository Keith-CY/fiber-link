# Deployment Evidence and Log Capture

Issue coverage: `#57` (`W2.4: Standardize deployment evidence and log capture`)

This runbook standardizes how to produce a deployment evidence bundle with one command.

## Required artifacts

Each bundle must include:

- Compose logs
- Node metadata snapshots
- Invoice ID and settlement ID (or tx hash)
- Service status snapshots
- Command log + step status map + acceptance mapping

## One-command bundle generation

From repository root:

```bash
scripts/capture-deployment-evidence.sh \
  --invoice-id <invoice_id> \
  --settlement-id <settlement_id_or_tx_hash>
```

Optional flags:

- `--retention-days <n>` (default `30`)
- `--output-root <path>` (default `deploy/compose/evidence`)
- `--dry-run` (capture plan only)
- `--verbose` (more logs)

Machine-readable result line:

- success: `RESULT=PASS CODE=0 EVIDENCE_DIR=... EVIDENCE_BUNDLE=...`
- failure: `RESULT=FAIL CODE=<11|12> ...`

## Folder template

Canonical template is versioned under:

- `docs/runbooks/evidence-template/deployment/`

Generated bundle structure:

```text
deploy/compose/evidence/<timestamp>/
  commands/
  logs/
  node/
  ids/
  snapshots/
  status/
  metadata/
```

## Checklist

Use the checklist template:

- `docs/runbooks/evidence-template/deployment/checklist.md`

Bundle-local status mapping is generated automatically:

- `status/acceptance-mapping.md`

## Retention policy

- Keep deployment evidence for at least **30 days** by default.
- Keep the full folder and `.tar.gz` archive immutable during retention.
- Archive to long-term ticket/release evidence before cleanup.
- Cleanup only bundles older than threshold:

```bash
find deploy/compose/evidence -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
find deploy/compose/evidence -mindepth 1 -maxdepth 1 -type f -name '*.tar.gz' -mtime +30 -delete
```
