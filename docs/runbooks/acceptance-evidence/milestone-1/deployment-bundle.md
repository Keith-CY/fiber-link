# Milestone 1: Deployment Evidence Bundle

## Artifact source

- Command: `scripts/capture-deployment-evidence.sh`
- Evidence command output: `RESULT=PASS` plus `EVIDENCE_DIR` / `EVIDENCE_BUNDLE` path.

## Public publication target

- Published copy should be stored at:
  - `docs/runbooks/acceptance-evidence/milestone-1/deployment-bundle.md` (this file)

## Required files (from command output)

- `status/acceptance-mapping.md`
- `status/step-results.tsv`
- `commands/command-index.log`
- `logs/compose-services.log`
- `metadata/manifest.json`
- `metadata/retention-policy.md`

## Latest local run

- Date: 2026-02-17
- Command: `scripts/capture-deployment-evidence.sh --invoice-id <invoice> --settlement-id UNSET --verbose`
- Result: `RESULT=PASS CODE=0`
- Evidence directory: `deploy/compose/evidence/20260216T184149Z/`
- Evidence archive: `deploy/compose/evidence/20260216T184149Z.tar.gz`
