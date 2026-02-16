#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
FNN_DOCKERFILE="${ROOT_DIR}/deploy/compose/fnn/Dockerfile"
FNN_ENTRYPOINT="${ROOT_DIR}/deploy/compose/fnn/entrypoint.sh"
RUNBOOK_FILE="${ROOT_DIR}/docs/runbooks/compose-reference.md"
EVIDENCE_RUNBOOK_FILE="${ROOT_DIR}/docs/runbooks/deployment-evidence.md"
EVIDENCE_TEMPLATE_DIR="${ROOT_DIR}/docs/runbooks/evidence-template/deployment"
EVIDENCE_SCRIPT="${ROOT_DIR}/scripts/capture-deployment-evidence.sh"
ENV_FILE="${ROOT_DIR}/deploy/compose/.env.example"
RPC_DOCKERFILE="${ROOT_DIR}/deploy/compose/service-rpc.Dockerfile"
WORKER_DOCKERFILE="${ROOT_DIR}/deploy/compose/service-worker.Dockerfile"
RPC_HEALTHCHECK_SCRIPT="${ROOT_DIR}/fiber-link-service/apps/rpc/src/scripts/healthcheck-ready.ts"
WORKER_HEALTHCHECK_SCRIPT="${ROOT_DIR}/fiber-link-service/apps/worker/src/scripts/healthcheck.ts"
DB_INIT_SQL="${ROOT_DIR}/deploy/compose/postgres/init/001_schema.sql"
GITIGNORE_FILE="${ROOT_DIR}/.gitignore"
TESTNET_CONFIG_FILE="${ROOT_DIR}/deploy/compose/fnn/config/testnet.yml"

for required in \
  "${COMPOSE_FILE}" \
  "${FNN_DOCKERFILE}" \
  "${FNN_ENTRYPOINT}" \
  "${RUNBOOK_FILE}" \
  "${EVIDENCE_RUNBOOK_FILE}" \
  "${EVIDENCE_SCRIPT}" \
  "${ENV_FILE}" \
  "${RPC_DOCKERFILE}" \
  "${WORKER_DOCKERFILE}" \
  "${RPC_HEALTHCHECK_SCRIPT}" \
  "${WORKER_HEALTHCHECK_SCRIPT}" \
  "${DB_INIT_SQL}" \
  "${GITIGNORE_FILE}" \
  "${TESTNET_CONFIG_FILE}"; do
  if [[ ! -f "${required}" ]]; then
    echo "missing required file: ${required}" >&2
    exit 1
  fi
done

for template_file in \
  "${EVIDENCE_TEMPLATE_DIR}/README.md" \
  "${EVIDENCE_TEMPLATE_DIR}/checklist.md" \
  "${EVIDENCE_TEMPLATE_DIR}/retention-policy.md" \
  "${EVIDENCE_TEMPLATE_DIR}/manifest.template.json"; do
  if [[ ! -f "${template_file}" ]]; then
    echo "missing evidence template file: ${template_file}" >&2
    exit 1
  fi
done

if [[ ! -x "${EVIDENCE_SCRIPT}" ]]; then
  echo "deployment evidence script is not executable: ${EVIDENCE_SCRIPT}" >&2
  exit 1
fi

for compose_file in "${ENV_FILE}" "${COMPOSE_FILE}"; do
  if rg -n "^(<<<<<<<|=======|>>>>>>> )" "${compose_file}" >/dev/null; then
    echo "merge-conflict marker found in ${compose_file}" >&2
    exit 1
  fi
done

if ! grep -q "capture-deployment-evidence.sh" "${RUNBOOK_FILE}"; then
  echo "compose runbook missing deployment evidence script reference" >&2
  exit 1
fi

if ! grep -q "retention" "${EVIDENCE_RUNBOOK_FILE}"; then
  echo "deployment evidence runbook missing retention policy section" >&2
  exit 1
fi

for service in rpc worker postgres redis fnn; do
  if ! grep -Eq "^[[:space:]]{2}${service}:" "${COMPOSE_FILE}"; then
    echo "docker compose missing service: ${service}" >&2
    exit 1
  fi
done

if ! grep -q "^FIBER_RPC_URL=http://fnn:8227$" "${ENV_FILE}"; then
  echo ".env.example missing FIBER_RPC_URL default to fnn service" >&2
  exit 1
fi

if ! grep -q "^FNN_ASSET_SHA256=" "${ENV_FILE}"; then
  echo ".env.example missing FNN_ASSET_SHA256 placeholder" >&2
  exit 1
fi

for required_var in POSTGRES_PASSWORD FNN_ASSET_SHA256 FIBER_SECRET_KEY_PASSWORD FIBER_LINK_HMAC_SECRET; do
  if ! grep -Eq "^${required_var}=.+" "${ENV_FILE}"; then
    echo ".env.example missing non-empty default/placeholder for ${required_var}" >&2
    exit 1
  fi
