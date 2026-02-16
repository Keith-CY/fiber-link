#!/usr/bin/env sh
set -eu

if [ -z "${FIBER_SECRET_KEY_PASSWORD:-}" ]; then
  echo "FIBER_SECRET_KEY_PASSWORD is required" >&2
  exit 1
fi

DATA_DIR="${FIBER_DATA_DIR:-/data}"
CONFIG_TEMPLATE="${FIBER_CONFIG_TEMPLATE:-/opt/fnn/config/testnet.yml}"
CONFIG_FILE="${FIBER_CONFIG_FILE:-${DATA_DIR}/config.yml}"

mkdir -p "${DATA_DIR}/ckb"

if [ ! -s "${DATA_DIR}/ckb/key" ]; then
  echo "No wallet key found, generating ${DATA_DIR}/ckb/key"
  openssl rand -hex 32 > "${DATA_DIR}/ckb/key"
  chmod 600 "${DATA_DIR}/ckb/key"
fi

if [ ! -s "${CONFIG_FILE}" ]; then
  cp "${CONFIG_TEMPLATE}" "${CONFIG_FILE}"
fi

NODE_IP="$(hostname -i | awk '{print $1}')"
if [ -z "${NODE_IP}" ]; then
  echo "Unable to determine container IP for FNN RPC binding" >&2
  exit 1
fi
RPC_BIND_ADDR="${FNN_RPC_LISTEN_ADDR:-${NODE_IP}:8227}"

cd /opt/fnn
exec ./fnn -c "${CONFIG_FILE}" -d "${DATA_DIR}" --rpc-listening-addr "${RPC_BIND_ADDR}"
