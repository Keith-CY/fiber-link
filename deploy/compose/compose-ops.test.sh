#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env.example"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
OPS_WRAPPER="${ROOT_DIR}/deploy/compose/compose-ops-summary.sh"
MONITORING_RUNBOOK="${ROOT_DIR}/docs/runbooks/compose-ops-monitoring.md"
POLICY_RUNBOOK="${ROOT_DIR}/docs/runbooks/withdrawal-policy-operations.md"
WORKER_SCRIPT="${ROOT_DIR}/fiber-link-service/apps/worker/src/scripts/ops-summary.ts"
ADMIN_SCRIPT="${ROOT_DIR}/fiber-link-service/apps/admin/src/scripts/manage-withdrawal-policy.ts"
COMPOSE_REFERENCE="${ROOT_DIR}/docs/runbooks/compose-reference.md"
CHECKLIST_FILE="${ROOT_DIR}/docs/runbooks/mainnet-deployment-checklist.md"

for required in \
  "${ENV_FILE}" \
  "${COMPOSE_FILE}" \
  "${OPS_WRAPPER}" \
  "${MONITORING_RUNBOOK}" \
  "${POLICY_RUNBOOK}" \
  "${WORKER_SCRIPT}" \
  "${ADMIN_SCRIPT}" \
  "${COMPOSE_REFERENCE}" \
  "${CHECKLIST_FILE}"; do
  if [[ ! -f "${required}" ]]; then
    echo "missing required file: ${required}" >&2
    exit 1
  fi
done

if [[ ! -x "${OPS_WRAPPER}" ]]; then
  echo "compose ops wrapper is not executable: ${OPS_WRAPPER}" >&2
  exit 1
fi

for required_var in \
  WORKER_OPS_MAX_UNPAID_BACKLOG \
  WORKER_OPS_MAX_OLDEST_UNPAID_AGE_MS \
  WORKER_OPS_MAX_RETRY_PENDING \
  WORKER_OPS_MAX_RECENT_FAILED_SETTLEMENTS \
  WORKER_OPS_RECENT_FAILURE_LOOKBACK_HOURS \
  WORKER_OPS_MAX_WITHDRAWAL_PARITY_ISSUES \
  WORKER_OPS_WITHDRAWAL_LOOKBACK_HOURS \
  WORKER_OPS_WITHDRAWAL_SAMPLE_LIMIT; do
  if ! grep -q "^${required_var}=" "${ENV_FILE}"; then
    echo ".env.example missing ${required_var}" >&2
    exit 1
  fi
  if ! grep -q "${required_var}: \${${required_var}:-" "${COMPOSE_FILE}"; then
    echo "docker-compose missing ${required_var} passthrough" >&2
    exit 1
  fi
done

if ! grep -q "compose-ops-summary.sh" "${MONITORING_RUNBOOK}"; then
  echo "monitoring runbook missing compose ops wrapper reference" >&2
  exit 1
fi

if ! grep -q "exit 2" "${MONITORING_RUNBOOK}"; then
  echo "monitoring runbook missing alert exit-code semantics" >&2
  exit 1
fi

if ! grep -q "manage-withdrawal-policy.ts" "${POLICY_RUNBOOK}"; then
  echo "withdrawal policy runbook missing admin script reference" >&2
  exit 1
fi

if ! grep -q "compose-ops-summary.sh" "${COMPOSE_REFERENCE}"; then
  echo "compose reference missing ops summary command reference" >&2
  exit 1
fi

if ! grep -q "manage-withdrawal-policy.ts" "${CHECKLIST_FILE}"; then
  echo "mainnet checklist missing policy operator command reference" >&2
  exit 1
fi

echo "compose-ops checks passed"