done

if ! grep -q "^WORKER_SHUTDOWN_TIMEOUT_MS=" "${ENV_FILE}"; then
  echo ".env.example missing WORKER_SHUTDOWN_TIMEOUT_MS default" >&2
  exit 1
fi

if ! grep -q "^WORKER_SETTLEMENT_INTERVAL_MS=" "${ENV_FILE}"; then
  echo ".env.example missing WORKER_SETTLEMENT_INTERVAL_MS default" >&2
  exit 1
fi

if ! grep -q "^WORKER_SETTLEMENT_BATCH_SIZE=" "${ENV_FILE}"; then
  echo ".env.example missing WORKER_SETTLEMENT_BATCH_SIZE default" >&2
  exit 1
fi

if ! grep -q "^RPC_HEALTHCHECK_TIMEOUT_MS=" "${ENV_FILE}"; then
  echo ".env.example missing RPC_HEALTHCHECK_TIMEOUT_MS default" >&2
  exit 1
fi

if ! grep -q "^WORKER_READINESS_TIMEOUT_MS=" "${ENV_FILE}"; then
  echo ".env.example missing WORKER_READINESS_TIMEOUT_MS default" >&2
  exit 1
fi

if ! grep -q "^deploy/compose/.env$" "${GITIGNORE_FILE}"; then
  echo ".gitignore missing deploy/compose/.env ignore rule" >&2
  exit 1
fi

if ! grep -q "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}" "${COMPOSE_FILE}"; then
  echo "docker-compose missing required POSTGRES_PASSWORD guard" >&2
  exit 1
fi

if ! grep -q "FIBER_LINK_HMAC_SECRET: \${FIBER_LINK_HMAC_SECRET:?Set FIBER_LINK_HMAC_SECRET in .env}" "${COMPOSE_FILE}"; then
  echo "docker-compose missing required FIBER_LINK_HMAC_SECRET guard" >&2
  exit 1
fi

if ! grep -q '^  listening_addr: "/ip4/0.0.0.0/tcp/8228"$' "${TESTNET_CONFIG_FILE}"; then
  echo "testnet config missing canonical FNN p2p listen port 8228" >&2
  exit 1
fi

if ! grep -q '^  listening_addr: "0.0.0.0:8227"$' "${TESTNET_CONFIG_FILE}"; then
  echo "testnet config missing canonical FNN rpc listen port 8227" >&2
  exit 1
fi

if ! grep -q '^  rpc_url: "https://testnet.ckbapp.dev/"$' "${TESTNET_CONFIG_FILE}"; then
  echo "testnet config missing CKB testnet RPC dependency" >&2
  exit 1
fi

if ! grep -Fq '${FNN_RPC_PORT:-8227}:8227' "${COMPOSE_FILE}"; then
  echo "docker-compose missing consistent FNN RPC port mapping" >&2
  exit 1
fi

if ! grep -Fq '${FNN_P2P_PORT:-8228}:8228' "${COMPOSE_FILE}"; then
  echo "docker-compose missing consistent FNN P2P port mapping" >&2
  exit 1
fi

if ! grep -q "apps/rpc/src/scripts/healthcheck-ready.ts" "${COMPOSE_FILE}"; then
  echo "docker-compose missing RPC readiness healthcheck script command" >&2
  exit 1
fi

if ! grep -q "apps/worker/src/scripts/healthcheck.ts" "${COMPOSE_FILE}"; then
  echo "docker-compose missing worker readiness healthcheck script command" >&2
  exit 1
fi

if ! grep -q "curl -sS --max-time 3 http://127.0.0.1:8227" "${COMPOSE_FILE}"; then
  echo "docker-compose missing fnn liveness/readiness probe" >&2
  exit 1
fi

if ! grep -q "condition: service_healthy" "${COMPOSE_FILE}"; then
  echo "docker-compose should use service_healthy readiness gating" >&2
  exit 1
fi

if grep -q "service_started" "${COMPOSE_FILE}"; then
  echo "docker-compose still references service_started dependency condition" >&2
  exit 1
fi

if ! grep -q "^ARG FNN_ASSET_SHA256=" "${FNN_DOCKERFILE}"; then
  echo "fnn Dockerfile missing FNN_ASSET_SHA256 build arg" >&2
  exit 1
fi

if ! grep -q "sha256sum --check" "${FNN_DOCKERFILE}"; then
  echo "fnn Dockerfile missing SHA256 verification step" >&2
  exit 1
fi

if ! grep -Eq "exec ./fnn -c .* -d .*" "${FNN_ENTRYPOINT}"; then
  echo "fnn entrypoint missing canonical startup command" >&2
  exit 1
fi

echo "compose-reference checks passed"
