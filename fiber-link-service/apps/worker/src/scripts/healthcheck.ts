import { runWorkerReadinessChecks } from "../worker-readiness";

const timeoutRaw = process.env.WORKER_READINESS_TIMEOUT_MS ?? "5000";
const timeoutMs = Number(timeoutRaw);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`[worker-healthcheck] invalid WORKER_READINESS_TIMEOUT_MS: ${timeoutRaw}`);
  process.exit(1);
}

const fiberRpcUrl = process.env.FIBER_RPC_URL;
if (!fiberRpcUrl) {
  console.error("[worker-healthcheck] FIBER_RPC_URL is required");
  process.exit(1);
}

async function main() {
  const payload = await runWorkerReadinessChecks({
    fiberRpcUrl,
    timeoutMs,
  });

  console.log(JSON.stringify(payload));
  if (payload.status !== "ready") {
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[worker-healthcheck] readiness probe failed unexpectedly", error);
  process.exit(1);
});
