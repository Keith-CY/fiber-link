# E2E: Discourse Four Flows (Docker + Forum + Explorer Proof)

This runbook verifies the 4 required flows end-to-end on local Docker services + local Discourse:

1. Tip button and modal UI on topic page.
2. Discourse-integrated backend interfaces (`tip.create`, `tip.status`, `dashboard.summary`, `withdrawal.request`).
3. Settlement strategy coverage (`subscription` and `polling`).
4. Creator balance/history panel, withdrawal completion, and blockchain explorer transaction screenshot.

## Prerequisites

- Docker Desktop running.
- Local dependencies used by existing scripts are available (`jq`, `expect`, `curl`, `openssl`, `tar`).
- Playwright CLI wrapper available at:
  - `~/.codex/skills/playwright/scripts/playwright_cli.sh`
- Compose env configured:
  - `deploy/compose/.env`
- Optional (if you want to pin withdrawal signer instead of auto-generated one):
  - `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=0x...`

## Required Explorer URL Template

Set one of the following before running:

```bash
export E2E_EXPLORER_TX_URL_TEMPLATE='https://pudge.explorer.nervos.org/transaction/{txHash}'
```

Template supports `{txHash}` or `%s` placeholder.

## Local port layout

- `discourse_dev` usually owns host `3000`, `4200`, and `9292`.
- E2E helpers therefore default Fiber Link RPC to host port `13001`.
- Seeded plugin service URLs use `http://host.docker.internal:13001` so the Discourse container can reach that RPC endpoint.

## Run Main E2E Script

```bash
scripts/e2e-discourse-four-flows.sh
```

Useful options:

```bash
scripts/e2e-discourse-four-flows.sh \
  --headless \
  --settlement-modes subscription,polling \
  --artifact-dir .tmp/e2e-discourse-four-flows/manual-run
```

## Capture + Archive Evidence

Run e2e and generate evidence bundle:

```bash
scripts/capture-e2e-discourse-four-flows-evidence.sh \
  --explorer-tx-url-template "${E2E_EXPLORER_TX_URL_TEMPLATE}" \
  --headless
```

Package existing artifact directory only:

```bash
scripts/capture-e2e-discourse-four-flows-evidence.sh \
  --skip-run \
  --artifact-dir .tmp/e2e-discourse-four-flows/<UTC_TIMESTAMP>
```

## Withdrawal Signer Behavior

- Browser-driven withdrawal still needs a signer on the running backend. The browser only submits `withdrawal.request`; `rpc`/`worker` must already have `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY` before the request can succeed.
- If `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY` is not provided, e2e script will:
  - generate a testnet signer private key,
  - derive `ckt1...` address,
  - request faucet funding (with fallback endpoint),
  - restart `rpc`/`worker` with the signer key injected.
- Signer cache file:
  - `.tmp/e2e-discourse-four-flows/withdrawal-signer.json`

## Expected Artifacts

Under `.tmp/e2e-discourse-four-flows/<UTC_TIMESTAMP>/`:

- `screenshots/flow1-tip-button.png`
- `screenshots/flow1-tip-modal-invoice.png`
- `screenshots/flow4-author-balance-history.png`
- `screenshots/flow4-admin-withdrawal.png`
- `screenshots/flow4-explorer-withdrawal-tx.png`
- `artifacts/flow2-rpc-calls.json`
- `artifacts/flow3-subscription.json`
- `artifacts/flow3-polling.json`
- `artifacts/summary.json`
- `status/verification-checklist.md`
- `commands/command-index.log`

Captured bundle output under:

- `deploy/compose/evidence/e2e-discourse-four-flows/<UTC_TIMESTAMP>/`
- `deploy/compose/evidence/e2e-discourse-four-flows/<UTC_TIMESTAMP>.tar.gz`

## Troubleshooting

- Missing explorer screenshot:
  - Verify `E2E_EXPLORER_TX_URL_TEMPLATE` is valid and reachable.
- Postcheck cannot request withdrawal:
  - Ensure local Discourse session can access `/fiber-link/rpc` and plugin settings are seeded.
- Polling strategy check fails:
  - Check worker health and logs after strategy switch in `logs/worker-polling.log`.
- Withdrawal reaches `FAILED` with signer error:
  - Check `artifacts/flow2-withdrawal-request.response.json` and `logs/worker-subscription.log`.
  - Ensure faucet endpoints are reachable, or set `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY` explicitly before the browser tries `withdrawal.request`.
