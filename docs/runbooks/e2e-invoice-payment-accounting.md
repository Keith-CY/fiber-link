# E2E: Invoice -> Payment -> Accounting (CKB + USDI)

This runbook executes one end-to-end script that now uses **two FNN nodes**:

- `fnn` (invoice node, used by `rpc/worker` service)
- `fnn2` (payer node, used to execute `send_payment`)

Full e2e flow:

1. start docker services (`fnn`, `fnn2`, `rpc`, `worker`, `postgres`, `redis`)
2. request CKB faucet funds for both nodes
3. establish channel (`fnn2 -> fnn`) and wait until `ChannelReady`
4. request faucet funds for payment assets (CKB + USDI)
5. create invoice (`tip.create`)
6. pay invoice from `fnn2`
7. confirm bill completion (`tip.status` reaches `SETTLED`)

Script:

```bash
scripts/e2e-invoice-payment-accounting.sh
```

## Required prerequisites

- `docker` + `docker compose` v2
- `curl`, `openssl`, `awk`, `jq`, `python3`
- `deploy/compose/.env` created and required secrets filled

## Required environment variables

The script reads compose settings from `deploy/compose/.env`, and needs runtime env values:

```bash
# payer node (fnn2) CKB top-up address, optional if auto-derived from node_info
export E2E_CKB_TOPUP_ADDRESS="<ckb testnet address>"

# invoice node (fnn) CKB top-up address, optional if auto-derived from node_info
export E2E_CKB_INVOICE_TOPUP_ADDRESS="<ckb testnet address>"

# payer node USDI top-up address, optional (defaults to E2E_CKB_TOPUP_ADDRESS)
export E2E_USDI_TOPUP_ADDRESS="<usdi topup address>"

# optional override for full e2e (CKB+USDI), script has built-in default
export E2E_USDI_FAUCET_COMMAND='curl -fsS -X POST https://ckb-utilities.random-walk.co.jp/api/faucet -H "content-type: application/json" -d "{\"address\":\"${E2E_FAUCET_ADDRESS}\",\"token\":\"usdi\"}"'
```

`E2E_USDI_FAUCET_COMMAND` receives:

- `E2E_FAUCET_ASSET` (`USDI`)
- `E2E_FAUCET_ADDRESS` (payer top-up address)
- `E2E_FAUCET_AMOUNT` (requested faucet amount)

## Optional tuning

```bash
export E2E_APP_ID="local-dev"
export E2E_CKB_PAYMENT_AMOUNT=1
export E2E_USDI_PAYMENT_AMOUNT=1
export CKB_FAUCET_AMOUNT=100000
export CKB_FAUCET_WAIT_SECONDS=20
export E2E_CKB_RPC_URL=https://testnet.ckbapp.dev/
export USDI_FAUCET_AMOUNT=20
export USDI_FAUCET_WAIT_SECONDS=20
export E2E_USDI_BALANCE_CHECK_LIMIT_PAGES=20

# channel bootstrap
export E2E_CHANNEL_FUNDING_AMOUNT=10000000000
export E2E_CHANNEL_TLC_FEE_PROPORTIONAL_MILLIONTHS=0x4B0
export E2E_ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX=0x24e160300
export E2E_TOPUP_INVOICE_NODE_CKB=0
export E2E_SKIP_CKB_FAUCET=0
export E2E_CKB_PAYMENT_FAUCET_ON_FLOW=0
export CHANNEL_READY_TIMEOUT_SECONDS=600
export CHANNEL_POLL_INTERVAL_SECONDS=5

export WAIT_TIMEOUT_SECONDS=600
export SETTLEMENT_TIMEOUT_SECONDS=180
export SETTLEMENT_POLL_INTERVAL_SECONDS=5
```

## Run examples

```bash
# full e2e (CKB + USDI)
scripts/e2e-invoice-payment-accounting.sh --verbose

# only bootstrap local manual environment (2 FNN + channel), keep stack up
scripts/local-dual-fnn-env.sh --verbose

# equivalent low-level command for manual bootstrap
scripts/e2e-invoice-payment-accounting.sh --prepare-only --keep-up --verbose
```

## Local manual test environment

Use the helper script below to bring up the full local stack and establish channel between `fnn2` and `fnn`:

```bash
scripts/local-dual-fnn-env.sh
```

After it prints `RESULT=PASS`, manual testing can proceed against local ports (default):

- invoice node RPC: `http://127.0.0.1:8227` (`fnn`)
- payer node RPC: `http://127.0.0.1:9227` (`fnn2`)
- service RPC endpoint: `http://127.0.0.1:3000/rpc`

Notes:

- default `E2E_TOPUP_INVOICE_NODE_CKB=0` skips invoice-node faucet request to avoid CKB faucet IP/day quota conflicts.
- set `E2E_SKIP_CKB_FAUCET=1` when payer already has enough CKB and public faucet is rate-limited.
- default `E2E_CKB_PAYMENT_FAUCET_ON_FLOW=0` avoids a second CKB faucet request in the same run.
- USDI flow does a pre-check via CKB indexer (`get_cells`) and skips faucet when payer balance already meets payment amount.
- set `E2E_TOPUP_INVOICE_NODE_CKB=1` only when you explicitly need auto-topup on invoice node.
- `E2E_ACCEPT_CHANNEL_FUNDING_AMOUNT_HEX` defaults to `fnn node_info.auto_accept_channel_ckb_funding_amount` when not set.

## GitHub Actions setup

Workflow:

- `.github/workflows/e2e-invoice-payment-accounting.yml`

Optional repository secrets:

- `E2E_CKB_TOPUP_ADDRESS` (if omitted, workflow run tries auto-derive from `fnn2 node_info`)
- `E2E_CKB_INVOICE_TOPUP_ADDRESS` (if omitted, workflow run tries auto-derive from `fnn node_info`)
- `E2E_USDI_TOPUP_ADDRESS` (defaults to `E2E_CKB_TOPUP_ADDRESS`)
- `E2E_USDI_FAUCET_COMMAND` (optional override; if omitted, workflow uses built-in faucet command)

After setting secrets, trigger workflow manually from Actions tab:

- `E2E Invoice Payment Accounting` -> `Run workflow`

## Expected output

Success:

```text
RESULT=PASS CODE=0 ARTIFACT_DIR=...
```

Failure:

```text
RESULT=FAIL CODE=<code> MESSAGE=<message> ARTIFACT_DIR=...
```

The script writes step artifacts under:

```text
.tmp/e2e-invoice-payment-accounting/<UTC_TIMESTAMP>/
```

including faucet requests/responses, channel bootstrap records, invoice/payment RPC payloads, settlement polling logs, and compose logs.

## Insufficient balance behavior

When balance is insufficient, script exits with `CODE=16` and prints explicit recharge instructions:

- payment insufficient balance:
  - CKB: prints payer (`fnn2`) CKB address + CKB faucet hint
  - USDI: prints payer USDI address + configured `E2E_USDI_FAUCET_COMMAND`
- channel bootstrap insufficient balance:
  - prints both `fnn2` payer CKB address and `fnn` invoice-node CKB address for developer top-up

If payment fails because route/channel is unavailable, script exits with `CODE=14` and prints route preparation guidance.
