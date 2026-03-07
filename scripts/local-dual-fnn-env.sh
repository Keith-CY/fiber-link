#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_SCRIPT="${ROOT_DIR}/scripts/e2e-invoice-payment-accounting.sh"

if [[ ! -x "${E2E_SCRIPT}" ]]; then
  echo "missing executable script: ${E2E_SCRIPT}" >&2
  exit 1
fi

# For current FNN behavior, both payer and invoice nodes need on-chain capacity
# to keep channel bootstrap deterministic in local workflow.
: "${E2E_TOPUP_INVOICE_NODE_CKB:=1}"
export E2E_TOPUP_INVOICE_NODE_CKB

exec "${E2E_SCRIPT}" --prepare-only --keep-up "$@"
