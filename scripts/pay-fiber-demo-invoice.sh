#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/pay-fiber-demo-invoice.sh <invoice>
  FIBER_INVOICE=<invoice> scripts/pay-fiber-demo-invoice.sh

Env:
  DEMO_PAYER_RPC_URL        Payer Fiber RPC URL (default: http://127.0.0.1:9227)
  PAYMENT_TIMEOUT_SECONDS  Poll timeout for get_payment Success (default: 60)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

INVOICE="${1:-${FIBER_INVOICE:-}}"
if [[ -z "$INVOICE" ]]; then
  usage >&2
  exit 64
fi

export FIBER_INVOICE="$INVOICE"
export DEMO_PAYER_RPC_URL="${DEMO_PAYER_RPC_URL:-http://127.0.0.1:9227}"
export PAYMENT_TIMEOUT_SECONDS="${PAYMENT_TIMEOUT_SECONDS:-60}"

python3 - <<'PY'
import json
import os
import sys
import time
import urllib.request

invoice = os.environ["FIBER_INVOICE"].strip()
url = os.environ["DEMO_PAYER_RPC_URL"].strip()
timeout_seconds = int(os.environ.get("PAYMENT_TIMEOUT_SECONDS", "60"))

if not invoice:
    raise SystemExit("invoice is empty")


def rpc(method, params, timeout=30):
    payload = json.dumps({"jsonrpc": "2.0", "id": f"akane-{method}", "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=payload, headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        data = json.loads(response.read().decode())
    return data


def fail(message, data=None, code=1):
    print(json.dumps({"status": "ERROR", "message": message, "data": data}, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(code)

parsed = rpc("parse_invoice", {"params": {"invoice": invoice}}, timeout=20)
if "error" in parsed:
    fail("parse_invoice failed", parsed, 2)

inv = parsed["result"]["invoice"]
payment_hash = inv["data"]["payment_hash"]
amount = inv["amount"]
currency = inv["currency"]

pay_params = {
    "params": {
        "payment_hash": payment_hash,
        "amount": amount,
        "currency": currency,
        "invoice": invoice,
    }
}
sent = rpc("send_payment", pay_params, timeout=90)
if "error" in sent:
    msg = (sent.get("error") or {}).get("message", "")
    if "Payment session already exists" not in msg and "Success" not in msg:
        fail("send_payment failed", sent, 3)

last = sent
end = time.time() + timeout_seconds
while time.time() < end:
    status = rpc("get_payment", {"params": {"payment_hash": payment_hash}}, timeout=15)
    last = status
    state = ((status.get("result") or {}).get("status") or "").upper()
    if state == "SUCCESS":
        result = status["result"]
        print(json.dumps({
            "status": "SUCCESS",
            "currency": currency,
            "amount_hex": amount,
            "payment_hash": payment_hash,
            "fee": result.get("fee"),
            "created_at": result.get("created_at"),
            "last_updated_at": result.get("last_updated_at"),
        }, ensure_ascii=False, indent=2))
        raise SystemExit(0)
    if state in {"FAILED", "ERROR", "EXPIRED"}:
        fail("payment reached terminal failure", status, 4)
    time.sleep(1)

fail("payment did not reach Success before timeout", last, 5)
PY
