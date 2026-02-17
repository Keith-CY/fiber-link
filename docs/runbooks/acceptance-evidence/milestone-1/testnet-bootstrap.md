# Milestone 1: Testnet Bootstrap Result

## Artifact source

- Command: `scripts/testnet-smoke.sh`
- Expected output: `RESULT=PASS` and generated `.tmp/testnet-smoke/<timestamp>/` artifacts.

## Public publication target

- Published copy should be stored at:
  - `docs/runbooks/acceptance-evidence/milestone-1/testnet-bootstrap.md` (this file)

## Required checks

- Checkpoint 1 `precheck` passed.
- Checkpoint 2 services became healthy/running.
- Checkpoint 3 `health.ping` returned `"status":"ok"`.
- Checkpoint 4 `tip.create` returned non-empty `invoice`.
- Checkpoint 5 logs archived and clean shutdown.

## Latest local run

- Date: 2026-02-17
- Command: `scripts/testnet-smoke.sh --verbose`
- Result: `RESULT=PASS CODE=0`
- Artifact directory: `.tmp/testnet-smoke/20260217-033951/`
