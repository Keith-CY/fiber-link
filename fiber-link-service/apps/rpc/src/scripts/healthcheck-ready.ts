const portRaw = process.env.RPC_PORT ?? "3000";
const timeoutRaw = process.env.RPC_HEALTHCHECK_TIMEOUT_MS ?? "3000";

const port = Number(portRaw);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[rpc-healthcheck] invalid RPC_PORT: ${portRaw}`);
  process.exit(1);
}

const timeoutMs = Number(timeoutRaw);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`[rpc-healthcheck] invalid RPC_HEALTHCHECK_TIMEOUT_MS: ${timeoutRaw}`);
  process.exit(1);
}

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.floor(timeoutMs));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz/ready`, {
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok || !body.includes('"status":"ready"')) {
      throw new Error(`unexpected readiness response: HTTP ${response.status} ${body}`);
    }
    console.log(body);
  } finally {
    clearTimeout(timeout);
  }
}

void main().catch((error) => {
  console.error("[rpc-healthcheck] readiness probe failed", error);
  process.exit(1);
});
