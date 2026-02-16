# W5 Demo Reproducibility and Evidence Capture

Issue coverage: `#53` (`W5.3: Add demo reproducibility and evidence capture`)

This runbook defines a one-command way to generate a replayable W5 demo evidence bundle.

## What the bundle contains

- Exact command log and per-step pass/fail status.
- `w5-demo.ts` evidence JSON, extracted summary JSON, and trace JSONL.
- Stakeholder verification checklist with pass/fail signals.
- Key IDs:
  - invoice id
  - tip intent id
  - payment request id / tx hash
  - withdrawal request id / tx hash
- Optional screenshots copied with normalized names.

## One-command generation

From repository root:

```bash
scripts/capture-w5-demo-evidence.sh --mode dry-run
```

Live run example:

```bash
scripts/capture-w5-demo-evidence.sh \
  --mode live \
  --fixture-file /abs/path/to/w5.fixture.json \
  --screenshot /abs/path/to/dashboard.png
```

Optional flags:

- `--output-root <path>` (default `deploy/compose/evidence/w5-demo`)
- `--retention-days <n>` (default `30`)
- `--dry-run` (plan only; does not execute demo)
- `--verbose`

Terminal output format:

- success: `RESULT=PASS CODE=0 EVIDENCE_DIR=... EVIDENCE_BUNDLE=...`
- failure: `RESULT=FAIL CODE=<code> MESSAGE=<msg> EVIDENCE_DIR=... EVIDENCE_BUNDLE=...`

## Normalized naming convention

Generated bundle structure:

```text
deploy/compose/evidence/w5-demo/<UTC_TIMESTAMP>/
  commands/
    command-index.log
  logs/
    00-git-head.stdout.log
    00-git-head.stderr.log
    00-git-branch.stdout.log
    00-git-branch.stderr.log
    01-w5-demo.stdout.log
    01-w5-demo.stderr.log
  artifacts/
    01-w5-demo.evidence.json
    02-w5-demo.summary.json
    03-w5-demo.trace.jsonl
  status/
    step-results.tsv
    verification-checklist.md
  screenshots/
    01-stakeholder-capture.<ext>
    02-stakeholder-capture.<ext>
  metadata/
    manifest.json
    retention-policy.md
```

## Stakeholder verification checklist

Use `status/verification-checklist.md` as sign-off source.

Required PASS checks:

- demo command completed
- settlement reached `SETTLED`
- settlement credit verification passed
- withdrawal completed (`COMPLETED`)
- final balance verification passed
- all key IDs captured

If any check fails, treat the demo as non-accepting and attach logs + summary for triage.
